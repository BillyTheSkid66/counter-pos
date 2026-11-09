alter table refunds add column refund_method text not null default 'original' check (refund_method in ('original','store_credit'));

create table store_credits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  code text not null,
  customer_id uuid,
  refund_id uuid,
  original_amount numeric(12,2) not null check (original_amount > 0),
  balance numeric(12,2) not null check (balance >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id,code),
  foreign key (organisation_id,customer_id) references customers(organisation_id,id),
  foreign key (organisation_id,refund_id) references refunds(organisation_id,id)
);
create index store_credits_org_code_idx on store_credits(organisation_id,code);
create index store_credits_customer_idx on store_credits(customer_id);
alter table store_credits enable row level security;
alter table store_credits force row level security;
create policy tenant_isolation on store_credits for all using (organisation_id=(select app_current_organisation_id())) with check (organisation_id=(select app_current_organisation_id()));
grant select,insert,update on store_credits to counter_app;
