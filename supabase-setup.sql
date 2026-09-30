-- Bilihan v3 Supabase setup
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete restrict,
  name text not null,
  description text not null default '',
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who supplies the product. Free text because the store's sellers are colleagues,
-- not accounts: there is nothing to join to, and a name typed once is enough to
-- group a seller's items together on the dashboard and the seller page.
alter table public.products add column if not exists seller_name text not null default '';

create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'Bilihan',
  phone text not null default '+63 900 000 0000',
  messenger_url text not null default 'https://m.me/',
  instagram_url text not null default 'https://instagram.com/',
  pickup_location text not null default 'Your pickup location here',
  qr_image_url text,
  hero_title text not null default 'Good food, made easy.',
  hero_tagline text not null default 'From everyday favorites to satisfying cravings, find something good at Bilihan.',
  hero_images text[] not null default '{}',
  about_text text not null default 'Bilihan is your easy online food stop for everyday favorites, cravings, meals, snacks, and more.',
  about_image_url text,
  updated_at timestamptz not null default now()
);

-- Storefront configuration flags used by Store Settings and customer checkout.
-- Explicit NOT NULL defaults prevent missing/null settings from silently changing customer-facing options.
alter table public.store_settings add column if not exists show_delivery_address boolean not null default true;
alter table public.store_settings add column if not exists show_preferred_date boolean not null default true;
alter table public.store_settings add column if not exists preferred_date_mode text not null default 'calendar';
alter table public.store_settings add column if not exists order_available_from date;
alter table public.store_settings add column if not exists show_stock boolean not null default true;
alter table public.store_settings add column if not exists show_qr_payment boolean not null default true;
-- "Paid Already": the QR still shows so the customer can pay, but instead of
-- uploading a screenshot they simply tick to say they have. Off by default,
-- because it trades proof of payment for a shorter checkout, and that is the
-- shop's call rather than something to inherit.
alter table public.store_settings add column if not exists show_paid_already boolean not null default false;
alter table public.store_settings add column if not exists show_cash_payment boolean not null default true;

-- Which contact fields checkout asks for, and whether they are compulsory. The
-- defaults are what the shop did before this existed: both shown, both optional.
-- A hidden field is never required, whatever its 'require' flag says — the customer
-- was never given the chance to fill it in.
alter table public.store_settings add column if not exists checkout_show_phone boolean not null default true;
alter table public.store_settings add column if not exists checkout_require_phone boolean not null default false;
alter table public.store_settings add column if not exists checkout_show_email boolean not null default true;
alter table public.store_settings add column if not exists checkout_require_email boolean not null default false;

-- Open or closed. The owner flips this from the dashboard: closed puts a notice
-- over the customer page instead of the shop, and place_order() below refuses an
-- order outright, so a tab left open before closing time cannot still check out.
-- Defaults to open, which is what every existing shop was before this existed.
alter table public.store_settings add column if not exists store_open boolean not null default true;
alter table public.store_settings add column if not exists closed_message text;

-- Storefront identity and contact details surfaced in the customer footer.
-- All optional: the storefront hides any that are not set.
alter table public.store_settings add column if not exists logo_url text;
alter table public.store_settings add column if not exists email text;

-- Which visual design the storefront wears. 'original' is the shipped Bilihan
-- look; 'storefront' is the imported "Bilihan Storefront" design. The owner
-- picks one in Admin -> Appearance. Light/dark mode is a separate, per-visitor
-- choice and keeps working under either design.
-- The constraint is dropped first so this file stays safe to re-run.
alter table public.store_settings add column if not exists storefront_skin text not null default 'original';
alter table public.store_settings drop constraint if exists store_settings_storefront_skin_check;
alter table public.store_settings add constraint store_settings_storefront_skin_check
  check (storefront_skin in ('original','storefront'));

-- Cost and markup. The admin has written these for a long time and the dashboard
-- reads them, but this file never created them, so a database set up from scratch
-- here had a products table the admin could not save to. Nullable, because the code
-- treats a missing original_price as "same as price".
alter table public.products add column if not exists original_price numeric(12,2);
alter table public.products add column if not exists interest numeric(12,2) not null default 0;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  cancel_token uuid not null default gen_random_uuid(),
  customer_name text not null,
  phone text,
  fulfillment text not null check (fulfillment in ('Delivery','Pickup')),
  address text,
  preferred_date date not null,
  payment_method text not null check (payment_method in ('QR Payment','Cash on Delivery / Pickup')),
  note text,
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'New',
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

