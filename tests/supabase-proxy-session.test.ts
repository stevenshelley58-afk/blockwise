import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { accessTokenExpirySeconds } from "../src/lib/supabase/access-token.ts";

/**
 * Behavioural contract for the proxy's cheap-path session handling.
 *
 * This project signs access tokens with the legacy HS256 secret, and auth-js can
 * only verify an HS256 token by calling the Auth server. Calling getClaims()
 * unconditionally therefore put an Auth round trip in front of every matched
 * request, measured at ~219ms per authenticated request. The proxy now reads the
 * (unverified) expiry first and only performs the real refresh when the token is
 * near expiry, so these tests pin the reader's contract: find the expiry when it
 * is there, and report "unknown" in every ambiguous case so the caller falls
 * through to verification rather than assuming a valid session.
 */

function tokenWithExp(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", exp })}.signature`;
}

function cookieSource(entries: Array<{ name: string; value: string }>) {
  return { getAll: () => entries };
}

function sessionCookie(value: unknown, encodeBase64 = false): { name: string; value: string } {
  const json = JSON.stringify(value);
  return {
    name: "sb-blockwise-auth-token",
    value: encodeBase64 ? `base64-${Buffer.from(json).toString("base64")}` : json,
  };
}

const FUTURE = 2_000_000_000;

describe("accessTokenExpirySeconds", () => {
  it("reads the expiry from a plain session cookie", () => {
    const cookies = cookieSource([sessionCookie({ access_token: tokenWithExp(FUTURE) })]);
    assert.equal(accessTokenExpirySeconds(cookies), FUTURE);
  });

  it("reads the expiry from a base64url-encoded session cookie", () => {
    const cookies = cookieSource([sessionCookie({ access_token: tokenWithExp(FUTURE) }, true)]);
    assert.equal(accessTokenExpirySeconds(cookies), FUTURE);
  });

  it("reads the expiry from the legacy array cookie shape", () => {
    const cookies = cookieSource([sessionCookie([tokenWithExp(FUTURE), "refresh-token"])]);
    assert.equal(accessTokenExpirySeconds(cookies), FUTURE);
  });

  it("ignores unrelated cookies", () => {
    const cookies = cookieSource([
      { name: "theme", value: "dark" },
      { name: "sb-blockwise-auth-token", value: "not-json" },
    ]);
    assert.equal(accessTokenExpirySeconds(cookies), null);
  });

  it("reports unknown for every ambiguous input so the caller verifies", () => {
    const cases: Array<[string, Array<{ name: string; value: string }>]> = [
      ["no cookies", []],
      ["cookie is not json", [{ name: "sb-blockwise-auth-token", value: "<<<not json>>>" }]],
      ["cookie json is a bare string", [{ name: "sb-blockwise-auth-token", value: '"hello"' }]],
      ["session has no access token", [{ name: "sb-blockwise-auth-token", value: JSON.stringify({ user: {} }) }]],
      ["token has no payload segment", [{ name: "sb-blockwise-auth-token", value: JSON.stringify({ access_token: "nodots" }) }]],
      ["payload is not json", [{ name: "sb-blockwise-auth-token", value: JSON.stringify({ access_token: "a.@@@.c" }) }]],
      ["exp is not a number", [{ name: "sb-blockwise-auth-token", value: JSON.stringify({ access_token: tokenWithExp(Number.NaN) }) }]],
      [
        "base64 prefix with invalid base64",
        [{ name: "sb-blockwise-auth-token", value: "base64-!!!!" }],
      ],
    ];
    for (const [label, entries] of cases) {
      assert.equal(accessTokenExpirySeconds(cookieSource(entries)), null, label);
    }
  });

  it("uses the first parseable auth cookie when several are present", () => {
    const cookies = cookieSource([
      { name: "sb-blockwise-auth-token.0", value: "garbage" },
      sessionCookie({ access_token: tokenWithExp(FUTURE) }),
    ]);
    assert.equal(accessTokenExpirySeconds(cookies), FUTURE);
  });
});
