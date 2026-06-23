import assert from "node:assert/strict";
import test from "node:test";

import { cleanSupabaseEnv } from "../src/lib/supabase/env.ts";

test("cleanSupabaseEnv strips real and mojibake BOM prefixes", () => {
  assert.equal(cleanSupabaseEnv("\uFEFFhttps://example.supabase.co"), "https://example.supabase.co");
  assert.equal(cleanSupabaseEnv("ï»¿https://example.supabase.co"), "https://example.supabase.co");
  assert.equal(cleanSupabaseEnv("  ï»¿eyJhbGciOiJIUzI1NiJ9  "), "eyJhbGciOiJIUzI1NiJ9");
});
