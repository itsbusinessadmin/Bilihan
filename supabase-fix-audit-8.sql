-- ===================================================================
-- Audit batch #12: receipt verification + seller-link visibility.
--
--  1. orders.receipt_drive_url — the client flow now writes the Drive link
--     here after a successful upload, so "receipt still uploading" is a
--     readable database fact instead of a browser-side guess.
--  2. customer_order_status(p_order_code, p_cancel_token) — lets the
--     customer's own browser re-read their order's live status (the order
--     list is RLS-blocked for customers). Access is by order_code plus the
--     per-order cancel_token, which only the customer who placed the order
--     ever sees, so one customer cannot read another's order.
--  3. list_seller_tokens() — admin-gated list of the per-seller share links
--     currently minted, so a stale link (seller renamed since) can be
--     spotted instead of silently reporting ₱0.
--
-- IMPORTANT: run this file in the Supabase SQL Editor BEFORE merging the
-- batch-12 code (the client calls customer_order_status when the order
-- dialog opens). Safe to re-run.
-- ===================================================================

alter table public.orders add column if not exists receipt_drive_url text;

-- The customer re-checks their own order's status. SECURITY DEFINER so the
-- RLS-blocked orders table is readable here, but only through the
-- order_code + cancel_token pair the customer received at checkout.
create or replace function public.customer_order_status(
  p_order_code text,
  p_cancel_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if nullif(btrim(coalesce(p_order_code,'')),'') is null
     or nullif(btrim(coalesce(p_cancel_token,'')),'') is null then
    return jsonb_build_object('ok',false);
  end if;
  select * into v_order from public.orders
   where order_code = btrim(p_order_code)
     and cancel_token = p_cancel_token::uuid;
  if not found then
    return jsonb_build_object('ok',false);
  end if;
  return jsonb_build_object(
    'ok',true,
    'status',v_order.status,
    'receipt_url',v_order.receipt_drive_url
  );
exception when others then
  -- A malformed token (not a uuid) must read as "no such order", not a
  -- database error on the customer's screen.
  return jsonb_build_object('ok',false);
end;
$$;

grant execute on function public.customer_order_status(text,text) to anon, authenticated;

-- Which per-seller links exist right now. Admin only: the tokens are bearer
-- credentials for the seller dashboard.
create or replace function public.list_seller_tokens()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok',false,'error','Not authorized.');
  end if;
  return jsonb_build_object('ok',true,'tokens',coalesce(
    (select jsonb_agg(jsonb_build_object(
        'token',t.token,'seller_name',t.seller_name,'created_at',t.created_at)
       order by t.created_at desc)
     from public.seller_tokens t),
    '[]'::jsonb));
end;
$$;

grant execute on function public.list_seller_tokens() to authenticated;
