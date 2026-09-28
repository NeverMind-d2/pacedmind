-- PacedMind Cloud's billing launches: an account whose trial and subscription have ended becomes read-only
-- (private.require_cloud). Accounts made before the launch start their 7 days now.
update public.billing set trial_ends_at = greatest(trial_ends_at, now() + interval '7 days')
  where not comped and subscription_id is null;
update private.billing_switch set enforce = true;