-- "Paid Already" joins the two methods this file shipped with. The constraint is
-- dropped first so the file stays safe to re-run, and so a database created by an
-- earlier version picks the new method up.
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('QR Payment','Cash on Delivery / Pickup','Paid Already'));

-- Whether the money has actually arrived, set by hand in Admin -> Orders. This
-- lived only in the live database until now, which meant a shop set up from this
-- file had a column the admin wrote to and nothing had created.
alter table public.orders add column if not exists payment_status text not null default 'Pending';
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('Paid','Pending','Not Paid'));

-- If you already ran an earlier version of this file where phone was NOT NULL,
-- this line makes it optional on an existing table. Safe to run even if the
-- table was just created above with phone already nullable.
alter table public.orders alter column phone drop not null;

-- Optional: the customer leaves an address here to get an order confirmation by
-- email. Blank when they would rather not give one.
alter table public.orders add column if not exists email text;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null,
  qty integer not null check (qty > 0)
);

-- What the customer picked on each line, and the price split as it stood when the
-- order was placed. Recorded here rather than read back off the product later:
-- a product whose price or variants change afterwards would otherwise rewrite the
-- history of every sale it was ever part of.
alter table public.order_items add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.order_items add column if not exists unit_original_price numeric(12,2);
alter table public.order_items add column if not exists unit_interest numeric(12,2);
-- The seller as it stood at order time, for the same reason: reassigning a product
-- to somebody else should not move last month's sales along with it. Null means the
-- line predates this column, and the product's current seller is used instead.
alter table public.order_items add column if not exists seller_name text;

-- PostgreSQL does not index a foreign key for you, and these two are on the hot path
-- of nearly everything: the admin reads every order with its lines embedded, the
-- seller page joins the two tables on every poll, deleting an order cascades to its
-- lines, and deleting a product nulls the product_id on every line that mentions it.
-- Without these each of those was a sequential scan of the whole table.
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_product_idx on public.order_items(product_id);
-- The admin lists orders newest first, and this is the column it sorts on.
create index if not exists orders_recent_idx on public.orders(created_at desc);

-- ===================================================================
-- Product variants
--
-- A group is one question the customer answers ("Size", "Toppings"); an option
-- is one answer. The admin picks the group's type from a fixed list rather than
-- typing it, so two products never end up with "Toppings" and "toppings".
--
-- price_mode says what the option's amount means:
--   'add'      the amount is added to the product's price (a topping, an extra)
--   'absolute' the amount IS the price (a flavour sold at its own price)
-- ===================================================================
create table if not exists public.product_variant_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_type text not null,
  label text not null,
  price_mode text not null default 'add',
  selection text not null default 'single',
  is_required boolean not null default false,
  sort_order integer not null default 0
);
alter table public.product_variant_groups drop constraint if exists product_variant_groups_price_mode_check;
alter table public.product_variant_groups add constraint product_variant_groups_price_mode_check
  check (price_mode in ('add','absolute'));
alter table public.product_variant_groups drop constraint if exists product_variant_groups_selection_check;
alter table public.product_variant_groups add constraint product_variant_groups_selection_check
  check (selection in ('single','multi'));

-- At most one group per product may set the whole price. Two of them would
-- contradict each other and there is no sensible answer for which one wins.
create unique index if not exists product_variant_one_absolute_group
  on public.product_variant_groups(product_id) where price_mode = 'absolute';

create table if not exists public.product_variant_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_variant_groups(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0
);
create index if not exists product_variant_groups_product_idx on public.product_variant_groups(product_id, sort_order);
create index if not exists product_variant_options_group_idx on public.product_variant_options(group_id, sort_order);

insert into public.store_settings (id, hero_images, about_image_url)
values (
  1,
  array[
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1600&q=80',
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1600&q=80'
  ],
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1400&q=80'
)
on conflict (id) do nothing;

-- Small starter catalog. Safe to remove after setup.
insert into public.categories (name, sort_order)
values ('Meals',1),('Snacks',2),('Drinks',3),('Desserts',4)
on conflict (name) do nothing;

