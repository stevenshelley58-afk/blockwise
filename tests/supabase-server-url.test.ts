import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveSupabaseAuthCookieName,
  resolveSupabaseServerUrl,
} from "../src/lib/supabase/server-url.ts";

test("production server clients require and normalize the private Supabase origin", () => {
  assert.equal(
    resolveSupabaseServerUrl({
      NODE_ENV: "production",
      BLOCKWISE_SUPABASE_INTERNAL_URL: " http://product-caddy/ ",
      NEXT_PUBLIC_SUPABASE_URL: "https://blockwise.sale",
    }),
    "http://product-caddy",
  );

  assert.throws(
    () => resolveSupabaseServerUrl({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://blockwise.sale",
    }),
    /BLOCKWISE_SUPABASE_INTERNAL_URL is required in production/,
  );
  assert.equal(
    resolveSupabaseAuthCookieName({
      NEXT_PUBLIC_SUPABASE_URL: "https://blockwise.sale",
      BLOCKWISE_SUPABASE_INTERNAL_URL: "http://product-caddy",
    }),
    "sb-blockwise-auth-token",
  );
});

test("development and tests can fall back to the configured Supabase origin", () => {
  assert.equal(
    resolveSupabaseServerUrl({
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co/",
    }),
    "https://project.supabase.co",
  );
  assert.throws(
    () => resolveSupabaseServerUrl({ NODE_ENV: "test" }),
    /Supabase server URL environment is missing/,
  );
});

test("server clients use the internal resolver while the browser stays public", () => {
  for (const path of [
    "src/lib/supabase/server.ts",
    "src/lib/supabase/proxy.ts",
    "src/lib/supabase/service.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /resolveSupabaseServerUrl/, path);
    assert.doesNotMatch(source, /process\.env\.NEXT_PUBLIC_SUPABASE_URL/, path);
  }
  for (const path of ["src/lib/supabase/server.ts", "src/lib/supabase/proxy.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /cookieOptions: \{ name: resolveSupabaseAuthCookieName\(\) \}/, path);
  }

  const browser = readFileSync("src/lib/supabase/browser.ts", "utf8");
  assert.match(browser, /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.doesNotMatch(browser, /resolveSupabaseServerUrl|BLOCKWISE_SUPABASE_INTERNAL_URL/);
});

test("server URL rejects credentials, paths, and non-HTTP schemes", () => {
  for (const value of [
    "http://user:password@product-caddy",
    "http://product-caddy/auth/v1",
    "file:///tmp/product-caddy",
  ]) {
    assert.throws(
      () => resolveSupabaseServerUrl({
        NODE_ENV: "production",
        BLOCKWISE_SUPABASE_INTERNAL_URL: value,
      }),
      /clean HTTP\(S\) origin/,
    );
  }
});
