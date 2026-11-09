create table parked_baskets(
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references organisations(id) on delete cascade,
 staff_user_id uuid not null references users(id),customer_id uuid,items jsonb not null,redeem_points integer not null default 0,
 note text not null default '',created_at timestamptz not null default now(),
 foreign key(organisation_id,customer_id) references customers(organisation_id,id),unique(organisation_id,id)
);
create index parked_baskets_org_created_idx on parked_baskets(organisation_id,created_at desc);
alter table parked_baskets enable row level security;alter table parked_baskets force row level security;
create policy tenant_isolation on parked_baskets for all using(organisation_id=(select app_current_organisation_id())) with check(organisation_id=(select app_current_organisation_id()));
grant select,insert,update,delete on parked_baskets to counter_app;
