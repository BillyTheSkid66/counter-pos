create table loyalty_programs (
  organisation_id uuid primary key references organisations(id) on delete cascade,
  enabled boolean not null default true,
  points_per_pound integer not null default 1 check (points_per_pound between 1 and 100),
  reward_points integer not null default 500 check (reward_points between 1 and 1000000),
  reward_value numeric(12,2) not null default 5 check (reward_value > 0),
  welcome_bonus integer not null default 0 check (welcome_bonus between 0 and 1000000),
  expiry_months integer check (expiry_months between 1 and 120),
  updated_at timestamptz not null default now()
);

insert into loyalty_programs(organisation_id)
select id from organisations
on conflict do nothing;

alter table loyalty_programs enable row level security;
alter table loyalty_programs force row level security;
create policy tenant_isolation on loyalty_programs for all
  using (organisation_id = (select app_current_organisation_id()))
  with check (organisation_id = (select app_current_organisation_id()));

grant select,insert,update on loyalty_programs to counter_app;
