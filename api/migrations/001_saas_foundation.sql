create extension if not exists pgcrypto;

create type membership_role as enum ('owner','admin','manager','supervisor','cashier','stock');
create type membership_status as enum ('invited','active','suspended');
create type sale_status as enum ('draft','completed','partially_refunded','refunded','voided');
create type payment_status as enum ('pending','completed','failed','refunded');
create type stock_movement_type as enum ('opening','sale','refund','receipt','adjustment','transfer_in','transfer_out','stocktake');

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  currency char(3) not null default 'GBP',
  timezone text not null default 'Europe/London',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plans (
  id text primary key,
  name text not null,
  monthly_price numeric(12,2) not null check (monthly_price >= 0),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  plan_id text not null references plans(id),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  status text not null check (status in ('trialing','active','past_due','cancelled')),
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id), unique nulls not distinct (provider,provider_subscription_id)
);
create index subscriptions_organisation_id_idx on subscriptions(organisation_id);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text not null,
  mfa_enabled boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint users_email_lowercase check (email = lower(email)),
  constraint users_email_unique unique (email)
);

create table organisation_memberships (
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role membership_role not null,
  status membership_status not null default 'invited',
  pin_hash text,
  created_at timestamptz not null default now(),
  primary key (organisation_id,user_id)
);
create index organisation_memberships_user_id_idx on organisation_memberships(user_id);

create table locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null,
  code text not null,
  address jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id,code), unique (organisation_id,id)
);
create index locations_organisation_id_idx on locations(organisation_id);

create table tills (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  location_id uuid not null,
  name text not null,
  device_key_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (organisation_id,location_id) references locations(organisation_id,id) on delete cascade,
  unique (organisation_id,id), unique (organisation_id,location_id,name)
);
create index tills_organisation_id_idx on tills(organisation_id);
create index tills_location_id_idx on tills(location_id);

create table categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  parent_id uuid,
  name text not null,
  display_order integer not null default 0,
  tax_rate numeric(5,2) not null default 20 check (tax_rate between 0 and 100),
  target_margin numeric(5,2) check (target_margin between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (organisation_id,parent_id) references categories(organisation_id,id),
  unique (organisation_id,id), unique (organisation_id,parent_id,name)
);
create index categories_organisation_id_idx on categories(organisation_id);
create index categories_parent_id_idx on categories(parent_id);

create table products (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  category_id uuid,
  sku text not null,
  name text not null,
  description text,
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  retail_price numeric(12,2) not null check (retail_price >= 0),
  tax_rate numeric(5,2) not null default 20 check (tax_rate between 0 and 100),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id,category_id) references categories(organisation_id,id),
  unique (organisation_id,id), unique (organisation_id,sku)
);
create index products_organisation_id_idx on products(organisation_id);
create index products_category_id_idx on products(category_id);
create index products_active_idx on products(organisation_id,active) where active;

create table product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  product_id uuid not null,
  gtin text not null check (gtin ~ '^(\d{8}|\d{12,14})$'),
  is_primary boolean not null default false,
  foreign key (organisation_id,product_id) references products(organisation_id,id) on delete cascade,
  unique (organisation_id,gtin)
);
create index product_barcodes_organisation_id_idx on product_barcodes(organisation_id);
create index product_barcodes_product_id_idx on product_barcodes(product_id);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  email text,
  phone text,
  display_name text not null,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id,id), unique nulls not distinct (organisation_id,email)
);
create index customers_organisation_id_idx on customers(organisation_id);

