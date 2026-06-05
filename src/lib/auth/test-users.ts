export const testUsers = [
  {
    key: "operator",
    label: "Operator",
    email: "operator@blockwise.test",
    homePath: "/operator",
  },
  {
    key: "monitor",
    label: "Results",
    email: "monitor@blockwise.test",
    homePath: "/results",
  },
  {
    key: "self_serve",
    label: "Self-Serve",
    email: "selfserve@blockwise.test",
    homePath: "/results",
  },
] as const;

export function getRedirectForEmail(email?: string | null) {
  const normalizedEmail = email?.toLowerCase();
  return testUsers.find((user) => user.email === normalizedEmail)?.homePath ?? "/results";
}
