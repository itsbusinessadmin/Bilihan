-- ===================================================================
-- Audit batch #10: lock down restore_order_inventory.
--
-- This is the shared "give the stock and coupon value back" routine, meant to
-- run only inside a cancellation (cancel_order, admin_set_order_status,
-- admin_delete_order — all security definer, so they are unaffected by this).
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, which
-- Supabase exposes to anonymous callers. Without this revoke, any customer
-- could call restore_order_inventory directly with their own order id:
-- coupon credit comes back and the coupon flips to Active while the order
-- stays New (infinite coupon credit), and stock is added back with no cap.
--
-- No page or script calls this function directly — the refund path is only
-- reachable through the proper cancel and admin flows — so locking it down
-- breaks nothing.
--
-- Safe to re-run. Run this in the Supabase SQL Editor.
-- ===================================================================
-- PostgreSQL has no REVOKE ... IF EXISTS, so on a database where the earlier
-- fix files never ran the bare revoke fails loudly. Guard it: the function
-- either gets locked down or does not exist yet, and neither case errors.
do $$
begin
  if exists (select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'restore_order_inventory') then
    revoke execute on function public.restore_order_inventory(uuid) from public;
  end if;
end
$$;
