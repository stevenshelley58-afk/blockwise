import { createHash, timingSafeEqual } from "node:crypto";

export const OFFLINE_AUTH_COOKIE = "blockwise_offline_auth";
export const OFFLINE_AUTH_TOKEN_SALT = "blockwise-offline-auth-v1";

type OfflineWorkspaceMode = "monitor" | "self_serve";
type OfflineWorkspaceRole = "owner" | "admin" | "member" | "viewer" | "operator";

export type OfflineAuthSession = {
  user: {
    id: string;
    email: string;
  };
  profile: {
    full_name: string;
    is_operator: boolean;
  };
  membership: {
    role: OfflineWorkspaceRole;
    workspaces: {
      id: string;
      name: string;
      mode: OfflineWorkspaceMode;
      region: string;
    };
  };
};

export function getOfflineAuthPassword(): string {
  return process.env.BLOCKWISE_DEV_PASSWORD?.trim() ?? "";
}

export function isOfflineAuthEnabled(): boolean {
  return process.env.BLOCKWISE_OFFLINE_AUTH_ENABLED === "true" && getOfflineAuthPassword().length >= 16;
}

export function getOfflineAuthDisabledReason(): string | null {
  if (process.env.BLOCKWISE_OFFLINE_AUTH_ENABLED !== "true") {
    return "Offline login is not enabled.";
  }
  if (getOfflineAuthPassword().length < 16) {
    return "BLOCKWISE_DEV_PASSWORD must be at least 16 characters.";
  }
  return null;
}

export function getOfflineAuthSessionTemplate(): OfflineAuthSession {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: process.env.BLOCKWISE_OFFLINE_EMAIL?.trim() || "steven@blockwise.sale",
    },
    profile: {
      full_name: process.env.BLOCKWISE_OFFLINE_NAME?.trim() || "Steven",
      is_operator: true,
    },
    membership: {
      role: "operator",
      workspaces: {
        id: process.env.BLOCKWISE_OFFLINE_WORKSPACE_ID?.trim() || "00000000-0000-4000-8000-000000000101",
        name: process.env.BLOCKWISE_OFFLINE_WORKSPACE_NAME?.trim() || "Operator Console",
        mode: "monitor",
        region: process.env.BLOCKWISE_OFFLINE_REGION?.trim() || "WA",
      },
    },
  };
}

export function createOfflineAuthCookieValue(): string {
  return createHash("sha256")
    .update(`${OFFLINE_AUTH_TOKEN_SALT}:${getOfflineAuthPassword()}`)
    .digest("hex");
}

export function verifyOfflineAuthCookieValue(value: string | undefined): boolean {
  if (!isOfflineAuthEnabled() || !value) return false;

  const expected = Buffer.from(createOfflineAuthCookieValue());
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyOfflineAuthPassword(password: string | undefined): boolean {
  if (!isOfflineAuthEnabled() || !password) return false;

  const expected = Buffer.from(getOfflineAuthPassword());
  const actual = Buffer.from(password);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
