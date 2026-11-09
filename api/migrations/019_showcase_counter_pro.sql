-- Existing showcase organisations were seeded against the retired growth plan.
-- Upgrade demos in place without replacing their catalogue or sales data.
update subscriptions s
set plan_id = 'pro',
    status = 'trialing',
    trial_ends_at = greatest(coalesce(s.trial_ends_at, now()), now() + interval '30 days'),
    updated_at = now()
from organisations o
where o.id = s.organisation_id
  and coalesce((o.settings->>'demo')::boolean, false)
  and s.plan_id <> 'pro';