insert into public.products (category_id,name,description,price,stock,is_available,sort_order,image_url)
select c.id,'Loaded Fries','Crispy fries loaded with savory toppings.',110,20,true,1,'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=1000&q=80'
from public.categories c where c.name='Snacks'
and not exists (select 1 from public.products where name='Loaded Fries');

-- Updated timestamp helper.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists trg_settings_updated on public.store_settings;
create trigger trg_settings_updated before update on public.store_settings
for each row execute function public.touch_updated_at();

-- Admin helper used by RLS and the web admin app.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Customer order placement. Security definer lets customers call one safe transaction
-- without direct INSERT/UPDATE permission on order or product tables.
-- NOTE: phone number is OPTIONAL. Only customer_name is required.
-- Adding a parameter makes a NEW signature rather than replacing the old one, so
-- the previous eight-argument version is dropped first. Without this both would
-- exist and the old one would quietly keep saving orders with no email.
drop function if exists public.place_order(text,text,text,text,date,text,text,jsonb);

create or replace function public.place_order(
  p_customer_name text,
  p_phone text,
  p_email text,
  p_fulfillment text,
  p_address text,
  p_preferred_date date,
  p_payment_method text,
  p_note text,
  p_items jsonb
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
  v_known integer;
  v_unit_original numeric(12,2);
  v_unit_interest numeric(12,2);
  v_needed integer;
  v_phone text;
  v_email text;
  v_cfg public.store_settings%rowtype;
begin
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

      select coalesce(sum(case when v_group.price_mode = 'add' then o.amount else 0 end),0),
             max(case when v_group.price_mode = 'absolute' then o.amount else null end),
             coalesce(jsonb_agg(jsonb_build_object('group',v_group.label,'label',o.label,
                                                   'amount',o.amount,'price_mode',v_group.price_mode)
                      order by o.sort_order, o.label), '[]'::jsonb)
        into v_picked, v_absolute, v_group_rows
        from public.product_variant_options o
       where o.group_id = v_group.id and o.id = any(v_option_ids);
      -- v_picked is reused here as the group's add-on subtotal.
      v_addon := v_addon + coalesce(v_picked,0);
      if v_absolute is not null then v_unit := v_absolute; end if;
      v_chosen := v_chosen || v_group_rows;
    end loop;

    -- An 'absolute' option replaces the product's price; add-ons stack on top of
    -- whichever of the two is in play.
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

  insert into public.orders(id,order_code,cancel_token,customer_name,phone,email,fulfillment,address,preferred_date,payment_method,note,total,status)
  values(v_order_id,v_code,v_token,trim(p_customer_name),v_phone,v_email,p_fulfillment,case when p_fulfillment='Delivery' then trim(p_address) else null end,p_preferred_date,p_payment_method,nullif(trim(p_note),''),v_total,'New');

  for v_item in select * from jsonb_array_elements(v_items_out)
  loop
    insert into public.order_items(order_id,product_id,product_name,unit_price,qty,variants,unit_original_price,unit_interest,seller_name)
    values(v_order_id,(v_item->>'product_id')::uuid,v_item->>'product_name',(v_item->>'unit_price')::numeric,(v_item->>'qty')::integer,
           coalesce(v_item->'variants','[]'::jsonb),(v_item->>'unit_original_price')::numeric,(v_item->>'unit_interest')::numeric,
           nullif(v_item->>'seller_name',''));
    update public.products
      set stock = stock - (v_item->>'qty')::integer,
          is_available = case when stock - (v_item->>'qty')::integer > 0 then is_available else false end
      where id=(v_item->>'product_id')::uuid;
  end loop;

  return jsonb_build_object('ok',true,'order',jsonb_build_object(
    'id',v_order_id,'order_code',v_code,'cancel_token',v_token,'customer_name',trim(p_customer_name),'phone',v_phone,'email',v_email,
    'fulfillment',p_fulfillment,'address',case when p_fulfillment='Delivery' then trim(p_address) else null end,
    'preferred_date',p_preferred_date,'payment_method',p_payment_method,'note',nullif(trim(p_note),''),'total',v_total,'status','New',
    'created_at',now(),'items',v_items_out
  ));
exception when others then
  raise;
end;
$$;

grant execute on function public.place_order(text,text,text,text,text,date,text,text,jsonb) to anon, authenticated;

-- Customer cancellation using the private token stored only in that customer's browser.
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
  v_item public.order_items%rowtype;
begin
  if coalesce(trim(p_reason),'')='' then return jsonb_build_object('ok',false,'error','Cancellation reason is required.'); end if;
  select * into v_order from public.orders where order_code=p_order_code and cancel_token=p_cancel_token for update;
  if not found then return jsonb_build_object('ok',false,'error','Order not found.'); end if;
  if v_order.status='Cancelled' then return jsonb_build_object('ok',true); end if;
  if p_requested_at > v_order.created_at + interval '3 hours' then return jsonb_build_object('ok',false,'error','The 3-hour cancellation window has expired.'); end if;
  if p_requested_at < v_order.created_at - interval '5 minutes' then return jsonb_build_object('ok',false,'error','Invalid cancellation request time.'); end if;

  update public.orders set status='Cancelled',cancellation_reason=trim(p_reason),cancelled_at=now() where id=v_order.id;
  for v_item in select * from public.order_items where order_id=v_order.id
  loop
    if v_item.product_id is not null then
      update public.products set stock=stock+v_item.qty,is_available=true where id=v_item.product_id;
    end if;
  end loop;
  return jsonb_build_object('ok',true);
end;
$$;

grant execute on function public.cancel_order(text,uuid,text,timestamptz) to anon, authenticated;

-- RLS
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.store_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Recreate policies safely.
drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories for select using (true);
drop policy if exists "public read products" on public.products;
create policy "public read products" on public.products for select using (true);
drop policy if exists "public read settings" on public.store_settings;
create policy "public read settings" on public.store_settings for select using (true);

drop policy if exists "admins manage categories" on public.categories;
create policy "admins manage categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage settings" on public.store_settings;
create policy "admins manage settings" on public.store_settings for all using (public.is_admin()) with check (public.is_admin());
-- Seller link: one shared secret that lets someone open the read-only sales page
-- without an account. Deliberately NOT a column on store_settings, which anyone can
-- read, since that would hand the token to every visitor. Nothing but the admin can
-- read this table, and seller_sales() checks the token with definer rights.
create table if not exists public.seller_links (
  id integer primary key default 1 check (id = 1),
  token uuid not null default gen_random_uuid(),
  rotated_at timestamptz not null default now()
);
insert into public.seller_links(id) values (1) on conflict (id) do nothing;

alter table public.seller_links enable row level security;
drop policy if exists "admins manage seller link" on public.seller_links;
create policy "admins manage seller link" on public.seller_links for all using (public.is_admin()) with check (public.is_admin());
-- No public select policy on purpose: the token is what the link is worth.

-- Variants are read by the storefront and written only by the admin. They sit
-- here rather than beside their tables because is_admin() is defined further up
-- the file, and a policy cannot name a function that does not exist yet.
alter table public.product_variant_groups enable row level security;
alter table public.product_variant_options enable row level security;
drop policy if exists "public read variant groups" on public.product_variant_groups;
create policy "public read variant groups" on public.product_variant_groups for select using (true);
drop policy if exists "admins manage variant groups" on public.product_variant_groups;
create policy "admins manage variant groups" on public.product_variant_groups for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "public read variant options" on public.product_variant_options;
create policy "public read variant options" on public.product_variant_options for select using (true);
drop policy if exists "admins manage variant options" on public.product_variant_options;
create policy "admins manage variant options" on public.product_variant_options for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage order items" on public.order_items;
create policy "admins manage order items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin sees own membership" on public.admin_users;
create policy "admin sees own membership" on public.admin_users for select using (user_id=auth.uid());

-- ===================================================================
-- Live stock on the storefront
--
-- Supabase pushes row changes down a websocket, but only for tables in this
-- publication. Without it the storefront sees nothing until the next reload.
-- Only products is published: orders, customers and messages have no business
-- being broadcast to every browser on the site.
-- ===================================================================
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  -- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member,
  -- so it is checked first and this file stays safe to re-run.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end $$;

-- Storage buckets for no-code image uploads.
insert into storage.buckets(id,name,public) values ('product-images','product-images',true) on conflict (id) do update set public=true;
insert into storage.buckets(id,name,public) values ('store-assets','store-assets',true) on conflict (id) do update set public=true;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects for select using (bucket_id='product-images');
drop policy if exists "public read store assets" on storage.objects;
create policy "public read store assets" on storage.objects for select using (bucket_id='store-assets');
drop policy if exists "admins upload product images" on storage.objects;
create policy "admins upload product images" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.is_admin());
drop policy if exists "admins update product images" on storage.objects;
create policy "admins update product images" on storage.objects for update to authenticated using (bucket_id='product-images' and public.is_admin()) with check (bucket_id='product-images' and public.is_admin());
drop policy if exists "admins delete product images" on storage.objects;
create policy "admins delete product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.is_admin());
drop policy if exists "admins upload store assets" on storage.objects;
create policy "admins upload store assets" on storage.objects for insert to authenticated with check (bucket_id='store-assets' and public.is_admin());
drop policy if exists "admins update store assets" on storage.objects;
create policy "admins update store assets" on storage.objects for update to authenticated using (bucket_id='store-assets' and public.is_admin()) with check (bucket_id='store-assets' and public.is_admin());
drop policy if exists "admins delete store assets" on storage.objects;
create policy "admins delete store assets" on storage.objects for delete to authenticated using (bucket_id='store-assets' and public.is_admin());

