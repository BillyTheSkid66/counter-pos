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
