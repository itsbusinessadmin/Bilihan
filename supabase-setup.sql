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

-- Storefront configuration flags used by Store Settings and customer checkout.
-- Explicit NOT NULL defaults prevent missing/null settings from silently changing customer-facing options.
alter table public.store_settings add column if not exists show_delivery_address boolean not null default true;
alter table public.store_settings add column if not exists show_preferred_date boolean not null default true;
alter table public.store_settings add column if not exists preferred_date_mode text not null default 'calendar';
alter table public.store_settings add column if not exists order_available_from date;
alter table public.store_settings add column if not exists show_stock boolean not null default true;
alter table public.store_settings add column if not exists show_qr_payment boolean not null default true;
alter table public.store_settings add column if not exists show_cash_payment boolean not null default true;

-- Storefront identity and contact details surfaced in the customer footer.
-- All optional: the storefront hides any that are not set.
alter table public.store_settings add column if not exists logo_url text;
alter table public.store_settings add column if not exists email text;

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

  if v_thread.customer_unread > 0 then
    update public.support_threads set customer_unread = 0 where id = v_thread.id;
  end if;

  return jsonb_build_object('ok', true, 'customer_name', v_thread.customer_name, 'messages', v_messages);
end;
$$;

-- Unread count only: cheap enough to poll for the button badge.
create or replace function public.support_unread(p_thread_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  select customer_unread into v_count from public.support_threads
    where id = p_thread_id and customer_token = p_token;
  if v_count is null then
    return jsonb_build_object('ok', false, 'unread', 0);
  end if;
  return jsonb_build_object('ok', true, 'unread', v_count);
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
  update public.support_threads set admin_unread = 0 where id = p_thread_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.support_identify(text,text) to anon, authenticated;
grant execute on function public.support_fetch(uuid,uuid) to anon, authenticated;
grant execute on function public.support_unread(uuid,uuid) to anon, authenticated;
grant execute on function public.support_send(uuid,uuid,text) to anon, authenticated;
grant execute on function public.support_admin_reply(uuid,text) to authenticated;
grant execute on function public.support_admin_mark_read(uuid) to authenticated;

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

-- No public policy at all: customers reach their conversation only through the
-- functions above, which require the thread token. Admins read and write directly.
drop policy if exists "admins manage support threads" on public.support_threads;
create policy "admins manage support threads" on public.support_threads for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage support messages" on public.support_messages;
create policy "admins manage support messages" on public.support_messages for all using (public.is_admin()) with check (public.is_admin());
