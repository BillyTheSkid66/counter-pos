create table announcements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 2000),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (organisation_id,id)
);
create index announcements_org_created_idx on announcements(organisation_id,created_at desc);
alter table announcements enable row level security;
alter table announcements force row level security;
create policy tenant_isolation on announcements for all using (organisation_id=(select app_current_organisation_id())) with check (organisation_id=(select app_current_organisation_id()));
grant select,insert,update,delete on announcements to counter_app;
