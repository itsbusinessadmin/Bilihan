-- Bilihan audit fix batch #5 — 2026-10-14
-- Run this entire file ONCE in Supabase Dashboard -> SQL Editor,
-- AFTER supabase-setup.sql, supabase-coupons.sql, supabase-fix-audit-2.sql,
-- supabase-fix-audit-3.sql and supabase-fix-audit-4.sql. Safe to re-run.
--
-- This file is SELF-CONTAINED: every function it touches is defined here in
-- full with CREATE OR REPLACE.
--
-- Fixes:
--  1. A cancelled order now puts a product checkout itself hid (sold out)
--     back on the shelf. A new products.auto_hidden flag records who switched
--     a product off: checkout sets it when it hides a sold-out product, the
--     admin product form clears it whenever the owner saves, and the restore
--     only re-enables products checkout hid.

alter table public.products add column if not exists auto_hidden boolean not null default false;

create or replace function public.place_order(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_fulfillment text,
  p_address text,
  p_preferred_date date,
  p_payment_method text,
  p_note text,
  p_items jsonb,
  p_coupon_code text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_code text;
  v_token uuid := gen_random_uuid();
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_items_out jsonb := '[]'::jsonb;
  v_option_ids uuid[];
  v_group record;
  v_picked integer;
  v_group_rows jsonb;
  v_chosen jsonb;
  v_unit numeric(12,2);
  v_addon numeric(12,2);
  v_absolute numeric(12,2);
  v_group_addon numeric(12,2);
  v_known integer;
  v_unit_original numeric(12,2);
  v_unit_interest numeric(12,2);
  v_needed integer;
  v_phone text;
  v_email text;
  v_cfg public.store_settings%rowtype;
  v_coupon public.coupons%rowtype;
  v_coupon_discount numeric(12,2) := 0;
  v_coupon_code text := null;
  v_coupon_kind text := null;
  v_coupon_id uuid := null;
  v_new_remaining numeric(12,2);
  v_existing public.orders%rowtype;
  v_idem_key text;
begin
  -- Idempotency: if the customer's network dropped the response after the
  -- order already committed, the retry carries the same key and gets the
  -- already-created order back instead of a duplicate (which would decrement
  -- stock twice and consume a coupon twice for one intended purchase).
  v_idem_key := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  if v_idem_key is not null then
    select * into v_existing from public.orders where idempotency_key = v_idem_key;
    if found then
      return jsonb_build_object('ok',true,'duplicate',true,'order',jsonb_build_object(
        'id',v_existing.id,'order_code',v_existing.order_code,
        'cancel_token',v_existing.cancel_token,
        'customer_name',v_existing.customer_name,'phone',v_existing.phone,
        'email',v_existing.email,'total',v_existing.total,
        'status',v_existing.status));
    end if;
  end if;
  -- Read the shop's checkout rules here rather than trusting what the page sent:
  -- anything the browser enforces can be skipped by posting straight to this function.
  select * into v_cfg from public.store_settings where id = 1;

  -- Closed means closed. The page hides itself too, but this is the check that
  -- counts: a tab opened while the shop was still open would otherwise keep working.
  if not coalesce(v_cfg.store_open,true) then
    return jsonb_build_object('ok',false,'closed',true,
      'error', coalesce(nullif(btrim(v_cfg.closed_message),''),
                        'We are closed right now, so we cannot take this order. Please try again when we reopen.'));
  end if;

  if coalesce(trim(p_customer_name),'') = '' then
    return jsonb_build_object('ok',false,'error','Name is required.');
  end if;

  -- Phone is optional: normalize blank/whitespace-only input to NULL.
  v_phone := nullif(trim(p_phone),'');

  -- Email is optional too. Checked loosely: this only decides whether a
  -- confirmation is worth attempting, and a real typo can only be caught by the
  -- mail bouncing. Rejecting here beats silently never sending.
  v_email := nullif(lower(trim(p_email)),'');
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok',false,'error','That email address does not look right. Check it, or leave it blank.');
  end if;

  -- Required only counts while the field is actually on the form.
  if coalesce(v_cfg.checkout_show_phone,true) and coalesce(v_cfg.checkout_require_phone,false)
     and v_phone is null then
    return jsonb_build_object('ok',false,'error','Please enter your mobile number.');
  end if;
  if coalesce(v_cfg.checkout_show_email,true) and coalesce(v_cfg.checkout_require_email,false)
     and v_email is null then
    return jsonb_build_object('ok',false,'error','Please enter your email address.');
  end if;

  -- A field the shop has turned off keeps no value, even if one was posted anyway.
  if not coalesce(v_cfg.checkout_show_phone,true) then v_phone := null; end if;
  if not coalesce(v_cfg.checkout_show_email,true) then v_email := null; end if;

  if p_fulfillment not in ('Delivery','Pickup') then return jsonb_build_object('ok',false,'error','Invalid fulfillment method.'); end if;
  if p_fulfillment='Delivery' and coalesce(trim(p_address),'')='' then return jsonb_build_object('ok',false,'error','Delivery address is required.'); end if;
  if p_preferred_date < current_date then return jsonb_build_object('ok',false,'error','Preferred date cannot be in the past.'); end if;
  if p_payment_method not in ('QR Payment','Cash on Delivery / Pickup','Paid Already') then return jsonb_build_object('ok',false,'error','Invalid payment method.'); end if;
  if p_payment_method = 'Paid Already' and not coalesce(v_cfg.show_paid_already,false) then
    return jsonb_build_object('ok',false,'error','That payment method is not available right now. Please choose another one.');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then return jsonb_build_object('ok',false,'error','Cart is empty.'); end if;

  v_code := 'BIL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  while exists(select 1 from public.orders where order_code=v_code) loop
    v_code := 'BIL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end loop;

  -- Lock every referenced product row while validating and computing authoritative prices.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_qty := (v_item->>'qty')::integer;
    exception when others then
      return jsonb_build_object('ok',false,'error','Invalid item quantity.');
    end;
    if v_qty <= 0 then return jsonb_build_object('ok',false,'error','Invalid item quantity.'); end if;

    select * into v_product from public.products
    where id=(v_item->>'product_id')::uuid
    for update;

    if not found then return jsonb_build_object('ok',false,'error','A product in your cart no longer exists.'); end if;
    -- Variants mean one product can appear on several lines (a Large and a Medium
    -- of the same drink). Each line could pass on its own while the order as a
    -- whole asks for more than there is, so the check is against the total.
    select coalesce(sum((el->>'qty')::integer),0) into v_needed
      from jsonb_array_elements(p_items) el
     where (el->>'product_id') = v_product.id::text;
    if not v_product.is_available or v_product.stock < v_needed then
      return jsonb_build_object('ok',false,'error',v_product.name || ' no longer has enough stock.');
    end if;

    -- The browser sends only which options were ticked. Everything about what
    -- they cost, whether they were allowed, and whether the compulsory ones were
    -- answered is decided here, because a price posted by a browser is a wish.
    begin
      select coalesce(array_agg((value #>> '{}')::uuid), '{}')
        into v_option_ids
        from jsonb_array_elements(coalesce(v_item->'option_ids','[]'::jsonb));
    exception when others then
      return jsonb_build_object('ok',false,'error','We could not read your choices for ' || v_product.name || '. Please pick them again.');
    end;

    -- Every id sent has to be an option of THIS product. Anything else is a stale
    -- cart or a hand-made request, and either way the order should not go through.
    select count(*) into v_known
    from public.product_variant_options o
    join public.product_variant_groups g on g.id = o.group_id
    where o.id = any(v_option_ids) and g.product_id = v_product.id;
    if v_known <> coalesce(array_length(v_option_ids,1),0) then
      return jsonb_build_object('ok',false,'error','Some of your choices for ' || v_product.name || ' are no longer available. Please open it and pick again.');
    end if;
    if exists (select 1 from public.product_variant_options o
               where o.id = any(v_option_ids) and not o.is_available) then
      return jsonb_build_object('ok',false,'error','One of your choices for ' || v_product.name || ' has sold out. Please pick again.');
    end if;

    v_addon := 0; v_absolute := null; v_chosen := '[]'::jsonb;
    for v_group in
      select * from public.product_variant_groups where product_id = v_product.id order by sort_order, label
    loop
      select count(*) into v_picked
      from public.product_variant_options o
      where o.group_id = v_group.id and o.id = any(v_option_ids);

      if v_group.is_required and v_picked = 0 then
        return jsonb_build_object('ok',false,'error','Please choose a ' || lower(v_group.label) || ' for ' || v_product.name || '.');
      end if;
      if v_group.selection = 'single' and v_picked > 1 then
        return jsonb_build_object('ok',false,'error','Please choose only one ' || lower(v_group.label) || ' for ' || v_product.name || '.');
      end if;

      -- An option left at zero changes nothing, in either mode. For an add-on that was
      -- always so; for a whole-price option it was not -- a flavour whose price was
      -- left at 0 replaced the product's price with 0, and the product was sold for
      -- nothing. Only an amount above zero adds to the price or stands in for it.
      --
      -- The subtotal has its own numeric variable. It used to borrow v_picked, an
      -- integer, which rounded every add-on to the whole peso: a 5.05 topping was
      -- charged as 5.00 while the cart showed 5.05.
      select coalesce(sum(case when v_group.price_mode = 'add' and o.amount > 0 then o.amount else 0 end),0),
             max(case when v_group.price_mode = 'absolute' and o.amount > 0 then o.amount else null end),
             coalesce(jsonb_agg(jsonb_build_object('group',v_group.label,'label',o.label,
                                                   'amount',o.amount,'price_mode',v_group.price_mode)
                      order by o.sort_order, o.label), '[]'::jsonb)
        into v_group_addon, v_absolute, v_group_rows
        from public.product_variant_options o
       where o.group_id = v_group.id and o.id = any(v_option_ids);
      v_addon := v_addon + coalesce(v_group_addon,0);
      if v_absolute is not null then v_unit := v_absolute; end if;
      v_chosen := v_chosen || v_group_rows;
    end loop;

    -- An 'absolute' option priced above zero replaces the product's price; add-ons
    -- stack on top of whichever of the two is in play.
    v_unit := coalesce(v_unit, v_product.price) + v_addon;
    if v_unit < 0 then v_unit := 0; end if;
    v_unit := round(v_unit, 2);

    -- The cost-and-markup split is frozen onto the line so the seller page keeps
    -- reporting what was actually charged, whatever happens to the product later.
    --
    -- The markup is the product's own interest and stays there; everything the
    -- variants add belongs to the seller, who is the one supplying the larger
    -- size or the extra topping. The cap keeps a variant priced below the markup
    -- from handing the seller a negative amount, and the two always sum to what
    -- was charged.
    v_unit_interest := least(greatest(coalesce(v_product.interest, 0), 0), v_unit);
    v_unit_original := v_unit - v_unit_interest;

    v_total := v_total + (v_unit * v_qty);
    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,'product_name',v_product.name,'unit_price',v_unit,'qty',v_qty,
      'variants',v_chosen,'unit_original_price',v_unit_original,'unit_interest',v_unit_interest,
      'seller_name',coalesce(v_product.seller_name,'')
    ));
    v_unit := null; v_absolute := null;
  end loop;

  -- Coupon / discount. The row is locked so two checkouts cannot spend the same
  -- single-use coupon, or the last peso of a credit coupon, at the same time.
  -- A credit coupon works until it runs out: the order takes what it needs and the
  -- rest stays on the coupon for next time. A percent coupon works once.
  v_coupon_discount := 0; v_coupon_code := null; v_coupon_kind := null; v_coupon_id := null;
  if coalesce(btrim(p_coupon_code),'') <> '' then
    select * into v_coupon from public.coupons
     where upper(code) = upper(btrim(p_coupon_code)) for update;
    if not found then
      return jsonb_build_object('ok',false,'error','That coupon code is not valid.');
    end if;
    if v_coupon.status = 'paused' then
      return jsonb_build_object('ok',false,'error','This coupon is paused right now.');
    end if;
    if v_coupon.status = 'used' then
      return jsonb_build_object('ok',false,'error','This coupon has already been used.');
    end if;
    if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
      return jsonb_build_object('ok',false,'error','This coupon has expired.');
    end if;
    if v_coupon.status <> 'active' then
      return jsonb_build_object('ok',false,'error','This coupon is not valid.');
    end if;
    if v_coupon.kind = 'credit' then
      if coalesce(v_coupon.remaining_credit,0) <= 0 then
        return jsonb_build_object('ok',false,'error','This coupon has no remaining balance.');
      end if;
      v_coupon_discount := least(v_coupon.remaining_credit, v_total);
      v_new_remaining := v_coupon.remaining_credit - v_coupon_discount;
      update public.coupons
         set remaining_credit = v_new_remaining,
             status = case when v_new_remaining <= 0 then 'used' else 'active' end,
             updated_at = now()
       where id = v_coupon.id;
    else
      v_coupon_discount := round(v_total * v_coupon.percent_value / 100, 2);
      update public.coupons set status = 'used', updated_at = now() where id = v_coupon.id;
    end if;
    v_total := greatest(round(v_total - v_coupon_discount, 2), 0);
    v_coupon_code := v_coupon.code;
    v_coupon_kind := v_coupon.kind;
    -- Frozen onto the order so a later code regeneration cannot break the
    -- cancellation refund.
    v_coupon_id := v_coupon.id;
  end if;

  insert into public.orders(id,order_code,cancel_token,customer_name,phone,email,fulfillment,address,preferred_date,payment_method,note,total,status,coupon_code,coupon_discount,coupon_kind,coupon_id,idempotency_key)
  values(v_order_id,v_code,v_token,trim(p_customer_name),v_phone,v_email,p_fulfillment,case when p_fulfillment='Delivery' then trim(p_address) else null end,p_preferred_date,p_payment_method,nullif(trim(p_note),''),v_total,'New',v_coupon_code,v_coupon_discount,v_coupon_kind,v_coupon_id,v_idem_key);

  for v_item in select * from jsonb_array_elements(v_items_out)
  loop
    insert into public.order_items(order_id,product_id,product_name,unit_price,qty,variants,unit_original_price,unit_interest,seller_name)
    values(v_order_id,(v_item->>'product_id')::uuid,v_item->>'product_name',(v_item->>'unit_price')::numeric,(v_item->>'qty')::integer,
           coalesce(v_item->'variants','[]'::jsonb),(v_item->>'unit_original_price')::numeric,(v_item->>'unit_interest')::numeric,
           nullif(v_item->>'seller_name',''));
    update public.products
      set stock = stock - (v_item->>'qty')::integer,
          is_available = case when stock - (v_item->>'qty')::integer > 0 then is_available else false end,
          /* Remember who switched the product off. When checkout itself hides a
             product that just sold out, auto_hidden is set; a product the owner
             hid on purpose keeps whatever it had. Cancelling later uses this to
             decide whether the product may come back on the shelf by itself. */
          auto_hidden = case when stock - (v_item->>'qty')::integer > 0 then auto_hidden
                             when is_available then true
                             else auto_hidden end
      where id=(v_item->>'product_id')::uuid;
  end loop;

  return jsonb_build_object('ok',true,'order',jsonb_build_object(
    'id',v_order_id,'order_code',v_code,'cancel_token',v_token,'customer_name',trim(p_customer_name),'phone',v_phone,'email',v_email,
    'fulfillment',p_fulfillment,'address',case when p_fulfillment='Delivery' then trim(p_address) else null end,
    'preferred_date',p_preferred_date,'payment_method',p_payment_method,'note',nullif(trim(p_note),''),'total',v_total,'status','New',
    'coupon_code',v_coupon_code,'coupon_discount',v_coupon_discount,'coupon_kind',v_coupon_kind,
    'created_at',now(),'items',v_items_out
  ));
exception when others then
  raise;
end;
$$;

grant execute on function public.place_order(text,text,text,text,text,date,text,text,jsonb,text,text) to anon, authenticated;

create or replace function public.restore_order_inventory(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item  public.order_items%rowtype;
  v_coupon_id uuid;
  v_code  text;
  v_remaining numeric(12,2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;

  -- Stock comes back. A product checkout itself hid when it sold out
  -- (auto_hidden) goes back on the shelf once it has stock again; a product
  -- the owner hid on purpose is left alone.
  for v_item in select * from public.order_items where order_id = v_order.id
  loop
    if v_item.product_id is not null then
      update public.products
         set stock = stock + v_item.qty,
             is_available = case when auto_hidden and stock + v_item.qty > 0
                                 then true else is_available end,
             auto_hidden = case when auto_hidden and stock + v_item.qty > 0
                                then false else auto_hidden end
       where id = v_item.product_id;
    end if;
  end loop;

  -- Coupon value comes back. The id stored on the order survives a code
  -- regeneration; only orders placed before that column existed fall back to
  -- matching the code, which cannot survive a regeneration.
  v_coupon_id := v_order.coupon_id;
  if v_coupon_id is null then
    v_code := nullif(btrim(coalesce(v_order.coupon_code, '')), '');
    if v_code is not null then
      select c.id into v_coupon_id from public.coupons c where upper(c.code) = upper(v_code);
    end if;
  end if;

  if v_coupon_id is not null then
    if coalesce(v_order.coupon_kind, '') = 'credit' then
      update public.coupons
         set remaining_credit = least(credit_amount,
                                      coalesce(remaining_credit, 0)
                                      + coalesce(v_order.coupon_discount, 0))
       where id = v_coupon_id
       returning remaining_credit into v_remaining;
      -- The pesos are back, so the coupon must be spendable again. A coupon
      -- the spending used up sits at 'used', which checkout refuses.
      if coalesce(v_remaining, 0) > 0 then
        update public.coupons
           set status = 'active'
         where id = v_coupon_id
           and status = 'used';
      end if;
    else
      -- One-time percent coupon: only this order could have consumed it, so a
      -- 'used' coupon here belongs to this cancellation — but only when it
      -- has not expired in the meantime.
      update public.coupons
         set status = 'active'
       where id = v_coupon_id
         and kind = 'percent'
         and status = 'used'
         and (expires_at is null or expires_at > now());
    end if;
  end if;
end;
$$;

/* Lock the shared restore routine to the cancel/admin flows: executable by
   PUBLIC by default, so without this revoke any anonymous caller could refund
   their own order's stock and coupon credit without cancelling. */
revoke execute on function public.restore_order_inventory(uuid) from public;
