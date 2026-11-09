create table auth_sessions(
  id uuid primary key, user_id uuid not null references users(id), expires_at timestamptz not null,
  revoked_at timestamptz, parent_id uuid references auth_sessions(id), created_at timestamptz not null default now()
);
create index auth_sessions_user_idx on auth_sessions(user_id);
create table auth_security(
  user_id uuid primary key references users(id), secret text, pending_secret text,
  last_totp_step bigint not null default -1, reset_hash text, reset_expires_at timestamptz
);
create unique index auth_reset_hash_idx on auth_security(reset_hash) where reset_hash is not null;
revoke all on auth_sessions,auth_security from public,counter_app;

create function app_session_create(sid uuid,uid uuid,expiry timestamptz,parent uuid) returns void
language sql security definer set search_path='' as $$
  insert into public.auth_sessions(id,user_id,expires_at,parent_id) select sid,uid,expiry,parent
  where exists(select 1 from public.users where id=uid and disabled_at is null)
$$;
create function app_session_valid(sid uuid,uid uuid) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from public.auth_sessions s join public.users u on u.id=s.user_id
    where s.id=sid and s.user_id=uid and u.disabled_at is null and s.revoked_at is null and s.expires_at>now()
    and(s.parent_id is null or exists(select 1 from public.auth_sessions p where p.id=s.parent_id and p.revoked_at is null and p.expires_at>now())))
$$;
create function app_session_revoke(sid uuid,uid uuid,every_session boolean) returns void
language sql security definer set search_path='' as $$
  update public.auth_sessions set revoked_at=now() where user_id=uid and (every_session or id=sid or parent_id=sid)
$$;
create function app_auth_identity(uid uuid,org uuid) returns table(email text,display_name text,organisation_id uuid,organisation_name text,role membership_role)
language sql security definer set search_path='' as $$
  select u.email,u.display_name,m.organisation_id,o.name,m.role from public.users u
  join public.organisation_memberships m on m.user_id=u.id join public.organisations o on o.id=m.organisation_id
  where u.id=uid and u.disabled_at is null and m.status='active' and(org is null or m.organisation_id=org)
  order by m.created_at limit 1
$$;
create function app_security_get(uid uuid) returns table(secret text,pending_secret text,last_totp_step bigint)
language sql security definer set search_path='' as $$ select secret,pending_secret,last_totp_step from public.auth_security where user_id=uid $$;
create function app_mfa_prepare(uid uuid,encrypted text) returns void
language sql security definer set search_path='' as $$
  insert into public.auth_security(user_id,pending_secret) values(uid,encrypted) on conflict(user_id) do update set pending_secret=excluded.pending_secret
$$;
create function app_mfa_verify(uid uuid,step bigint,enrol boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.auth_security set last_totp_step=step,secret=case when enrol then pending_secret else secret end,pending_secret=case when enrol then null else pending_secret end
    where user_id=uid and step>last_totp_step and(case when enrol then pending_secret else secret end) is not null;
  return found;
end $$;
create function app_reset_request(login_email text,digest text) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid; begin
  select id into uid from public.users where email=lower(login_email) and disabled_at is null;
  if uid is null then return false;end if;
  insert into public.auth_security(user_id,reset_hash,reset_expires_at) values(uid,digest,now()+interval '20 minutes')
    on conflict(user_id) do update set reset_hash=excluded.reset_hash,reset_expires_at=excluded.reset_expires_at;
  return true;
end $$;
create function app_reset_complete(digest text,new_hash text) returns boolean
language plpgsql security definer set search_path='' as $$ declare uid uuid;begin
  update public.auth_security set reset_hash=null,reset_expires_at=null where reset_hash=digest and reset_expires_at>now() returning user_id into uid;
  if uid is null then return false;end if;
  update public.users set password_hash=new_hash where id=uid;
  update public.auth_sessions set revoked_at=now() where user_id=uid;
  return true;
end $$;
revoke all on function app_session_create(uuid,uuid,timestamptz,uuid),app_session_valid(uuid,uuid),app_session_revoke(uuid,uuid,boolean),app_auth_identity(uuid,uuid),app_security_get(uuid),app_mfa_prepare(uuid,text),app_mfa_verify(uuid,bigint,boolean),app_reset_request(text,text),app_reset_complete(text,text) from public;
grant execute on function app_session_create(uuid,uuid,timestamptz,uuid),app_session_valid(uuid,uuid),app_session_revoke(uuid,uuid,boolean),app_auth_identity(uuid,uuid),app_security_get(uuid),app_mfa_prepare(uuid,text),app_mfa_verify(uuid,bigint,boolean),app_reset_request(text,text),app_reset_complete(text,text) to counter_app;
