-- ===================================================================
-- Extras the customer can take more than once (Extra Rice x2).
--
--  1. product_variant_options.max_qty — how many of an extra one order may
--     take, set per option in the product editor. 1 means tick it or not.
--  2. set_product_variants — saves max_qty (forced to 1 except for add-ons in
--     a pick-any variant).
--  3. place_order — the same as batch 11 (supabase-fix-audit-7.sql), except
--     each item may carry option_qty {option id: count}: the count is checked
--     against max_qty, the extra is charged that many times, and its label is
--     frozen as "Extra Rice ×2".
--
-- IMPORTANT: run this file in the Supabase SQL Editor BEFORE merging this
-- change (the new code sends option_qty and saves max_qty). Safe to re-run.
-- ===================================================================

alter table public.product_variant_options add column if not exists max_qty integer not null default 1;
alter table public.product_variant_options drop constraint if exists product_variant_options_max_qty_check;
alter table public.product_variant_options add constraint product_variant_options_max_qty_check
  check (max_qty between 1 and 20);

create or replace function public.set_product_variants(p_product_id uuid, p_groups jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_group_id uuid;
  v_i integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Not authorised.');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'error', 'That product no longer exists.');
  end if;

  delete from public.product_variant_groups where product_id = p_product_id;

  for v_group in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    if coalesce(btrim(v_group->>'label'), '') = '' then
      raise exception 'unnamed variant';
    end if;

    insert into public.product_variant_groups(
      product_id, variant_type, label, price_mode, selection, is_required, sort_order)
    values (
      p_product_id,
      coalesce(nullif(btrim(v_group->>'variant_type'), ''), 'custom'),
      btrim(v_group->>'label'),
      case when v_group->>'price_mode' = 'absolute' then 'absolute' else 'add' end,
      case when v_group->>'selection' = 'multi' then 'multi' else 'single' end,
      coalesce((v_group->>'is_required')::boolean, false),
      v_i)
    returning id into v_group_id;

    -- with ordinality, so the options keep the order the admin arranged them in
    -- rather than whatever order the rows happen to come back in.
    -- max_qty: how many of an extra one order may take. Only an add-on in a
    -- pick-any variant can be taken more than once; everything else is 1.
    insert into public.product_variant_options(group_id, label, amount, max_qty, sort_order)
    select v_group_id, btrim(o.value->>'label'),
           round(coalesce((o.value->>'amount')::numeric, 0), 2),
           case when v_group->>'price_mode' is distinct from 'absolute' and v_group->>'selection' = 'multi'
                then least(greatest(coalesce((o.value->>'max_qty')::integer, 1), 1), 20) else 1 end,
           o.ord
      from jsonb_array_elements(coalesce(v_group->'options', '[]'::jsonb))
           with ordinality o(value, ord)
     where coalesce(btrim(o.value->>'label'), '') <> '';
  end loop;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error',
      'Only one variant can set the whole price. Change the others to add to it instead. Nothing was changed.');
  when others then
    return jsonb_build_object('ok', false, 'error',
      'We could not save the choices for this product. Nothing was changed.');
