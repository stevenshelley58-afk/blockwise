import assert from "node:assert/strict";
import test from "node:test";

import { publicFrankReleaseUrl } from "../src/lib/frank-release-public-url.ts";

test("accepts a credential-free public HTTPS Frank release URL", () => {
  assert.equal(
    publicFrankReleaseUrl("https://cdn.example.com/releases/pack.json?version=1"),
    "https://cdn.example.com/releases/pack.json?version=1",
  );
});

test("rejects credentials, fragments, exact credential keys, and credential-key substrings", () => {
  for (const value of [
    "https://user@example.com/release.json",
    "https://user:password@example.com/release.json",
    "https://example.com/release.json#",
    "https://example.com/release.json#private",
    "https://example.com/release.json?token=value",
    "https://example.com/release.json?access_token=value",
    "https://example.com/release.json?refresh_token=value",
    "https://example.com/release.json?api_key=value",
    "https://example.com/release.json?apikey=value",
    "https://example.com/release.json?key=value",
    "https://example.com/release.json?secret=value",
    "https://example.com/release.json?signature=value",
    "https://example.com/release.json?sig=value",
    "https://example.com/release.json?auth=value",
    "https://example.com/release.json?authorization=value",
    "https://example.com/release.json?next_token_hint=value",
    "https://example.com/release.json?detached-signature-id=value",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("rejects secret, credential, and PII material in decoded path and query values", () => {
  for (const value of [
    "https://cdn.example.com/release?download=sk_live_abcdefghijklmnop",
    "https://cdn.example.com/release?download=credential%3Ddo-not-release",
    "https://cdn.example.com/release?download=owner%40example.com",
    "https://cdn.example.com/release?download=%256fwner%2540example.com",
    "https://cdn.example.com/release?download=%2B61%20412%20345%20678",
    "https://cdn.example.com/releases/sk_live_abcdefghijklmnop/pack.json",
    "https://cdn.example.com/releases/credential%3Ddo-not-release/pack.json",
    "https://cdn.example.com/releases/owner%40example.com/pack.json",
    "https://cdn.example.com/releases/%2B61%20412%20345%20678/pack.json",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("bounds recursive decoding, rejects malformed encodings, and preserves safe values", () => {
  assert.equal(publicFrankReleaseUrl("https://cdn.example.com/releases/%E0%A4%A/pack.json"), null);
  assert.equal(publicFrankReleaseUrl("https://cdn.example.com/release?download=%252525256fwner%2525252540example.com"), null);
  assert.equal(
    publicFrankReleaseUrl("https://cdn.example.com/releases/2026-08-14/pack.json?download=campaign-v1"),
    "https://cdn.example.com/releases/2026-08-14/pack.json?download=campaign-v1",
  );
});

test("strictly rejects malformed percent, UTF-8, replacement, and control characters", () => {
  for (const value of [
    "https://cdn.example.com/releases/%zz/pack.json",
    "https://cdn.example.com/release?download=%zz",
    "https://cdn.example.com/releases/%E0%A4/pack.json",
    "https://cdn.example.com/release?download=%E0%A4%A",
    "https://cdn.example.com/releases/%EF%BF%BD/pack.json",
    "https://cdn.example.com/release?download=%EF%BF%BD",
    "https://cdn.example.com/releases/%00/pack.json",
    "https://cdn.example.com/release?download=%0A",
    "https://cdn.example.com/releases/\uFFFD/pack.json",
    "https://cdn.example.com/release?download=\u0001",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("rejects raw and encoded backslashes at top-level, reference, and nested URL boundaries", () => {
  for (const value of [
    "https:\\\\cdn.example.com\\release.json",
    "https://cdn.example.com\\@10.0.0.1/release.json",
    "https://cdn.example.com/releases/%5Cprivate/pack.json",
    "https://cdn.example.com/release?next=https:\\\\10.0.0.1\\secret",
    "https://cdn.example.com/release?next=https%3A%5C%5C10.0.0.1%5Csecret",
    "https://cdn.example.com/release?next=https%253A%255C%255C10.0.0.1%255Csecret",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("rejects malformed percent syntax revealed by bounded decoding", () => {
  for (const value of [
    "https://cdn.example.com/release?download=%25zz",
    "https://cdn.example.com/release?download=%2525zz",
    "https://cdn.example.com/release?download=%252525zz",
    "https://cdn.example.com/releases/%25zz/pack.json",
    "https://cdn.example.com/releases/%2525zz/pack.json",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("rejects nested absolute and scheme-relative URLs, including encoded layers", () => {
  for (const value of [
    "https://cdn.example.com/release?next=https%3A%2F%2F10.0.0.1%2Fsecret",
    "https://cdn.example.com/release?next=%2F%2F169.254.169.254%2Flatest",
    "https://cdn.example.com/release?next=https%3A%2F%2Fpublic.example%2Flanding",
    "https://cdn.example.com/release?next=https%253A%252F%252F10.0.0.1%252Fsecret",
    "https://cdn.example.com/release?next=%252F%252F169.254.169.254%252Flatest",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});

test("applies private domain path rules only when the containing field is reference-like", () => {
  const restricted = "https://cdn.example.com/private/provider/payload.json";
  assert.equal(publicFrankReleaseUrl(restricted), restricted);
  assert.equal(publicFrankReleaseUrl(restricted, { referenceLike: true }), null);
  assert.equal(
    publicFrankReleaseUrl("https://cdn.example.com/private%252Fprovider%252Fpayload.json", { referenceLike: true }),
    null,
  );
  assert.equal(
    publicFrankReleaseUrl("https://cdn.example.com/public/pack.json?download=campaign-v1", { referenceLike: true }),
    "https://cdn.example.com/public/pack.json?download=campaign-v1",
  );
});

test("rejects local, private, reserved, special, mapped, and all literal IPv6 network targets", () => {
  for (const value of [
    "https://localhost/release.json",
    "https://service.local/release.json",
    "https://service.internal/release.json",
    "https://0.0.0.1/release.json",
    "https://10.0.0.1/release.json",
    "https://100.64.0.1/release.json",
    "https://127.0.0.1/release.json",
    "https://169.254.169.254/release.json",
    "https://172.16.0.1/release.json",
    "https://192.168.0.1/release.json",
    "https://192.0.2.1/release.json",
    "https://198.18.0.1/release.json",
    "https://198.51.100.1/release.json",
    "https://203.0.113.1/release.json",
    "https://224.0.0.1/release.json",
    "https://[::1]/release.json",
    "https://[fc00::1]/release.json",
    "https://[fec0::1]/release.json",
    "https://[fe80::1]/release.json",
    "https://[100::1]/release.json",
    "https://[2001:2::1]/release.json",
    "https://[::ffff:127.0.0.1]/release.json",
    "https://[::ffff:10.0.0.1]/release.json",
    "https://[::ffff:100.64.0.1]/release.json",
    "https://[::ffff:192.0.2.1]/release.json",
    "https://[2606:4700:4700::1111]/release.json",
  ]) {
    assert.equal(publicFrankReleaseUrl(value), null, value);
  }
});
