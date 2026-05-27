export const DEV_TEST_PASSWORD = "SJS5858";

export const testUsers = [
  {
    key: "operator",
    label: "Operator",
    email: "operator@blockwise.test",
    homePath: "/operator",
  },
  {
    key: "monitor",
    label: "Monitor",
    email: "monitor@blockwise.test",
    homePath: "/monitor",
  },
  {
    key: "self_serve",
    label: "Self-Serve",
    email: "selfserve@blockwise.test",
    homePath: "/self-serve",
  },
] as const;

export function getRedirectForEmail(email?: string | null) {
  const normalizedEmail = email?.toLowerCase();
  return testUsers.find((user) => user.email === normalizedEmail)?.homePath ?? "/monitor";
}