end;
$$;

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
  v_opt_qty jsonb;
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
      /* A retry must get the same full order shape as the original call, so the
         confirmation, local order history, and sheet row all render correctly. */
      return jsonb_build_object('ok',true,'duplicate',true,'order',jsonb_build_object(
        'id',v_existing.id,'order_code',v_existing.order_code,
        'cancel_token',v_existing.cancel_token,
        'customer_name',v_existing.customer_name,'phone',v_existing.phone,
        'email',v_existing.email,
        'fulfillment',v_existing.fulfillment,'address',v_existing.address,
        'preferred_date',v_existing.preferred_date,
        'payment_method',v_existing.payment_method,'note',v_existing.note,
        'total',v_existing.total,'status',v_existing.status,
        'coupon_code',v_existing.coupon_code,'coupon_discount',v_existing.coupon_discount,
        'coupon_kind',v_existing.coupon_kind,'created_at',v_existing.created_at,
        'items',(select coalesce(jsonb_agg(jsonb_build_object(
            'product_id',oi.product_id,'product_name',oi.product_name,
            'unit_price',oi.unit_price,'qty',oi.qty,'variants',oi.variants,
            'unit_original_price',oi.unit_original_price,'unit_interest',oi.unit_interest,
            'seller_name',oi.seller_name) order by oi.id),'[]'::jsonb)
          from public.order_items oi where oi.order_id = v_existing.id)));
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

  -- Mirror the storefront's allow-lists server-side: anything the browser hides can
  -- still be posted straight to this function, so the shop's configuration is
  -- enforced here too.
  if p_fulfillment not in ('Delivery','Pickup') then return jsonb_build_object('ok',false,'error','Invalid fulfillment method.'); end if;
  if p_fulfillment='Delivery' and coalesce(v_cfg.show_delivery_address,false) is not true then return jsonb_build_object('ok',false,'error','Delivery is not available right now.'); end if;
  if p_fulfillment='Delivery' and coalesce(trim(p_address),'')='' then return jsonb_build_object('ok',false,'error','Delivery address is required.'); end if;
  if p_preferred_date < current_date then return jsonb_build_object('ok',false,'error','Preferred date cannot be in the past.'); end if;
  if coalesce(v_cfg.show_preferred_date,true) and coalesce(v_cfg.preferred_date_mode,'calendar')='calendar'
     and v_cfg.order_available_from is not null and p_preferred_date < v_cfg.order_available_from then
    return jsonb_build_object('ok',false,'error','Please select a date on or after the available-from date.');
  end if;
  if p_payment_method not in ('QR Payment','Cash on Delivery / Pickup','Paid Already') then return jsonb_build_object('ok',false,'error','Invalid payment method.'); end if;
  if p_payment_method = 'QR Payment' and (not coalesce(v_cfg.show_qr_payment,false) or coalesce(btrim(v_cfg.qr_image_url),'')='') then
    return jsonb_build_object('ok',false,'error','QR payment is not available right now.');
  end if;
  if p_payment_method = 'Cash on Delivery / Pickup' and not coalesce(v_cfg.show_cash_payment,false) then
    return jsonb_build_object('ok',false,'error','Cash payment is not available right now.');
  end if;
  if p_payment_method = 'Paid Already' and (not coalesce(v_cfg.show_paid_already,false) or coalesce(btrim(v_cfg.qr_image_url),'')='') then
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

    -- How many of each extra (Extra Rice x2). option_qty maps an option id to a
    -- count; an option it leaves out counts once. Only an add-on in a pick-any
    -- variant may go above one, and never above the max the shop set on it.
    v_opt_qty := case when jsonb_typeof(v_item->'option_qty') = 'object' then v_item->'option_qty' else '{}'::jsonb end;
    begin
      if exists (select 1 from public.product_variant_options o
                 join public.product_variant_groups g on g.id = o.group_id
                 where o.id = any(v_option_ids)
                   and coalesce((v_opt_qty->>o.id::text)::integer, 1) not between 1 and
                       (case when g.price_mode = 'add' and g.selection = 'multi' then greatest(o.max_qty, 1) else 1 end)) then
        return jsonb_build_object('ok',false,'error','Please check how many extras you chose for ' || v_product.name || '. Open it and pick again.');
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('ok',false,'error','We could not read your choices for ' || v_product.name || '. Please pick them again.');
    end;

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
      -- An extra taken several times is charged several times, and its label says
      -- so ("Extra Rice x2"), which every receipt, sheet row and report then shows.
      select coalesce(sum(case when v_group.price_mode = 'add' and o.amount > 0
                               then o.amount * coalesce((v_opt_qty->>o.id::text)::integer, 1) else 0 end),0),
             max(case when v_group.price_mode = 'absolute' and o.amount > 0 then o.amount else null end),
             coalesce(jsonb_agg(jsonb_build_object('group',v_group.label,
                                                   'label',o.label || case when coalesce((v_opt_qty->>o.id::text)::integer, 1) > 1
                                                                           then ' ×' || (v_opt_qty->>o.id::text) else '' end,
                                                   'amount',o.amount,'price_mode',v_group.price_mode,
                                                   'qty',coalesce((v_opt_qty->>o.id::text)::integer, 1))
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
exception
  when unique_violation then
    /* Two submissions carrying the same idempotency key overlapped in flight:
       the loser hit the unique index. Hand it the already-created order instead
       of a raw database error. */
    if v_idem_key is not null then
      select * into v_existing from public.orders where idempotency_key = v_idem_key;
      if found then
        return jsonb_build_object('ok',true,'duplicate',true,'order',jsonb_build_object(
          'id',v_existing.id,'order_code',v_existing.order_code,
          'cancel_token',v_existing.cancel_token,
          'customer_name',v_existing.customer_name,'phone',v_existing.phone,
          'email',v_existing.email,
          'fulfillment',v_existing.fulfillment,'address',v_existing.address,
          'preferred_date',v_existing.preferred_date,
          'payment_method',v_existing.payment_method,'note',v_existing.note,
          'total',v_existing.total,'status',v_existing.status,
          'coupon_code',v_existing.coupon_code,'coupon_discount',v_existing.coupon_discount,
          'coupon_kind',v_existing.coupon_kind,'created_at',v_existing.created_at,
          'items',(select coalesce(jsonb_agg(jsonb_build_object(
              'product_id',oi.product_id,'product_name',oi.product_name,
              'unit_price',oi.unit_price,'qty',oi.qty,'variants',oi.variants,
              'unit_original_price',oi.unit_original_price,'unit_interest',oi.unit_interest,
              'seller_name',oi.seller_name) order by oi.id),'[]'::jsonb)
            from public.order_items oi where oi.order_id = v_existing.id)));
      end if;
    end if;
    raise;
  when others then
    raise;
end;
$$;


grant execute on function public.place_order(text,text,text,text,text,date,text,text,jsonb,text,text) to anon, authenticated;
