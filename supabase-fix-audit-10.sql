-- ===================================================================
-- Hide / show products from the customer page.
--
--  products.is_hidden — set by the eye button beside Edit in Admin -> Products.
--  A hidden product stays in the catalog with its stock, price and seller
--  untouched, but the storefront leaves it off the menu entirely (unlike
--  is_available=false, which still shows the card as Sold Out).
--
-- Run this file in the Supabase SQL Editor before using the eye button.
-- Safe to re-run.
-- ===================================================================

alter table public.products add column if not exists is_hidden boolean not null default false;
