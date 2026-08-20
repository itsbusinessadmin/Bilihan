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

-- If you already ran an earlier version of this file where phone was NOT NULL,
-- this line makes it optional on an existing table. Safe to run even if the
-- table was just created above with phone already nullable.
alter table public.orders alter column phone drop not null;

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null,
  qty integer not null check (qty > 0)
);

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
create or replace function public.place_order(
  p_customer_name text,
  p_phone text,
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
  v_phone text;
begin
  if coalesce(trim(p_customer_name),'') = '' then
    return jsonb_build_object('ok',false,'error','Name is required.');
  end if;

  -- Phone is optional: normalize blank/whitespace-only input to NULL.
  v_phone := nullif(trim(p_phone),'');

  if p_fulfillment not in ('Delivery','Pickup') then return jsonb_build_object('ok',false,'error','Invalid fulfillment method.'); end if;
  if p_fulfillment='Delivery' and coalesce(trim(p_address),'')='' then return jsonb_build_object('ok',false,'error','Delivery address is required.'); end if;
  if p_preferred_date < current_date then return jsonb_build_object('ok',false,'error','Preferred date cannot be in the past.'); end if;
  if p_payment_method not in ('QR Payment','Cash on Delivery / Pickup') then return jsonb_build_object('ok',false,'error','Invalid payment method.'); end if;
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
    if not v_product.is_available or v_product.stock < v_qty then
      return jsonb_build_object('ok',false,'error',v_product.name || ' no longer has enough stock.');
    end if;
    v_total := v_total + (v_product.price * v_qty);
    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,'product_name',v_product.name,'unit_price',v_product.price,'qty',v_qty
    ));
  end loop;

  insert into public.orders(id,order_code,cancel_token,customer_name,phone,fulfillment,address,preferred_date,payment_method,note,total,status)
  values(v_order_id,v_code,v_token,trim(p_customer_name),v_phone,p_fulfillment,case when p_fulfillment='Delivery' then trim(p_address) else null end,p_preferred_date,p_payment_method,nullif(trim(p_note),''),v_total,'New');

  for v_item in select * from jsonb_array_elements(v_items_out)
  loop
    insert into public.order_items(order_id,product_id,product_name,unit_price,qty)
    values(v_order_id,(v_item->>'product_id')::uuid,v_item->>'product_name',(v_item->>'unit_price')::numeric,(v_item->>'qty')::integer);
    update public.products
      set stock = stock - (v_item->>'qty')::integer,
          is_available = case when stock - (v_item->>'qty')::integer > 0 then is_available else false end
      where id=(v_item->>'product_id')::uuid;
  end loop;

  return jsonb_build_object('ok',true,'order',jsonb_build_object(
    'id',v_order_id,'order_code',v_code,'cancel_token',v_token,'customer_name',trim(p_customer_name),'phone',v_phone,
    'fulfillment',p_fulfillment,'address',case when p_fulfillment='Delivery' then trim(p_address) else null end,
    'preferred_date',p_preferred_date,'payment_method',p_payment_method,'note',nullif(trim(p_note),''),'total',v_total,'status','New',
    'created_at',now(),'items',v_items_out
  ));
exception when others then
  raise;
end;
$$;

grant execute on function public.place_order(text,text,text,text,date,text,text,jsonb) to anon, authenticated;

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
drop policy if exists "admins manage orders" on public.orders;
create policy "admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage order items" on public.order_items;
create policy "admins manage order items" on public.order_items for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin sees own membership" on public.admin_users;
create policy "admin sees own membership" on public.admin_users for select using (user_id=auth.uid());

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