-- IMPORTANT: after you create your Auth user, run this ONE line separately using the UUID from Authentication -> Users:
-- insert into public.admin_users(user_id) values ('YOUR-AUTH-USER-UUID');

-- ===================================================================
-- Customer support chat
--
-- One thread per customer, keyed on their phone number when they gave one and
-- on their name otherwise, so several orders from the same person land in a
-- single conversation.
--
-- The public site never reads these tables directly. Everything goes through
-- security-definer functions, and after the first identification the browser
-- holds a per-thread token that authorises every later call. That token, not
-- the order number, is what keeps the conversation private from then on.
-- ===================================================================

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,
  customer_token uuid not null default gen_random_uuid(),
  customer_name text not null default 'Customer',
  phone text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  admin_unread integer not null default 0,
  customer_unread integer not null default 0
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender text not null check (sender in ('customer','admin')),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx on public.support_messages(thread_id, created_at);
-- Read receipts. Each side stamps when it last had the conversation open, so the
-- other side can show a "Seen" marker under its own last message. Null means that
-- side has never opened the thread, which reads as "not seen yet".
alter table public.support_threads add column if not exists admin_last_read_at timestamptz;
alter table public.support_threads add column if not exists customer_last_read_at timestamptz;

create index if not exists support_threads_recent_idx on public.support_threads(last_message_at desc);


