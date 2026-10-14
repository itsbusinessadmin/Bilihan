-- Bilihan audit fix batch #2 — 2026-10-14
-- Run this entire file ONCE in Supabase Dashboard -> SQL Editor,
-- AFTER supabase-setup.sql and supabase-coupons.sql.
-- Everything here is safe to re-run.
--
-- Fixes:
--  1. cancel_order: the 3-hour window now uses the SERVER clock (now()), not the
--     client-supplied p_requested_at, which anyone could forge to cancel at any time.
--  2. cancel_order: coupon value is restored on cancellation (credit coupons get
--     their balance back, one-time percent coupons go back to active).
--  3. cancel_order: restores stock WITHOUT flipping is_available=true, so a
--     product the owner deliberately disabled is no longer silently re-enabled.
--  4. New admin_set_order_status(): lets the admin move orders through
--     New -> Preparing -> Ready -> Delivered -> Completed, or Cancelled
--     (cancellation restores stock + coupon credit, same as cancel_order).
--  5. Per-seller links: new seller_tokens table; seller_sales()/seller_buyers()
--     scope their figures to the token's seller instead of exposing every
--     seller's customers to anyone holding the one shared link. The old shared
--     link keeps working and still sees everything (legacy behaviour).
--  6. support_identify: the order number is now REQUIRED, and a supplied mobile
--     number must match the order's. Knowing someone's phone number alone no
--     longer opens their support conversation.

-- ===================================================================
-- Shared restore routine: stock + coupon credit for a cancelled order.
-- Called by cancel_order (customer) and admin_set_order_status (admin).
-- ===================================================================
-- Audit batch 8: the sold-out auto-hide flag must exist wherever this routine
-- is redefined, so re-running this file can never silently downgrade it.
alter table public.products add column if not exists auto_hidden boolean not null default false;
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

