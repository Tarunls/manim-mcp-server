ALTER TABLE billing_profiles DROP CONSTRAINT billing_profiles_plan_check;
ALTER TABLE billing_profiles
  ADD CONSTRAINT billing_profiles_plan_check
  CHECK (plan IN ('free', 'creator', 'pro', 'studio'));
