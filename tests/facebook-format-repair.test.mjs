import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/202609080004_research_facebook_format_repair.sql', 'utf8');
// Behavior is tested by tests/fixtures/facebook-format-repair.sql against an
// isolated PostgreSQL rehearsal database, not a duplicate JavaScript URL parser.
test('repair preserves data and requires a changed unresolved Facebook vanity', () => {
  for (const text of ["platform = 'facebook'", 'page_id is null',
    'page_vanity is distinct from', 'original_page_url', 'original_page_vanity',
    'facebook_page_vanity_repair']) assert.ok(migration.includes(text));
  assert.doesNotMatch(migration, /delete\s+from|merge\s+into|scan_enabled\s*=/iu);
});
test('SQL behavior fixtures exercise the actual migration twice', () => {
  const fixture = readFileSync('tests/fixtures/facebook-format-repair.sql', 'utf8');
  assert.equal(fixture.split('202609080004_research_facebook_format_repair.sql').length - 1, 2);
  assert.ok(fixture.includes('ROLLBACK') || fixture.includes('rollback'));
  assert.ok(fixture.includes('current_database()'));
  assert.ok(fixture.includes('https://user@facebook.com/Handle'));
});
