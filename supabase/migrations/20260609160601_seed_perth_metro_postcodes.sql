-- Recovered verbatim from the production migration ledger (schema_migrations.statements).
-- Applied out-of-band to prod as version 20260609160601; restored to source control here.

-- Widen priority check to all 6 cadence tiers before seeding (idempotent).
alter table research.refresh_policies drop constraint if exists refresh_policies_priority_check;
alter table research.refresh_policies add constraint refresh_policies_priority_check check (priority between 1 and 6);

-- Seed Perth metro postcodes (priority=1, 720-min cadence).
INSERT INTO research.refresh_policies (postcode, state, active, priority, refresh_cadence_minutes, next_refresh_at)
VALUES
  ('6000', 'WA', true, 1, 720, now()),
  ('6005', 'WA', true, 1, 720, now()),
  ('6006', 'WA', true, 1, 720, now()),
  ('6007', 'WA', true, 1, 720, now()),
  ('6008', 'WA', true, 1, 720, now()),
  ('6009', 'WA', true, 1, 720, now()),
  ('6010', 'WA', true, 1, 720, now()),
  ('6011', 'WA', true, 1, 720, now()),
  ('6014', 'WA', true, 1, 720, now()),
  ('6015', 'WA', true, 1, 720, now()),
  ('6016', 'WA', true, 1, 720, now()),
  ('6017', 'WA', true, 1, 720, now()),
  ('6018', 'WA', true, 1, 720, now()),
  ('6019', 'WA', true, 1, 720, now()),
  ('6020', 'WA', true, 1, 720, now()),
  ('6050', 'WA', true, 1, 720, now()),
  ('6051', 'WA', true, 1, 720, now()),
  ('6052', 'WA', true, 1, 720, now()),
  ('6151', 'WA', true, 1, 720, now()),
  ('6152', 'WA', true, 1, 720, now()),
  ('6153', 'WA', true, 1, 720, now()),
  ('6158', 'WA', true, 1, 720, now()),
  ('6159', 'WA', true, 1, 720, now()),
  ('6160', 'WA', true, 1, 720, now()),
  ('6166', 'WA', true, 1, 720, now())
ON CONFLICT (postcode, state) DO UPDATE SET
  active = true,
  priority = LEAST(research.refresh_policies.priority, EXCLUDED.priority),
  next_refresh_at = now();
