import { createClient } from "@supabase/supabase-js";

function cleanEnv(value) {
  return value?.replace(/^\uFEFF/, "").trim();
}

const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const password = cleanEnv(process.env.BLOCKWISE_DEV_PASSWORD);
const operatorEmail = cleanEnv(process.env.BLOCKWISE_OPERATOR_EMAIL) || "steven@blockwise.sale";
const operatorFullName = cleanEnv(process.env.BLOCKWISE_OPERATOR_FULL_NAME) || "Steven Shelley";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

if (!password || password.length < 16) {
  throw new Error("Set BLOCKWISE_DEV_PASSWORD to a unique password of at least 16 characters before seeding test users.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const users = [
  {
    key: "operator",
    email: operatorEmail,
    fullName: operatorFullName,
    isOperator: true,
  },
];

const workspaceIds = {
  selfServe: "00000000-0000-4000-8000-000000000001",
  monitor: "00000000-0000-4000-8000-000000000002",
};

async function requireNoError(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }

  return result.data;
}

async function findAuthUserByEmail(email) {
  let page = 1;

  while (true) {
    const data = await requireNoError(await supabase.auth.admin.listUsers({ page, perPage: 100 }), "List users");
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);

    if (user) {
      return user;
    }

    if (data.users.length < 100) {
      return null;
    }

    page += 1;
  }
}

async function upsertAuthUser(user) {
  const existingUser = await findAuthUserByEmail(user.email);
  const attributes = {
    password,
    email_confirm: true,
    user_metadata: {
      full_name: user.fullName,
    },
  };

  if (existingUser) {
    const data = await requireNoError(
      await supabase.auth.admin.updateUserById(existingUser.id, attributes),
      `Update ${user.email}`,
    );
    return data.user;
  }

  const data = await requireNoError(
    await supabase.auth.admin.createUser({
      email: user.email,
      ...attributes,
    }),
    `Create ${user.email}`,
  );
  return data.user;
}

const authUsers = new Map();

for (const user of users) {
  const authUser = await upsertAuthUser(user);
  authUsers.set(user.key, authUser);
}

await requireNoError(
  await supabase.from("profiles").upsert(
    users.map((user) => ({
      id: authUsers.get(user.key).id,
      email: user.email,
      full_name: user.fullName,
      is_operator: user.isOperator,
    })),
    { onConflict: "id" },
  ),
  "Upsert profiles",
);

const plan = await requireNoError(
  await supabase.from("workspace_plans").select("id").eq("key", "growth").single(),
  "Fetch growth plan",
);

await requireNoError(
  await supabase.from("workspaces").upsert(
    [
      {
        id: workspaceIds.selfServe,
        name: "Northstar Realty",
        mode: "self_serve",
        plan_id: plan.id,
        region: "AU",
        managed_service_enabled: true,
        approval_required_by_default: true,
        created_by: authUsers.get("operator").id,
      },
      {
        id: workspaceIds.monitor,
        name: "Monitor Test Realty",
        mode: "monitor",
        plan_id: plan.id,
        region: "AU",
        managed_service_enabled: false,
        approval_required_by_default: true,
        created_by: authUsers.get("operator").id,
      },
    ],
    { onConflict: "id" },
  ),
  "Upsert workspaces",
);

await requireNoError(
  await supabase.from("workspace_members").upsert(
    [
      {
        workspace_id: workspaceIds.selfServe,
        profile_id: authUsers.get("operator").id,
        role: "operator",
      },
      {
        workspace_id: workspaceIds.monitor,
        profile_id: authUsers.get("operator").id,
        role: "operator",
      },
    ],
    { onConflict: "workspace_id,profile_id" },
  ),
  "Upsert workspace members",
);

console.log("Seeded dev operator login:");
for (const user of users) {
  console.log(`- ${user.email}`);
}