-- ===================================================================
-- cancel_order: server-clock window, coupon + stock restore.
-- Signature is unchanged so existing clients keep working; p_requested_at is
-- now only a sanity signal and no longer decides the window.
-- ===================================================================
create or replace function public.cancel_order(
  p_order_code text,
  p_cancel_token uuid,
  p_reason text,
  p_requested_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if coalesce(trim(p_reason),'')='' then
    return jsonb_build_object('ok',false,'error','Cancellation reason is required.');
  end if;
  select * into v_order
    from public.orders
   where order_code = p_order_code and cancel_token = p_cancel_token
   for update;
  if not found then
    return jsonb_build_object('ok',false,'error','Order not found.');
  end if;
  if v_order.status = 'Cancelled' then return jsonb_build_object('ok',true); end if;
  -- Delivered and Completed mean the goods have left the shop. Cancelling from
  -- there would put the items back into stock and refund the coupon, inflating
  -- inventory and handing coupon money back by mistake. Same rule as the admin
  -- path.
  if v_order.status in ('Delivered','Completed') then
    return jsonb_build_object('ok',false,'error','This order can no longer be cancelled.');
  end if;
  -- The window is measured on the server clock. The client timestamp is ignored
  -- for the decision (it could be forged); a wildly skewed one is still
  -- rejected as a sanity check. The tolerance is generous so an offline
  -- retry of a legitimate tap still goes through.
  if p_requested_at is not null
     and abs(extract(epoch from (now() - p_requested_at))) > 86400 then
    return jsonb_build_object('ok',false,'error','Invalid cancellation request time.');
  end if;
  if now() > v_order.created_at + interval '3 hours' then
    return jsonb_build_object('ok',false,'error','The 3-hour cancellation window has expired.');
  end if;

  update public.orders
     set status = 'Cancelled',
         cancellation_reason = trim(p_reason),
         cancelled_at = now()
   where id = v_order.id;

  perform public.restore_order_inventory(v_order.id);
  return jsonb_build_object('ok',true);
end;
$$;

grant execute on function public.cancel_order(text,uuid,text,timestamptz) to anon, authenticated;

-- ===================================================================
-- Admin order status management. The admin panel had no way to move an order
-- past 'New' or to cancel one; this is the single gated path.
-- ===================================================================
create or replace function public.admin_set_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_status text := nullif(btrim(coalesce(p_status,'')),'');
begin
  if not public.is_admin() then
    return jsonb_build_object('ok',false,'error','Not authorized.');
  end if;
  if v_status is null
     or v_status not in ('New','Preparing','Ready','Delivered','Completed','Cancelled') then
    return jsonb_build_object('ok',false,'error','Invalid status.');
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok',false,'error','Order not found.');
  end if;
  if v_order.status = v_status then return jsonb_build_object('ok',true); end if;
  -- A cancelled order stays cancelled: it is a terminal state, not a stage.
  if v_order.status = 'Cancelled' then
    return jsonb_build_object('ok',false,'error','This order is already cancelled.');
  end if;
  -- Delivered and Completed mean the goods have left the shop. Cancelling from
  -- there would put the items back into stock and refund the coupon, inflating
  -- inventory and handing coupon money back by mistake.
  if v_status = 'Cancelled' and v_order.status in ('Delivered','Completed') then
    raise exception 'Cannot cancel an order that is already %', v_order.status;
  end if;

  if v_status = 'Cancelled' then
    -- The admin path records when and why, exactly like the customer path.
    update public.orders
       set status = 'Cancelled',
           cancelled_at = now(),
           cancellation_reason = 'Cancelled by admin'
     where id = v_order.id;
    perform public.restore_order_inventory(v_order.id);
  else
    update public.orders set status = v_status where id = v_order.id;
  end if;
  return jsonb_build_object('ok',true,'status',v_status);
end;
$$;

grant execute on function public.admin_set_order_status(uuid,text) to authenticated;

-- ===================================================================
-- Per-seller links. One row per seller; the token in the URL decides whose
-- figures the seller page may show.
-- ===================================================================
create table if not exists public.seller_tokens(
  seller_name text primary key,
  token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);
alter table public.seller_tokens enable row level security;
drop policy if exists "admins manage seller tokens" on public.seller_tokens;
create policy "admins manage seller tokens" on public.seller_tokens
  for all using (public.is_admin()) with check (public.is_admin());

-- ===================================================================
-- seller_sales: scope to the token's seller when the token is per-seller.
-- The legacy shared link (seller_links) still sees every seller.
-- ===================================================================
create or replace function public.seller_sales(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_sellers jsonb;
  v_qty bigint;
  v_total numeric;
  v_interest numeric;
  v_unpaid_qty bigint;
  v_unpaid numeric;
  v_scope text := null; -- NULL = legacy shared link: every seller
begin
  if p_token is not null then
    select st.seller_name into v_scope
      from public.seller_tokens st where st.token = p_token;
  end if;
  if v_scope is null
     and not exists (select 1 from public.seller_links where id = 1 and token = p_token) then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid. Ask the store for a new one.');
  end if;

  with item_rows as (
    select seller, name,
           coalesce(sum(qty) filter (where is_paid), 0)::bigint as qty,
           coalesce(sum(original * qty) filter (where is_paid), 0) as original_total,
           coalesce(sum(interest * qty) filter (where is_paid), 0) as interest_total,
           coalesce(sum(qty) filter (where not is_paid), 0)::bigint as unpaid_qty,
           coalesce(sum((original + interest) * qty) filter (where not is_paid), 0) as unpaid_total
      from public.seller_order_lines
     where v_scope is null or seller = v_scope
     group by seller, name
  ), seller_rows as (
    select seller,
           sum(qty)::bigint as qty,
           sum(original_total) as original_total,
           sum(interest_total) as interest_total,
           sum(unpaid_qty)::bigint as unpaid_qty,
           sum(unpaid_total) as unpaid_total,
           jsonb_agg(jsonb_build_object('name', name, 'qty', qty,
                       'original_total', original_total,
                       'interest_total', interest_total,
                       'overall', original_total + interest_total,
                       'unpaid_qty', unpaid_qty, 'unpaid_total', unpaid_total)
                     order by original_total + interest_total desc, name) as items
      from item_rows group by seller
  ), flat as (
    -- Kept alongside the per-seller shape so a browser still running the older
    -- seller page has something to draw.
    select name,
           sum(qty)::bigint as qty,
           sum(original_total) as original_total,
           sum(interest_total) as interest_total,
           sum(unpaid_qty)::bigint as unpaid_qty,
           sum(unpaid_total) as unpaid_total
      from item_rows group by name
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty,
              'original_total', original_total, 'interest_total', interest_total,
              'unpaid_qty', unpaid_qty, 'unpaid_total', unpaid_total)
            order by original_total + interest_total desc, name), '[]'::jsonb) from flat),
    (select coalesce(jsonb_agg(jsonb_build_object('name', seller, 'qty', qty,
              'original_total', original_total, 'interest_total', interest_total,
              'overall', original_total + interest_total,
              'unpaid_qty', unpaid_qty, 'unpaid_total', unpaid_total, 'items', items)
            order by original_total + interest_total desc, seller), '[]'::jsonb) from seller_rows),
    (select coalesce(sum(qty), 0)::bigint from flat),
    (select coalesce(sum(original_total), 0) from flat),
    (select coalesce(sum(interest_total), 0) from flat),
    (select coalesce(sum(unpaid_qty), 0)::bigint from flat),
    (select coalesce(sum(unpaid_total), 0) from flat)
  into v_rows, v_sellers, v_qty, v_total, v_interest, v_unpaid_qty, v_unpaid;

  -- 'overall' is what the shop actually took: cost plus markup on settled orders,
  -- the same figure the admin calls Total Sell. 'unpaid' is what is still owed.
  -- 'scoped_seller' is new: the seller this token is limited to, or null when
  -- the legacy shared link may still see every seller.
  return jsonb_build_object('ok', true, 'items', v_rows, 'sellers', v_sellers,
                            'total_qty', v_qty,
                            'original', v_total, 'interest', v_interest,
                            'overall', v_total + v_interest,
                            'unpaid_qty', v_unpaid_qty, 'unpaid', v_unpaid,
                            'scoped_seller', v_scope,
                            'as_of', now());
