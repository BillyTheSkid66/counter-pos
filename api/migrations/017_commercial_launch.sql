insert into plans(id,name,monthly_price,limits,features,active) values
  ('inventory','Inventory',9,'{"locations":1,"staff":5,"tills":0,"founding_months":12,"standard_price":15}','{"inventory":true,"purchasing":true,"pos":false,"customers":false,"loyalty":false,"reports":false}',true),
  ('counter','Counter',19,'{"locations":1,"staff":10,"tills":2,"founding_months":12,"standard_price":29}','{"inventory":true,"purchasing":true,"pos":true,"customers":true,"loyalty":false,"reports":false}',true),
  ('pro','Counter Pro',29,'{"locations":1,"staff":25,"tills":5,"founding_months":12,"standard_price":49}','{"inventory":true,"purchasing":true,"pos":true,"customers":true,"loyalty":true,"reports":true}',true)
on conflict(id) do update set name=excluded.name,monthly_price=excluded.monthly_price,limits=excluded.limits,features=excluded.features,active=true;

update plans set active=false where id in('starter','growth');

create or replace function app_public_plans()
returns table(id text,name text,monthly_price numeric,limits jsonb,features jsonb)
language sql security definer set search_path=''
as $$ select p.id,p.name,p.monthly_price,p.limits,p.features from public.plans p where p.active order by p.monthly_price $$;

create or replace function app_has_feature(target_organisation uuid,feature_name text)
returns boolean language sql security definer set search_path=''
as $$
  select coalesce((p.features->>feature_name)::boolean,false)
  from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.organisation_id=target_organisation
    and (s.status='active' or (s.status='trialing' and s.trial_ends_at>now()))
$$;

create or replace function app_subscription(target_organisation uuid)
returns table(plan_id text,plan_name text,status text,trial_ends_at timestamptz,features jsonb,limits jsonb)
language sql security definer set search_path=''
as $$
  select p.id,p.name,s.status,s.trial_ends_at,p.features,p.limits
  from public.subscriptions s join public.plans p on p.id=s.plan_id
  where s.organisation_id=target_organisation
$$;

create or replace function app_start_trial(business_name text,owner_email text,owner_name text,owner_pin text,selected_plan text,selected_template text)
returns table(user_id uuid,email text,display_name text,organisation_id uuid,organisation_name text,role membership_role,plan_id text,features jsonb,trial_ends_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  new_user uuid; new_org uuid; new_location uuid; chosen_features jsonb; trial_end timestamptz:=now()+interval '30 days';
  category_names text[];
begin
  if length(trim(business_name))<2 then raise exception 'Business name is required'; end if;
  if owner_email<>lower(owner_email) then owner_email:=lower(owner_email); end if;
  if owner_pin!~'^\d{4,8}$' then raise exception 'PIN must contain 4 to 8 digits'; end if;
  select p.features into chosen_features from public.plans p where p.id=selected_plan and p.active;
  if chosen_features is null then raise exception 'Selected plan is unavailable'; end if;
  if exists(select 1 from public.users u where u.email=owner_email) then raise exception 'An account already exists for this email'; end if;

  insert into public.organisations(name,slug,settings) values(
    trim(business_name),
    regexp_replace(lower(trim(business_name)),'[^a-z0-9]+','-','g')||'-'||substr(replace(public.gen_random_uuid()::text,'-',''),1,6),
    jsonb_build_object('template',selected_template,'trial',true)
  ) returning id into new_org;
  insert into public.users(email,password_hash,display_name) values(lower(owner_email),public.crypt(public.gen_random_uuid()::text,public.gen_salt('bf',10)),trim(owner_name)) returning id into new_user;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,pin_hash) values(new_org,new_user,'owner','active',public.crypt(owner_pin,public.gen_salt('bf',10)));
  insert into public.subscriptions(organisation_id,plan_id,provider,status,trial_ends_at) values(new_org,selected_plan,'trial','trialing',trial_end);
  insert into public.locations(organisation_id,name,code) values(new_org,'Main Store','MAIN') returning id into new_location;
  if coalesce((chosen_features->>'pos')::boolean,false) then insert into public.tills(organisation_id,location_id,name) values(new_org,new_location,'Till 1'); end if;

  category_names:=case selected_template
    when 'vape' then array['E-liquids','Disposable vapes','Pods & coils','Devices','Accessories']
    when 'cafe' then array['Hot drinks','Cold drinks','Breakfast','Lunch','Cakes']
    when 'bakery' then array['Bread','Pastries','Cakes','Sandwiches','Drinks']
    when 'pub' then array['Draught','Bottles & cans','Wine','Spirits','Food']
    when 'clothing' then array['Tops','Bottoms','Outerwear','Footwear','Accessories']
    when 'convenience' then array['Drinks','Snacks','Grocery','Chilled','Household']
    when 'gifts' then array['Cards','Gifts','Homeware','Seasonal','Wrapping']
    when 'pets' then array['Food','Treats','Toys','Accessories','Health']
    when 'hardware' then array['Tools','Fixings','Electrical','Plumbing','Decorating']
    when 'salon' then array['Services','Hair care','Skin care','Accessories','Retail']
    else array['Products','Services','Accessories'] end;
  insert into public.categories(organisation_id,name,display_order) select new_org,n,ord from unnest(category_names) with ordinality as x(n,ord);
  if coalesce((chosen_features->>'loyalty')::boolean,false) then
    insert into public.loyalty_programs(organisation_id,enabled,points_per_pound,reward_points,reward_value,welcome_bonus) values(new_org,true,1,100,1,0);
    insert into public.loyalty_reward_tiers(organisation_id,name,points_cost,reward_value,display_order) values(new_org,'£1 reward',100,1,0),(new_org,'£6 reward',500,6,1);
  end if;
  return query select new_user,lower(owner_email),trim(owner_name),new_org,trim(business_name),'owner'::public.membership_role,selected_plan,chosen_features,trial_end;
end;
$$;

grant execute on function app_public_plans(),app_has_feature(uuid,text),app_subscription(uuid),app_start_trial(text,text,text,text,text,text) to counter_app;
