do $$
declare
  stores text[]:=array['Cloud Nine Vapes','Corner Basket Convenience','Copper Kettle Cafe','Hearth & Crumb Bakery','The Lantern Pub','North Thread Clothing','Little Finch Gifts','Paws & Whiskers','Oak & Iron DIY','Studio Eleven Salon'];
  slugs text[]:=array['vape','convenience','cafe','bakery','pub','clothing','gifts','pets','hardware','salon'];
  catalog text[][]:=array[
    ['ElfLiq Nic Salts','Lost Mary BM6000','Vaporesso XROS Pods','IVG 2400','Seriously Soda'],
    ['Fresh Milk 2L','Sourdough Loaf','Free Range Eggs','Sparkling Water','Sea Salt Crisps'],
    ['House Espresso','Flat White','Breakfast Tea','Chicken Club','Blueberry Smoothie'],
    ['Butter Croissant','Seeded Sourdough','Cinnamon Bun','Chocolate Brownie','Celebration Cake'],
    ['House Lager','Pale Ale','Pinot Grigio','Classic Burger','Salted Peanuts'],
    ['Essential T-Shirt','Straight Leg Jean','Merino Jumper','Canvas Trainer','Classic Cap'],
    ['Soy Candle','Birthday Card','Ceramic Mug','Mini Planter','Gift Wrap Set'],
    ['Adult Dog Food','Cat Treats','Rope Toy','Cat Litter','Flea Treatment'],
    ['Interior Paint','Wood Screws','Claw Hammer','LED Bulb','Sealant'],
    ['Cut and Finish','Beard Trim','Colour Service','Shampoo 250ml','Styling Clay']
  ];
  prices numeric[][]:=array[[3.99,5.99,9.99,12.99,3.50],[1.85,3.20,2.75,1.20,1.25],[2.60,3.40,2.30,6.95,4.80],[2.40,4.20,3.10,2.80,28.00],[5.40,5.80,6.90,13.50,1.50],[18,48,65,42,20],[14,3.50,12,8,5],[24,3.20,7.50,8.90,11],[29,6,14,4.50,7.80],[28,16,65,12,14]];
  i int;j int;k int;d int;
  org uuid;usr uuid;loc uuid;till uuid;cat uuid;fam uuid;variant uuid;customer uuid;sale uuid;session uuid;
  amount numeric;qty int;method text;
