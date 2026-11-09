alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check check(status in('trialing','active','complimentary','past_due','paused','cancelling','cancelled'));
alter table subscriptions
  add column if not exists complimentary_until timestamptz,
  add column if not exists founding_price_ends_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists credit_balance numeric(12,2) not null default 0 check(credit_balance>=0),
  add column if not exists feature_overrides jsonb not null default '{}'::jsonb,
  add column if not exists override_expires_at timestamptz,
  add column if not exists override_reason text,
  add column if not exists support_access_enabled boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table platform_subscription_audit(
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references users(id),
  organisation_id uuid not null references organisations(id),
  action text not null,
  reason text not null check(char_length(reason) between 3 and 500),
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);
create index platform_subscription_audit_org_created_idx on platform_subscription_audit(organisation_id,created_at desc);

create or replace function app_effective_features(target_organisation uuid)
returns jsonb language sql security definer set search_path=''
as $$
  select p.features || case when s.override_expires_at is null or s.override_expires_at>now() then s.feature_overrides else '{}'::jsonb end
  from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organisation_id=target_organisation
$$;

create or replace function app_has_feature(target_organisation uuid,feature_name text)
returns boolean language sql security definer set search_path=''
as $$
  select case when s.status in('paused','past_due','cancelled') then false else coalesce((public.app_effective_features(target_organisation)->>feature_name)::boolean,false) end
  from public.subscriptions s where s.organisation_id=target_organisation
    and (s.status in('active','cancelling') or (s.status='complimentary' and (s.complimentary_until is null or s.complimentary_until>now())) or (s.status='trialing' and s.trial_ends_at>now()))
$$;

drop function if exists app_subscription(uuid);
create function app_subscription(target_organisation uuid)
returns table(plan_id text,plan_name text,status text,trial_ends_at timestamptz,features jsonb,limits jsonb,complimentary_until timestamptz,founding_price_ends_at timestamptz,cancel_at_period_end boolean,credit_balance numeric,support_access_enabled boolean)
language sql security definer set search_path=''
as $$
  select p.id,p.name,s.status,s.trial_ends_at,public.app_effective_features(target_organisation),p.limits,s.complimentary_until,s.founding_price_ends_at,s.cancel_at_period_end,s.credit_balance,s.support_access_enabled
  from public.subscriptions s join public.plans p on p.id=s.plan_id where s.organisation_id=target_organisation
$$;

create or replace function app_platform_subscriptions()
returns table(organisation_id uuid,organisation_name text,organisation_slug text,owner_email text,plan_id text,plan_name text,status text,trial_ends_at timestamptz,current_period_ends_at timestamptz,complimentary_until timestamptz,founding_price_ends_at timestamptz,cancel_at_period_end boolean,cancelled_at timestamptz,credit_balance numeric,feature_overrides jsonb,override_expires_at timestamptz,override_reason text,support_access_enabled boolean,created_at timestamptz)
language sql security definer set search_path=''
as $$
  select o.id,o.name,o.slug,(select u.email from public.organisation_memberships m join public.users u on u.id=m.user_id where m.organisation_id=o.id and m.role='owner' order by m.created_at limit 1),p.id,p.name,s.status,s.trial_ends_at,s.current_period_ends_at,s.complimentary_until,s.founding_price_ends_at,s.cancel_at_period_end,s.cancelled_at,s.credit_balance,s.feature_overrides,s.override_expires_at,s.override_reason,s.support_access_enabled,s.created_at
  from public.organisations o join public.subscriptions s on s.organisation_id=o.id join public.plans p on p.id=s.plan_id order by s.created_at desc
$$;

create or replace function app_platform_update_subscription(actor uuid,target_organisation uuid,new_plan text,new_status text,new_trial_end timestamptz,new_complimentary_until timestamptz,new_founding_end timestamptz,new_cancel_at_period_end boolean,credit_delta numeric,new_feature_overrides jsonb,new_override_end timestamptz,new_support_access boolean,change_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare before_row jsonb; after_row jsonb;
begin
  if length(trim(change_reason))<3 then raise exception 'A reason is required'; end if;
  if new_plan is not null and not exists(select 1 from public.plans where id=new_plan and active) then raise exception 'Plan is unavailable'; end if;
  if new_status is not null and new_status not in('trialing','active','complimentary','past_due','paused','cancelling','cancelled') then raise exception 'Invalid subscription status'; end if;
  select to_jsonb(s) into before_row from public.subscriptions s where s.organisation_id=target_organisation for update;
  if before_row is null then raise exception 'Subscription not found'; end if;
  update public.subscriptions s set
    plan_id=coalesce(new_plan,plan_id),status=coalesce(new_status,status),trial_ends_at=coalesce(new_trial_end,trial_ends_at),
    complimentary_until=case when new_status='complimentary' then new_complimentary_until when new_status is not null then null else complimentary_until end,
    founding_price_ends_at=coalesce(new_founding_end,founding_price_ends_at),cancel_at_period_end=coalesce(new_cancel_at_period_end,cancel_at_period_end),
    cancelled_at=case when new_status='cancelled' then now() when new_status is not null then null else cancelled_at end,
    paused_at=case when new_status='paused' then now() when new_status is not null then null else paused_at end,
    credit_balance=greatest(0,credit_balance+coalesce(credit_delta,0)),feature_overrides=coalesce(new_feature_overrides,feature_overrides),
    override_expires_at=case when new_feature_overrides is not null then new_override_end else override_expires_at end,
    override_reason=case when new_feature_overrides is not null then change_reason else override_reason end,
    support_access_enabled=coalesce(new_support_access,support_access_enabled),updated_at=now()
  where s.organisation_id=target_organisation returning to_jsonb(s) into after_row;
  insert into public.platform_subscription_audit(actor_user_id,organisation_id,action,reason,before_state,after_state) values(actor,target_organisation,'subscription.updated',trim(change_reason),before_row,after_row);
  return after_row;
end;
$$;

create or replace function app_platform_audit(target_organisation uuid)
returns table(id bigint,actor_name text,action text,reason text,before_state jsonb,after_state jsonb,created_at timestamptz)
language sql security definer set search_path=''
as $$ select a.id,u.display_name,a.action,a.reason,a.before_state,a.after_state,a.created_at from public.platform_subscription_audit a join public.users u on u.id=a.actor_user_id where a.organisation_id=target_organisation order by a.created_at desc limit 100 $$;

grant execute on function app_effective_features(uuid),app_subscription(uuid),app_platform_subscriptions(),app_platform_update_subscription(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,boolean,numeric,jsonb,timestamptz,boolean,text),app_platform_audit(uuid) to counter_app;
