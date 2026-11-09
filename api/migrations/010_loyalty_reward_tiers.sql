create table loyalty_reward_tiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  points_cost integer not null check (points_cost between 1 and 1000000),
  reward_value numeric(12,2) not null check (reward_value > 0),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organisation_id,id),
  unique (organisation_id,points_cost)
);
create index loyalty_reward_tiers_org_active_idx on loyalty_reward_tiers(organisation_id,active,display_order);
insert into loyalty_reward_tiers(organisation_id,name,points_cost,reward_value)
select organisation_id,reward_points||' point reward',reward_points,reward_value from loyalty_programs
on conflict do nothing;
alter table loyalty_reward_tiers enable row level security;
alter table loyalty_reward_tiers force row level security;
create policy tenant_isolation on loyalty_reward_tiers for all
  using (organisation_id=(select app_current_organisation_id()))
  with check (organisation_id=(select app_current_organisation_id()));
grant select,insert,update,delete on loyalty_reward_tiers to counter_app;
