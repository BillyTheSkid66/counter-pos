create table product_families (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(name) between 1 and 160),
  brand text,
  size_label text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id,category_id) references categories(organisation_id,id),
  unique (organisation_id,id),
  unique (organisation_id,name,size_label)
);
create index product_families_organisation_id_idx on product_families(organisation_id);
create index product_families_category_id_idx on product_families(category_id);
create index product_families_active_idx on product_families(organisation_id,active) where active;

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  family_id uuid not null,
  sku text not null,
  display_name text not null,
  option_values jsonb not null default '{}'::jsonb,
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  retail_price numeric(12,2) not null check (retail_price >= 0),
  tax_rate numeric(5,2) not null default 20 check (tax_rate between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organisation_id,family_id) references product_families(organisation_id,id) on delete cascade,
  unique (organisation_id,id),
  unique (organisation_id,sku),
  unique (family_id,option_values)
);
create index product_variants_organisation_id_idx on product_variants(organisation_id);
create index product_variants_family_id_idx on product_variants(family_id);
create index product_variants_options_idx on product_variants using gin(option_values);

create table variant_barcodes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  variant_id uuid not null,
  gtin text not null check (gtin ~ '^(\d{8}|\d{12,14})$'),
  is_primary boolean not null default true,
  foreign key (organisation_id,variant_id) references product_variants(organisation_id,id) on delete cascade,
  unique (organisation_id,gtin)
);
create index variant_barcodes_organisation_id_idx on variant_barcodes(organisation_id);
create index variant_barcodes_variant_id_idx on variant_barcodes(variant_id);

create table variant_stock_balances (
  organisation_id uuid not null references organisations(id) on delete cascade,
  location_id uuid not null,
  variant_id uuid not null,
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (organisation_id,location_id,variant_id),
  foreign key (organisation_id,location_id) references locations(organisation_id,id) on delete cascade,
  foreign key (organisation_id,variant_id) references product_variants(organisation_id,id) on delete cascade
);
create index variant_stock_balances_variant_id_idx on variant_stock_balances(variant_id);

do $$ declare table_name text; begin
  foreach table_name in array array['product_families','product_variants','variant_barcodes','variant_stock_balances'] loop
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy tenant_isolation on %I for all using (organisation_id = (select app_current_organisation_id())) with check (organisation_id = (select app_current_organisation_id()))',table_name);
  end loop;
end $$;

grant select,insert,update on product_families,product_variants,variant_barcodes,variant_stock_balances to counter_app;
