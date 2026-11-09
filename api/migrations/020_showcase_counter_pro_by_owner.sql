-- Some older showcase organisations predate the settings.demo marker.
-- Their seeded owner accounts consistently use the reserved .demo suffix.
update subscriptions s
set plan_id = 'pro',
    status = 'trialing',
    trial_ends_at = greatest(coalesce(s.trial_ends_at, now()), now() + interval '30 days'),
    updated_at = now()
where exists (
  select 1
  from organisation_memberships m
  join users u on u.id = m.user_id
  where m.organisation_id = s.organisation_id
    and m.role = 'owner'
    and lower(u.email) like 'owner@%.demo'
);
