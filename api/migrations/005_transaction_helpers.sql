create or replace function app_user_display_name(target_user_id uuid)
returns text language sql security definer set search_path=''
as $$ select display_name from public.users where id=target_user_id $$;

create or replace function app_approve_manager_pin(target_organisation_id uuid,target_user_id uuid,candidate_pin text)
returns boolean language sql security definer set search_path=''
as $$ select exists(select 1 from public.organisation_memberships m where m.organisation_id=target_organisation_id and m.user_id=target_user_id
  and m.status='active' and m.role in ('owner','admin','manager','supervisor') and m.pin_hash is not null
  and m.pin_hash=public.crypt(candidate_pin,m.pin_hash)) $$;

grant execute on function app_user_display_name(uuid),app_approve_manager_pin(uuid,uuid,text) to counter_app;
