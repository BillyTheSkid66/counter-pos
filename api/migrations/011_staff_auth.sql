create or replace function app_pin_login_user(login_email text,candidate_pin text)
returns table(user_id uuid,email text,display_name text,organisation_id uuid,organisation_name text,role membership_role)
language sql security definer set search_path=''
as $$
  select u.id,u.email,u.display_name,o.id,o.name,m.role
  from public.users u
  join public.organisation_memberships m on m.user_id=u.id
  join public.organisations o on o.id=m.organisation_id
  where u.email=lower(login_email) and u.disabled_at is null and m.status='active'
    and m.pin_hash is not null and m.pin_hash=public.crypt(candidate_pin,m.pin_hash)
  order by m.created_at limit 1
$$;

create or replace function app_org_staff()
returns table(user_id uuid,email text,display_name text,role membership_role,status membership_status,created_at timestamptz)
language sql security definer set search_path=''
as $$
  select u.id,u.email,u.display_name,m.role,m.status,m.created_at
  from public.organisation_memberships m join public.users u on u.id=m.user_id
  where m.organisation_id=public.app_current_organisation_id()
    and exists(select 1 from public.organisation_memberships me where me.organisation_id=m.organisation_id and me.user_id=public.app_current_user_id() and me.status='active')
  order by u.display_name
$$;

create or replace function app_create_staff(staff_email text,staff_name text,staff_role membership_role,staff_pin text)
returns table(user_id uuid,email text,display_name text,role membership_role,status membership_status)
language plpgsql security definer set search_path=''
as $$
declare new_user uuid; org uuid:=public.app_current_organisation_id();
begin
  if not exists(select 1 from public.organisation_memberships m where m.organisation_id=org and m.user_id=public.app_current_user_id() and m.status='active' and m.role in('owner','admin','manager')) then raise exception 'Manager access required'; end if;
  insert into public.users(email,password_hash,display_name) values(lower(staff_email),public.crypt(public.gen_random_uuid()::text,public.gen_salt('bf',10)),staff_name)
  on conflict on constraint users_email_unique do update set display_name=excluded.display_name returning id into new_user;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,pin_hash) values(org,new_user,staff_role,'active',public.crypt(staff_pin,public.gen_salt('bf',10)))
  on conflict on constraint organisation_memberships_pkey do update set role=excluded.role,status='active',pin_hash=excluded.pin_hash;
  return query select u.id,u.email,u.display_name,m.role,m.status from public.users u join public.organisation_memberships m on m.user_id=u.id and m.organisation_id=org where u.id=new_user;
end $$;

grant execute on function app_pin_login_user(text,text),app_org_staff(),app_create_staff(text,text,membership_role,text) to counter_app;
