import { cookies } from "next/headers";

import {
  getOfflineAuthSessionTemplate,
  OFFLINE_AUTH_COOKIE,
  verifyOfflineAuthCookieValue,
  type OfflineAuthSession,
} from "./offline-config.ts";

export async function getOfflineAuthSession(): Promise<OfflineAuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OFFLINE_AUTH_COOKIE)?.value;

  if (!verifyOfflineAuthCookieValue(token)) {
    return null;
  }

  return getOfflineAuthSessionTemplate();
}
