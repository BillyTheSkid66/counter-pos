-- Multiple trials may have no billing-provider reference yet.
alter table subscriptions drop constraint subscriptions_provider_provider_subscription_id_key;
create unique index subscriptions_provider_reference_unique on subscriptions(provider,provider_subscription_id) where provider_subscription_id is not null;

create or replace function app_create_staff(staff_email text,staff_name text,staff_role membership_role,staff_pin text)
returns table(user_id uuid,email text,display_name text,role membership_role,status membership_status)
language plpgsql security definer set search_path=''
as $$
declare new_user uuid; org uuid:=public.app_current_organisation_id(); actor_role public.membership_role; existing_role public.membership_role;
begin
  select m.role into actor_role from public.organisation_memberships m where m.organisation_id=org and m.user_id=public.app_current_user_id() and m.status='active';
  if actor_role is null or actor_role not in('owner','admin','manager') then raise exception 'Manager access required';end if;
  if staff_role='owner' or (staff_role='admin' and actor_role='manager') then raise exception 'Insufficient permission for this staff role';end if;
  if staff_pin!~'^\d{4,8}$' then raise exception 'Invalid staff PIN';end if;
  select u.id into new_user from public.users u where u.email=lower(staff_email);
  if new_user is not null then
    select m.role into existing_role from public.organisation_memberships m where m.organisation_id=org and m.user_id=new_user;
    if existing_role is null then raise exception 'Existing accounts must not be claimed by another business';end if;
    if existing_role='owner' or (existing_role='admin' and actor_role='manager') then raise exception 'Insufficient permission to change this account';end if;
  else
    insert into public.users(email,password_hash,display_name) values(lower(staff_email),public.crypt(public.gen_random_uuid()::text,public.gen_salt('bf',12)),staff_name) returning id into new_user;
  end if;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,pin_hash) values(org,new_user,staff_role,'active',public.crypt(staff_pin,public.gen_salt('bf',12)))
    on conflict on constraint organisation_memberships_pkey do update set role=excluded.role,status='active',pin_hash=excluded.pin_hash;
  update public.auth_sessions set revoked_at=now() where auth_sessions.user_id=new_user;
  return query select u.id,u.email,u.display_name,m.role,m.status from public.users u join public.organisation_memberships m on m.user_id=u.id and m.organisation_id=org where u.id=new_user;
end $$;