create table sales (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  location_id uuid not null,
  till_id uuid not null,
  staff_user_id uuid not null references users(id),
  customer_id uuid,
  receipt_number bigint generated always as identity,
  status sale_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organisation_id,location_id) references locations(organisation_id,id),
  foreign key (organisation_id,till_id) references tills(organisation_id,id),
  foreign key (organisation_id,customer_id) references customers(organisation_id,id),
  unique (organisation_id,id), unique (organisation_id,receipt_number)
);
create index sales_organisation_id_idx on sales(organisation_id);
create index sales_location_id_idx on sales(location_id);
create index sales_till_id_idx on sales(till_id);
create index sales_staff_user_id_idx on sales(staff_user_id);
create index sales_customer_id_idx on sales(customer_id);
create index sales_completed_at_idx on sales(organisation_id,completed_at desc) where completed_at is not null;

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  sale_id uuid not null,
  product_id uuid not null,
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  line_total numeric(12,2) not null check (line_total >= 0),
  foreign key (organisation_id,sale_id) references sales(organisation_id,id),
  foreign key (organisation_id,product_id) references products(organisation_id,id)
);
create index sale_items_organisation_id_idx on sale_items(organisation_id);
create index sale_items_sale_id_idx on sale_items(sale_id);
create index sale_items_product_id_idx on sale_items(product_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  sale_id uuid not null,
  method text not null check (method in ('cash','card','voucher','store_credit','other')),
  provider text,
  provider_reference text,
  amount numeric(12,2) not null check (amount > 0),
  status payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  foreign key (organisation_id,sale_id) references sales(organisation_id,id)
);
create index payments_organisation_id_idx on payments(organisation_id);
create index payments_sale_id_idx on payments(sale_id);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  location_id uuid not null,
  product_id uuid not null,
  movement_type stock_movement_type not null,
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  foreign key (organisation_id,location_id) references locations(organisation_id,id),
  foreign key (organisation_id,product_id) references products(organisation_id,id)
);
create index inventory_movements_organisation_id_idx on inventory_movements(organisation_id);
create index inventory_movements_location_product_idx on inventory_movements(organisation_id,location_id,product_id,created_at);
create index inventory_movements_product_id_idx on inventory_movements(product_id);
create index inventory_movements_created_by_idx on inventory_movements(created_by);

create table loyalty_entries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  customer_id uuid not null,
  sale_id uuid,
  points_delta integer not null check (points_delta <> 0),
  reason text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organisation_id,customer_id) references customers(organisation_id,id),
  foreign key (organisation_id,sale_id) references sales(organisation_id,id)
);
create index loyalty_entries_organisation_id_idx on loyalty_entries(organisation_id);
create index loyalty_entries_customer_id_idx on loyalty_entries(customer_id);
create index loyalty_entries_sale_id_idx on loyalty_entries(sale_id);

create table audit_log (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references organisations(id) on delete restrict,
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_organisation_created_idx on audit_log(organisation_id,created_at desc);
create index audit_log_actor_user_id_idx on audit_log(actor_user_id);

create or replace function app_current_organisation_id() returns uuid language sql stable as $$ select nullif(current_setting('app.current_organisation_id',true),'')::uuid $$;
create or replace function app_current_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.current_user_id',true),'')::uuid $$;

alter table organisations enable row level security;
alter table organisations force row level security;
create policy tenant_isolation on organisations for all
  using (id = (select app_current_organisation_id()))
  with check (id = (select app_current_organisation_id()));

-- Organisation-scoped tables are protected in the database even if an API query omits a tenant predicate.
do $$ declare table_name text; begin
  foreach table_name in array array['subscriptions','organisation_memberships','locations','tills','categories','products','product_barcodes','customers','sales','sale_items','payments','inventory_movements','loyalty_entries','audit_log'] loop
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy tenant_isolation on %I for all using (organisation_id = (select app_current_organisation_id())) with check (organisation_id = (select app_current_organisation_id()))',table_name);
  end loop;
end $$;

create or replace function app_login_user(login_email text)
returns table(id uuid,email text,password_hash text,display_name text)
language sql security definer set search_path=''
as $$ select u.id,u.email,u.password_hash,u.display_name from public.users u where u.email=lower(login_email) and u.disabled_at is null limit 1 $$;

create or replace function app_user_organisations(target_user_id uuid)
returns table(id uuid,name text,slug text,role membership_role)
language sql security definer set search_path=''
as $$
  select o.id,o.name,o.slug,m.role from public.organisation_memberships m join public.organisations o on o.id=m.organisation_id
  where m.user_id=target_user_id and m.status='active' and target_user_id=public.app_current_user_id()
$$;

revoke all on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all functions in schema public from public;
grant usage on schema public to counter_app;
grant select on plans to counter_app;
grant select,insert,update on organisations,subscriptions,organisation_memberships,locations,tills,categories,products,product_barcodes,customers,sales,sale_items,payments,inventory_movements,loyalty_entries,audit_log to counter_app;
grant usage,select on all sequences in schema public to counter_app;
grant execute on function app_current_organisation_id(),app_current_user_id(),app_login_user(text),app_user_organisations(uuid) to counter_app;