begin
  for i in 1..10 loop
    org:=md5('showcase-org-'||i)::uuid;usr:=md5('showcase-user-'||i)::uuid;loc:=md5('showcase-location-'||i)::uuid;till:=md5('showcase-till-'||i)::uuid;cat:=md5('showcase-category-'||i)::uuid;session:=md5('showcase-session-'||i)::uuid;
    insert into users(id,email,password_hash,display_name) values(usr,'owner@'||slugs[i]||'.demo',crypt('demo-password',gen_salt('bf',10)),stores[i]||' Owner') on conflict(id) do update set display_name=excluded.display_name,password_hash=excluded.password_hash;
    insert into organisations(id,name,slug,settings) values(org,stores[i],slugs[i]||'-showcase',jsonb_build_object('demo',true,'vertical',slugs[i],'receipt',jsonb_build_object('businessName',stores[i],'address','Demo High Street, London','footer','Thank you - demonstration data only'))) on conflict(id) do update set name=excluded.name,settings=excluded.settings;
    insert into organisation_memberships(organisation_id,user_id,role,status,pin_hash) values(org,usr,'owner','active',crypt('1234',gen_salt('bf',10))) on conflict(organisation_id,user_id) do update set pin_hash=excluded.pin_hash,status='active';
    insert into subscriptions(organisation_id,plan_id,provider,provider_subscription_id,status,trial_ends_at) values(org,'pro','demo','showcase-'||i,'trialing',now()+interval '30 days') on conflict(organisation_id) do update set plan_id='pro',status='trialing',trial_ends_at=excluded.trial_ends_at;
    insert into locations(id,organisation_id,name,code) values(loc,org,stores[i]||' - Main Store','MAIN') on conflict(id) do update set name=excluded.name;
    insert into tills(id,organisation_id,location_id,name) values(till,org,loc,'Till 1') on conflict(id) do update set name='Till 1';
    insert into categories(id,organisation_id,name,display_order,target_margin) values(cat,org,initcap(slugs[i])||' Range',1,45) on conflict(id) do update set name=excluded.name;
    insert into loyalty_programs(organisation_id,enabled,points_per_pound,reward_points,reward_value,welcome_bonus,expiry_months) values(org,true,2,100,1,50,12) on conflict(organisation_id) do update set enabled=true,points_per_pound=2,welcome_bonus=50;
    insert into loyalty_reward_tiers(id,organisation_id,name,points_cost,reward_value,display_order) values(md5('showcase-tier1-'||i)::uuid,org,'£1 reward',100,1,1),(md5('showcase-tier2-'||i)::uuid,org,'£6 reward',500,6,2) on conflict(id) do update set name=excluded.name,points_cost=excluded.points_cost,reward_value=excluded.reward_value;
    for k in 1..5 loop
      customer:=md5('showcase-customer-'||i||'-'||k)::uuid;
      insert into customers(id,organisation_id,email,phone,display_name,marketing_consent,created_at) values(customer,org,'customer'||k||'@'||slugs[i]||'.example','07000'||lpad((i*100+k)::text,6,'0'),(array['Alex Morgan','Jamie Taylor','Sam Patel','Charlie Evans','Jordan Smith'])[k],k%2=0,now()-((40-k*3)||' days')::interval) on conflict(id) do update set display_name=excluded.display_name;
      insert into loyalty_entries(id,organisation_id,customer_id,points_delta,reason,created_at) values(md5('showcase-welcome-'||i||'-'||k)::uuid,org,customer,50,'Welcome bonus',now()-interval '30 days') on conflict(id) do nothing;
    end loop;
    for j in 1..5 loop
      fam:=md5('showcase-family-'||i||'-'||j)::uuid;
      insert into product_families(id,organisation_id,category_id,name,brand,size_label,description) values(fam,org,cat,catalog[i][j],stores[i],case when i=1 then '10ml' else 'Standard range' end,'Realistic demonstration product. Not for sale.') on conflict(id) do update set name=excluded.name,brand=excluded.brand;
      for k in 1..2 loop
        variant:=md5('showcase-variant-'||i||'-'||j||'-'||k)::uuid;
        insert into product_variants(id,organisation_id,family_id,sku,display_name,option_values,cost_price,retail_price,reorder_level) values(variant,org,fam,upper(slugs[i])||'-'||lpad(j::text,2,'0')||'-'||k,case when i=1 then (array['Blue Razz','Cherry Ice'])[k]||' · '||(array['10mg','20mg'])[k] else (array['Standard','Premium'])[k] end,case when i=1 then jsonb_build_object('flavour',(array['Blue Razz','Cherry Ice'])[k],'strength',(array['10mg','20mg'])[k]) else jsonb_build_object('option',(array['Standard','Premium'])[k]) end,round(prices[i][j]*0.52,2),prices[i][j]+(k-1)*round(prices[i][j]*0.15,2),8) on conflict(id) do update set retail_price=excluded.retail_price,cost_price=excluded.cost_price,option_values=excluded.option_values;
        insert into variant_barcodes(id,organisation_id,variant_id,gtin,is_primary) values(md5('showcase-barcode-'||i||'-'||j||'-'||k)::uuid,org,variant,'50'||lpad(i::text,2,'0')||lpad(j::text,2,'0')||lpad(k::text,2,'0')||'00000',true) on conflict(id) do nothing;
        insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values(org,loc,variant,case when j=5 and k=2 then 6 else 28+j*3+k end) on conflict(organisation_id,location_id,variant_id) do update set quantity=excluded.quantity,updated_at=now();
      end loop;
    end loop;
    insert into till_sessions(id,organisation_id,till_id,opened_by,opening_float,opened_at) values(session,org,till,usr,100,current_date-interval '14 days') on conflict(id) do nothing;
    for d in 0..13 loop
      sale:=md5('showcase-sale-'||i||'-'||d)::uuid;variant:=md5('showcase-variant-'||i||'-'||((d%5)+1)||'-'||((d%2)+1))::uuid;customer:=md5('showcase-customer-'||i||'-'||((d%5)+1))::uuid;qty:=(d%3)+1;amount:=round((prices[i][(d%5)+1]+((d%2))*prices[i][(d%5)+1]*0.15)*qty,2);method:=case when d%4=0 then 'cash' else 'card' end;
      insert into sales(id,organisation_id,location_id,till_id,till_session_id,staff_user_id,customer_id,status,subtotal,discount_total,tax_total,grand_total,completed_at,created_at) values(sale,org,loc,till,session,usr,customer,'completed',amount,0,round(amount/6,2),amount,current_date-(d||' days')::interval+interval '12 hours',current_date-(d||' days')::interval+interval '12 hours') on conflict(id) do update set grand_total=excluded.grand_total,subtotal=excluded.subtotal,tax_total=excluded.tax_total,completed_at=excluded.completed_at;
      insert into sale_items(id,organisation_id,sale_id,variant_id,sku_snapshot,name_snapshot,quantity,unit_price,tax_total,line_total) values(md5('showcase-line-'||i||'-'||d)::uuid,org,sale,variant,upper(slugs[i])||'-'||lpad(((d%5)+1)::text,2,'0')||'-'||((d%2)+1),catalog[i][(d%5)+1],qty,round(amount/qty,2),round(amount/6,2),amount) on conflict(id) do update set quantity=excluded.quantity,line_total=excluded.line_total;
      insert into payments(id,organisation_id,sale_id,method,provider,amount,status,created_at) values(md5('showcase-payment-'||i||'-'||d)::uuid,org,sale,method,'demo',amount,'completed',current_date-(d||' days')::interval+interval '12 hours') on conflict(id) do update set amount=excluded.amount,method=excluded.method;
      insert into loyalty_entries(id,organisation_id,customer_id,sale_id,points_delta,reason,created_at) values(md5('showcase-points-'||i||'-'||d)::uuid,org,customer,sale,greatest(1,floor(amount*2)::int),'Purchase reward',current_date-(d||' days')::interval+interval '12 hours') on conflict(id) do update set points_delta=excluded.points_delta;
    end loop;
  end loop;
end;
$$;