end;
$$;

grant execute on function public.seller_sales(uuid) to anon, authenticated;

-- ===================================================================
-- seller_buyers: same scoping. A per-seller token can only ask for its own
-- seller's buyers.
-- ===================================================================
create or replace function public.seller_buyers(p_token uuid, p_seller text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_seller text := coalesce(nullif(btrim(p_seller), ''), 'Unassigned');
  v_scope text := null;
begin
  if p_token is not null then
    select st.seller_name into v_scope
      from public.seller_tokens st where st.token = p_token;
  end if;
  if v_scope is null
     and not exists (select 1 from public.seller_links where id = 1 and token = p_token) then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid. Ask the store for a new one.');
  end if;
  if v_scope is not null
     and lower(btrim(v_scope)) <> lower(btrim(v_seller)) then
    return jsonb_build_object('ok', false, 'error', 'This link is only valid for ' || v_scope || '.');
  end if;

  with lines as (
    select * from public.seller_order_lines where seller = v_seller
  ), buyer_rows as (
    -- One row per person, per set of choices, AND per payment state. Somebody who
    -- ordered a Large and a Regular wants to see both, not a single row of two that
    -- says nothing about which; the same goes for one order paid and another still
    -- pending, which a single row would average into a lie. Names are grouped
    -- case-insensitively so one person who typed theirs differently between orders
    -- is not split in half, and the spelling shown is the one they used most recently.
    select name,
           (array_agg(buyer order by created_at desc))[1] as buyer,
           variants, payment_status, is_paid, sum(qty)::bigint as qty
      from lines
     group by name, lower(buyer), variants, payment_status, is_paid
  ), item_buyers as (
    select name,
           jsonb_agg(jsonb_build_object('name', buyer, 'variants', variants,
                                        'payment_status', payment_status,
                                        'is_paid', is_paid, 'qty', qty)
                     order by is_paid, qty desc, buyer, variants) as buyers
      from buyer_rows group by name
  ), item_rows as (
    select name,
           coalesce(sum(qty) filter (where is_paid), 0)::bigint as qty,
           coalesce(sum(original * qty) filter (where is_paid), 0) as original_total,
           coalesce(sum(interest * qty) filter (where is_paid), 0) as interest_total,
           coalesce(sum(qty) filter (where not is_paid), 0)::bigint as unpaid_qty,
           coalesce(sum((original + interest) * qty) filter (where not is_paid), 0) as unpaid_total
      from lines group by name
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'qty', r.qty,
             'original_total', r.original_total, 'interest_total', r.interest_total,
             'overall', r.original_total + r.interest_total,
             'unpaid_qty', r.unpaid_qty, 'unpaid_total', r.unpaid_total,
             'buyers', coalesce(b.buyers, '[]'::jsonb))
           order by r.original_total + r.interest_total desc, r.name), '[]'::jsonb)
    into v_items
    from item_rows r left join item_buyers b on b.name = r.name;

  return jsonb_build_object('ok', true, 'seller', v_seller, 'items', v_items,
    'scoped_seller', v_scope, 'as_of', now());
