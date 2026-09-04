import assert from "node:assert/strict";
import test from "node:test";

import { hasOperatorAccessFromRows } from "../src/lib/auth/workspace-access.ts";

test("only profile is_operator with a valid operator_role grants platform operator access", () => {
  assert.equal(hasOperatorAccessFromRows({ is_operator: true, operator_role: "owner" }, []), true);
  assert.equal(hasOperatorAccessFromRows({ is_operator: true, operator_role: "support" }, []), true);
  assert.equal(hasOperatorAccessFromRows({ is_operator: true }, []), false);
  assert.equal(hasOperatorAccessFromRows({ is_operator: false, operator_role: "owner" }, [{ role: "operator" }]), false);
});
