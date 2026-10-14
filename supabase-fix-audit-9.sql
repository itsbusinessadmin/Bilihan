-- ===================================================================
-- Audit batch #14: order sheet-sync visibility.
--
--  1. orders.sheet_synced_at — records when the order row was last confirmed
--     synced to the Google Sheet, so a token mismatch (or any other silent
--     sync failure) is a readable database fact instead of an invisible gap.
--  2. customer_order_status — redefined with 'sheet_synced_at' added to the
--     returned payload (identical to the batch-12 version otherwise), so the
--     storefront can warn when the sync has not confirmed in a while.
--
-- IMPORTANT: run this file in the Supabase SQL Editor BEFORE merging the
-- batch-14 code (the new client code reads sheet_synced_at). Safe to re-run.
-- ===================================================================

alter table public.orders add column if not exists sheet_synced_at timestamptz;

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
    'cancellation_reason',v_order.cancellation_reason,
    'receipt_url',v_order.receipt_drive_url,
    'sheet_synced_at',v_order.sheet_synced_at
  );
exception when others then
  -- A malformed token (not a uuid) must read as "no such order", not a
  -- database error on the customer's screen.
  return jsonb_build_object('ok',false);
end;
$$;

grant execute on function public.customer_order_status(text,text) to anon, authenticated;