end;
$$;

grant execute on function public.seller_buyers(uuid, text) to anon, authenticated;

-- ===================================================================
-- support_identify: the order number is now REQUIRED. A mobile number alone
-- no longer opens anyone's conversation; when both are given, the number
-- must belong to the order.
-- ===================================================================
create or replace function public.support_identify(p_order_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_key text;
  v_name text;
  v_phone text;
  v_thread public.support_threads%rowtype;
  v_given_phone text := nullif(btrim(coalesce(p_phone,'')),'');
begin
  if coalesce(btrim(p_order_code),'') = '' then
    return jsonb_build_object('ok', false, 'error',
      'Enter your order number. You will find it on your order confirmation.');
  end if;

  select * into v_order from public.orders
    where upper(btrim(order_code)) = upper(btrim(p_order_code))
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'We could not find that order number. Check it and try again.');
  end if;

  if v_given_phone is not null then
    -- The number must be the one the order was placed with.
    if right(regexp_replace(coalesce(v_order.phone,''), '\D', '', 'g'), 10)
       <> right(regexp_replace(v_given_phone, '\D', '', 'g'), 10) then
      return jsonb_build_object('ok', false, 'error',
        'That mobile number does not match this order. Check it and try again.');
    end if;
  end if;

  v_name := v_order.customer_name;
  v_phone := coalesce(v_order.phone, v_given_phone);
  -- Customers with a phone number are keyed by the number, as before; customers
  -- without one are keyed by their order number instead of their bare name, so
  -- two people called "Maria" can never land in each other's conversation.
  if coalesce(regexp_replace(coalesce(v_phone,''), '\D', '', 'g'), '') <> '' then
    v_key := public.support_key(v_phone, v_name);
  else
    v_key := 'o:' || upper(btrim(p_order_code));
  end if;

  select * into v_thread from public.support_threads where customer_key = v_key;
  if not found then
    insert into public.support_threads(customer_key, customer_name, phone)
    values (v_key, coalesce(nullif(btrim(v_name),''),'Customer'), v_phone)
    returning * into v_thread;
  else
    update public.support_threads
       set customer_name = coalesce(nullif(btrim(v_name),''), customer_name),
           phone = coalesce(v_phone, phone)
     where id = v_thread.id
     returning * into v_thread;
  end if;

  return jsonb_build_object('ok', true, 'thread',
    jsonb_build_object('id', v_thread.id, 'token', v_thread.customer_token,
                       'customer_name', v_thread.customer_name));
end;
$$;