-- Normalises the key both sides resolve a customer to.
create or replace function public.support_key(p_phone text, p_name text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), '') <> ''
      then 'p:' || right(regexp_replace(p_phone, '\D', '', 'g'), 10)
    else 'n:' || lower(btrim(coalesce(p_name,'Customer')))
  end;
$$;

-- Finds the customer from an order number or a phone number and returns their
-- thread, creating it on first contact. Order numbers match case-insensitively.
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
begin
  if coalesce(btrim(p_order_code),'') <> '' then
    select * into v_order from public.orders
      where upper(btrim(order_code)) = upper(btrim(p_order_code))
      order by created_at desc limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'We could not find that order number. Check it and try again.');
    end if;
    v_name := v_order.customer_name;
    v_phone := v_order.phone;
  elsif coalesce(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'),'') <> '' then
    select * into v_order from public.orders
      where right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10)
          = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
      order by created_at desc limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'We could not find an order for that number. Check it and try again.');
    end if;
    v_name := v_order.customer_name;
    v_phone := coalesce(v_order.phone, p_phone);
  else
    return jsonb_build_object('ok', false, 'error', 'Enter your order number or the mobile number you ordered with.');
  end if;

  v_key := public.support_key(v_phone, v_name);

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

-- Returns the conversation and clears the customer's unread count.
create or replace function public.support_fetch(p_thread_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.support_threads%rowtype;
  v_messages jsonb;
begin
  select * into v_thread from public.support_threads
    where id = p_thread_id and customer_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This conversation is no longer available.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender,
           'body', m.body, 'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
    into v_messages
    from public.support_messages m where m.thread_id = v_thread.id;

  -- Stamped on every fetch, not only when something was unread: having the panel
  -- open is what "seen" means, and the admin's marker has to keep up with it.
  -- The guard keeps a half-second poll from writing this row twice a second; the
  -- receipt is still accurate to within two seconds, which no one can perceive.
  update public.support_threads
     set customer_unread = 0, customer_last_read_at = now()
   where id = v_thread.id
     and (customer_unread > 0
          or customer_last_read_at is null
          or customer_last_read_at < now() - interval '2 seconds');

  -- v_thread was read before that update and only customer columns changed, so this
  -- is still the admin's own last-read stamp.
  return jsonb_build_object('ok', true, 'customer_name', v_thread.customer_name,
    'messages', v_messages, 'admin_last_read_at', v_thread.admin_last_read_at);
end;
$$;

-- Unread count only: cheap enough to poll for the button badge.
create or replace function public.support_unread(p_thread_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.support_threads%rowtype;
begin
  select * into v_row from public.support_threads
    where id = p_thread_id and customer_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'unread', 0);
  end if;
  -- Carries the receipt too, so a closed panel still knows the admin has read up.
  return jsonb_build_object('ok', true, 'unread', v_row.customer_unread,
    'admin_last_read_at', v_row.admin_last_read_at);
end;
$$;

create or replace function public.support_send(p_thread_id uuid, p_token uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.support_threads%rowtype;
  v_body text := btrim(coalesce(p_body,''));
begin
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'Type a message first.');
  end if;
  if length(v_body) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'That message is too long.');
  end if;

  select * into v_thread from public.support_threads
    where id = p_thread_id and customer_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This conversation is no longer available.');
  end if;

  -- Light flood guard: at most 20 customer messages a minute on one thread.
  if (select count(*) from public.support_messages
        where thread_id = v_thread.id and sender = 'customer'
          and created_at > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'You are sending messages very quickly. Please wait a moment.');
  end if;

  insert into public.support_messages(thread_id, sender, body) values (v_thread.id, 'customer', v_body);
  update public.support_threads
     set admin_unread = admin_unread + 1, last_message_at = now()
   where id = v_thread.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Admin side. These check is_admin() rather than a token.
