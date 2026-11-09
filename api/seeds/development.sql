do $$
declare
  user_a uuid := '10000000-0000-0000-0000-000000000001';
  user_b uuid := '10000000-0000-0000-0000-000000000002';
  org_a uuid := '20000000-0000-0000-0000-000000000001';
  org_b uuid := '20000000-0000-0000-0000-000000000002';
  loc_a uuid := '30000000-0000-0000-0000-000000000001';
  loc_b uuid := '30000000-0000-0000-0000-000000000002';
  till_a uuid := '40000000-0000-0000-0000-000000000001';
  till_b uuid := '40000000-0000-0000-0000-000000000002';
begin
  insert into plans(id,name,monthly_price,limits,features) values
    ('starter','Starter',29,'{"locations":1,"staff":5}','{"loyalty":true,"advanced_reports":false}'),
    ('growth','Growth',69,'{"locations":3,"staff":25}','{"loyalty":true,"advanced_reports":true}') on conflict do nothing;
  insert into users(id,email,password_hash,display_name) values
    (user_a,'owner@north.demo',crypt('demo-password',gen_salt('bf',10)),'North Store Owner'),
    (user_b,'owner@south.demo',crypt('demo-password',gen_salt('bf',10)),'South Store Owner') on conflict do nothing;
  insert into organisations(id,name,slug) values (org_a,'North Demo Retail','north-demo'),(org_b,'South Demo Retail','south-demo') on conflict do nothing;
  insert into organisation_memberships(organisation_id,user_id,role,status,pin_hash) values
    (org_a,user_a,'owner','active',crypt('1234',gen_salt('bf',10))),
    (org_b,user_b,'owner','active',crypt('1234',gen_salt('bf',10)))
    on conflict (organisation_id,user_id) do update set pin_hash=excluded.pin_hash;
  insert into subscriptions(organisation_id,plan_id,status,trial_ends_at) values (org_a,'growth','trialing',now()+interval '14 days'),(org_b,'starter','active',null) on conflict do nothing;
  insert into locations(id,organisation_id,name,code) values (loc_a,org_a,'North Main Store','MAIN'),(loc_b,org_b,'South Main Store','MAIN') on conflict do nothing;
  insert into tills(id,organisation_id,location_id,name) values (till_a,org_a,loc_a,'Till 1'),(till_b,org_b,loc_b,'Till 1') on conflict do nothing;
  insert into products(organisation_id,sku,name,retail_price) values (org_a,'NORTH-001','North-only Coffee',3.20),(org_b,'SOUTH-001','South-only Tea',2.80) on conflict do nothing;
end $$;
