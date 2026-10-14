-- Bilihan audit fix batch #4 — 2026-10-14
-- Run this entire file ONCE in Supabase Dashboard -> SQL Editor,
-- AFTER supabase-setup.sql, supabase-coupons.sql, supabase-fix-audit-2.sql
-- and supabase-fix-audit-3.sql. Everything here is safe to re-run.
--
-- This file is SELF-CONTAINED: every function it fixes is defined here in
-- full with CREATE OR REPLACE, so it does not matter which earlier files
-- were run.
--
-- Fixes:
--  1. restore_order_inventory: a cancelled order's credit-coupon refund now
--     also flips the coupon back to 'active' when the refunded balance is
--     above zero. Before, the pesos came back but the coupon stayed 'used',
--     so the refunded credit could never be spent.
--  2. restore_order_inventory: a one-time percent coupon is only flipped back
--     to 'active' when it has not expired in the meantime, so the admin list
--     never shows a dead coupon as live.
--  3. cancel_order (customer): cancelling a Delivered/Completed order is now
--     refused, matching the admin rule — the goods have left the shop, so no
--     stock comes back and no coupon credit is refunded.
--  4. support_identify: customers without a phone number are now keyed by
--     their order number instead of their bare name, so two strangers called
--     "Maria" can never land in each other's chat.

-- ===================================================================
-- 1+2. Shared restore routine: stock + coupon credit for a cancelled order.
-- Called by cancel_order (customer), admin_set_order_status (admin) and
-- admin_delete_order (admin).
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
-- 3. Customer cancel: server-clock window, coupon + stock restore.
-- Signature is unchanged so existing clients keep working.
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
-- 4. Support identify: one thread per customer, never shared between
-- strangers. Customers with a phone number are keyed by the number, as
-- before; customers without one are now keyed by their order number instead
-- of their bare name, so two people called "Maria" can never land in each
-- other's conversation.
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

grant execute on function public.support_identify(text,text) to anon, authenticated;