create or replace function public.support_admin_reply(p_thread_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_body text := btrim(coalesce(p_body,''));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Not authorised.');
  end if;
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'Type a reply first.');
  end if;

  insert into public.support_messages(thread_id, sender, body) values (p_thread_id, 'admin', v_body);
  update public.support_threads
     set customer_unread = customer_unread + 1, last_message_at = now()
   where id = p_thread_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.support_admin_mark_read(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Not authorised.');
  end if;
  update public.support_threads set admin_unread = 0, admin_last_read_at = now() where id = p_thread_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.support_identify(text,text) to anon, authenticated;
grant execute on function public.support_fetch(uuid,uuid) to anon, authenticated;
grant execute on function public.support_unread(uuid,uuid) to anon, authenticated;
grant execute on function public.support_send(uuid,uuid,text) to anon, authenticated;
grant execute on function public.support_admin_reply(uuid,text) to authenticated;
grant execute on function public.support_admin_mark_read(uuid) to authenticated;

-- Replace every choice a product offers, in one go.
--
-- The admin used to do this from the browser in three round trips: delete the groups,
-- insert the new ones, then insert their options against the ids that came back. Two
-- things were wrong with that. A blip between the delete and the insert left the
-- product with no choices at all, and a product whose Size was compulsory would then
-- sell with no size picked. And attaching the options relied on the insert returning
-- the new ids in the order they were sent, which PostgREST does not promise: the day
-- it did not, every option would land under the wrong question.
--
-- One call, one transaction, and the order written down rather than assumed. If
-- anything raises, the whole thing rolls back and the product keeps the choices it
-- already had.
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
    insert into public.product_variant_options(group_id, label, amount, sort_order)
    select v_group_id, btrim(o.value->>'label'),
           round(coalesce((o.value->>'amount')::numeric, 0), 2), o.ord
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

grant execute on function public.set_product_variants(uuid, jsonb) to authenticated;

-- A 32-character answer to "has anything the admin draws changed?".
--
-- The admin page re-read every order with every line on it every three seconds --
-- eight megabytes at four thousand orders, and almost always byte for byte the eight
-- megabytes before it. It asks this first now, and only pulls the data down when the
-- answer differs.
--
-- The digest is taken over whole rows rather than a chosen handful of columns, so
-- there is no field somebody adds later that this quietly stops noticing. order_items
-- are not listed on purpose: they are only ever written alongside their own order,
-- and the one thing that touches them on their own -- deleting a product, which nulls
-- their product_id -- moves the products digest anyway.
create or replace function public.admin_data_version()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if not public.is_admin() then return null; end if;
  select md5(concat_ws('|',
    (select md5(coalesce(string_agg(t, ','), '')) from (select o::text t from public.orders o order by o.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select p::text t from public.products p order by p.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select c::text t from public.categories c order by c.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select st::text t from public.store_settings st order by st.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select th::text t from public.support_threads th order by th.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select g::text t from public.product_variant_groups g order by g.id) q),
    (select md5(coalesce(string_agg(t, ','), '')) from (select vo::text t from public.product_variant_options vo order by vo.id) q),
    (select count(*)::text from public.support_messages)
  )) into v;
  return v;
end;
$$;

grant execute on function public.admin_data_version() to authenticated;

-- Every order line the seller page reports on, with the seller, the price split and
-- the buyer already worked out. Both functions below read it, so the rules for what
-- counts as a sale live in exactly one place.
--
-- NOT granted to anyone. It joins customer names to orders, and the only things
-- allowed to read it are the two security definer functions below, which run as this
-- view's owner and check the link token first. The revoke is belt and braces against
-- a database where default privileges would otherwise hand it to anon.
create or replace view public.seller_order_lines as
  select
    -- The seller recorded on the line wins, so moving a product to somebody else
    -- today does not rewrite who sold it last week. A line with nobody named at all
    -- is gathered under one heading rather than dropped.
    coalesce(nullif(btrim(coalesce(i.seller_name, p.seller_name)), ''), 'Unassigned') as seller,
    coalesce(nullif(btrim(i.product_name), ''), '(unnamed product)') as name,
    i.qty,
    -- The split recorded on the line wins. Only orders placed before that column
    -- existed fall back to the product's current figures, which is why a price
    -- change used to quietly re-value every past sale.
    coalesce(i.unit_original_price, p.original_price, i.unit_price) as original,
    coalesce(i.unit_interest, p.interest, 0) as interest,
    coalesce(nullif(btrim(o.customer_name), ''), 'Customer') as buyer,
    o.created_at,
    coalesce(nullif(btrim(o.payment_status), ''), 'Pending') as payment_status,
    -- Only settled money counts. Anything else is a record, not a sale.
    coalesce(nullif(btrim(o.payment_status), ''), 'Pending') = 'Paid' as is_paid,
    -- The choices as one readable line, kept in the order they were recorded: variant
    -- group order first, then option order within each group, which is the order the
    -- customer met them in on the page.
    coalesce((
      select string_agg(v.value->>'label', ', ' order by v.ord)
      from jsonb_array_elements(coalesce(i.variants, '[]'::jsonb)) with ordinality v(value, ord)
    ), '') as variants
  from public.order_items i
  join public.orders o on o.id = i.order_id and o.status <> 'Cancelled'
  -- lateral, not a plain join: two products sharing a name would otherwise duplicate
  -- the line and double-count the sale.
  left join lateral (
    select pr.original_price, pr.interest, pr.seller_name
    from public.products pr
    where (i.product_id is not null and pr.id = i.product_id)
       or (i.product_id is null and lower(btrim(pr.name)) = lower(btrim(i.product_name)))
    limit 1
  ) p on true;

revoke all on public.seller_order_lines from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then
    execute 'revoke all on public.seller_order_lines from anon';
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    execute 'revoke all on public.seller_order_lines from authenticated';
  end if;
end $$;

-- Read-only sales for the seller page: what each seller sold, and what each of their
-- items came to. This is what the page polls, so it carries totals only. Who bought
-- what is a separate call, made when somebody actually opens a seller -- nesting the
-- buyers in here made the reply three hundred times larger than the page needed
-- every few seconds, almost all of it never looked at.
--
-- Only orders marked Paid are counted. Anything still Pending or Not Paid is money
-- the shop has not taken, so it stays out of every total and is reported separately
-- as what is still owed.
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
begin
  if p_token is null
     or not exists (select 1 from public.seller_links where id = 1 and token = p_token) then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid. Ask the store for a new one.');
  end if;

  with item_rows as (
    select seller, name,
           coalesce(sum(qty) filter (where is_paid), 0)::bigint as qty,
           coalesce(sum(original * qty) filter (where is_paid), 0) as original_total,
           coalesce(sum(interest * qty) filter (where is_paid), 0) as interest_total,
           coalesce(sum(qty) filter (where not is_paid), 0)::bigint as unpaid_qty,
           coalesce(sum((original + interest) * qty) filter (where not is_paid), 0) as unpaid_total
      from public.seller_order_lines group by seller, name
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
  return jsonb_build_object('ok', true, 'items', v_rows, 'sellers', v_sellers,
                            'total_qty', v_qty,
                            'original', v_total, 'interest', v_interest,
                            'overall', v_total + v_interest,
                            'unpaid_qty', v_unpaid_qty, 'unpaid', v_unpaid,
                            'as_of', now());
end;
$$;

grant execute on function public.seller_sales(uuid) to anon, authenticated;

-- One seller's items with the buyers of each, for the window the seller page opens.
-- Asked for only when somebody opens that seller, and bounded to them.
--
-- A customer's first name and what they chose is as far as this goes: no phone, no
-- email, no address, no order code, nothing that would let the link be turned into a
-- customer list.
create or replace function public.seller_buyers(p_token uuid, p_seller text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_seller text := coalesce(nullif(btrim(p_seller), ''), 'Unassigned');
begin
  if p_token is null
     or not exists (select 1 from public.seller_links where id = 1 and token = p_token) then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid. Ask the store for a new one.');
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

  return jsonb_build_object('ok', true, 'seller', v_seller, 'items', v_items, 'as_of', now());
end;
$$;

grant execute on function public.seller_buyers(uuid, text) to anon, authenticated;

-- The seller page used to fetch one item's buyers at a time. seller_sales now returns
-- them nested under each item, so this second round trip has nothing left to do.
drop function if exists public.seller_item_buyers(uuid, text);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- No public policy at all: customers reach their conversation only through the
-- functions above, which require the thread token. Admins read and write directly.
drop policy if exists "admins manage support threads" on public.support_threads;
create policy "admins manage support threads" on public.support_threads for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage support messages" on public.support_messages;
create policy "admins manage support messages" on public.support_messages for all using (public.is_admin()) with check (public.is_admin());

-- ===================================================================
-- Usage and capacity reporting for the admin Security tab.
-- Admin-only. Reports real sizes so the owner can see what is filling the
-- free tier and which table is worth pruning.
-- ===================================================================
create or replace function public.admin_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tables jsonb := '[]'::jsonb;
  v_storage jsonb := '[]'::jsonb;
  v_db bigint := 0;
  r record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Not authorised.');
  end if;

  begin
    v_db := pg_database_size(current_database());
  exception when others then v_db := 0;
  end;

  -- Row counts and on-disk size for the tables that actually grow.
  for r in
    select c.relname as name,
           pg_total_relation_size(c.oid) as bytes,
           coalesce((select n_live_tup from pg_stat_user_tables s where s.relid = c.oid), 0) as approx_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('orders','order_items','products','categories','support_threads','support_messages','store_settings','admin_users')
     order by pg_total_relation_size(c.oid) desc
  loop
    v_tables := v_tables || jsonb_build_object('name', r.name, 'bytes', r.bytes, 'rows', r.approx_rows);
  end loop;

  -- Exact counts for the three the owner may want to prune.
  v_tables := jsonb_build_object('list', v_tables, 'exact', jsonb_build_object(
    'orders', (select count(*) from public.orders),
    'order_items', (select count(*) from public.order_items),
    'support_messages', (select count(*) from public.support_messages),
    'support_threads', (select count(*) from public.support_threads)
  ));

  -- Uploaded files, per bucket. Wrapped because storage lives outside this schema.
  begin
    select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'files', b.files, 'bytes', b.bytes) order by b.bytes desc), '[]'::jsonb)
      into v_storage
      from (
        select o.bucket_id,
               count(*) as files,
               coalesce(sum(nullif(o.metadata->>'size','')::bigint), 0) as bytes
          from storage.objects o
         group by o.bucket_id
      ) b;
  exception when others then
    v_storage := '[]'::jsonb;
  end;

  return jsonb_build_object('ok', true, 'database_bytes', v_db,
                            'tables', v_tables, 'storage', v_storage,
                            'measured_at', now());
end;
$$;

grant execute on function public.admin_usage() to authenticated;
