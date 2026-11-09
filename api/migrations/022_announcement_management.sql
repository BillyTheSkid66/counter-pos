alter table announcements add column audience text not null default 'all' check (audience in ('all','management','cashiers'));
alter table announcements add column expires_at timestamptz;
alter table announcements add column archived_at timestamptz;
alter table announcements add column updated_at timestamptz not null default now();
create index announcements_active_idx on announcements(organisation_id,created_at desc) where archived_at is null;

create table announcement_reads (
  organisation_id uuid not null references organisations(id) on delete cascade,
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (organisation_id,announcement_id,user_id),
  foreign key (organisation_id,announcement_id) references announcements(organisation_id,id)
);
create index announcement_reads_user_idx on announcement_reads(organisation_id,user_id,read_at desc);
alter table announcement_reads enable row level security;
alter table announcement_reads force row level security;
create policy tenant_isolation on announcement_reads for all using (organisation_id=(select app_current_organisation_id())) with check (organisation_id=(select app_current_organisation_id()));
grant select,insert,update,delete on announcement_reads to counter_app;
