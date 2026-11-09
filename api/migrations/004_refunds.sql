create table refunds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  sale_id uuid not null,
  actor_user_id uuid not null references users(id),
  total numeric(12,2) not null check (total > 0),
  reason text not null check (char_length(reason) between 2 and 300),
  created_at timestamptz not null default now(),
  foreign key (organisation_id,sale_id) references sales(organisation_id,id),
  unique (organisation_id,id)
);
create index refunds_organisation_id_idx on refunds(organisation_id);
create index refunds_sale_id_idx on refunds(sale_id);

create table refund_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  refund_id uuid not null,
  sale_item_id uuid not null references sale_items(id),
  quantity numeric(12,3) not null check (quantity > 0),
  amount numeric(12,2) not null check (amount > 0),
  foreign key (organisation_id,refund_id) references refunds(organisation_id,id)
);
create index refund_items_organisation_id_idx on refund_items(organisation_id);
create index refund_items_refund_id_idx on refund_items(refund_id);
create index refund_items_sale_item_id_idx on refund_items(sale_item_id);

do $$ declare table_name text; begin
  foreach table_name in array array['refunds','refund_items'] loop
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy tenant_isolation on %I for all using (organisation_id = (select app_current_organisation_id())) with check (organisation_id = (select app_current_organisation_id()))',table_name);
  end loop;
end $$;
grant select,insert,update on refunds,refund_items to counter_app;
