import test from "node:test";
import assert from "node:assert/strict";

import { validateEmail, validateLoginCredentials } from "../src/lib/auth/form-validation.ts";

test("auth form validation rejects malformed signup email before auth dispatch", () => {
  assert.equal(validateEmail("not-an-email", "work email"), "Enter a valid work email.");
  assert.equal(validateEmail(""), "Enter your email.");
});

test("login validation gives accessible local messages for blank credentials", () => {
  assert.equal(validateLoginCredentials("", ""), "Enter your email.");
  assert.equal(validateLoginCredentials("person@example.com", ""), "Enter your password.");
  assert.equal(validateLoginCredentials("person@example.com", "password"), null);
});
