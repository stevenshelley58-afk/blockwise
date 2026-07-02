export const testUsers = [
  {
    key: "operator",
    label: "Operator",
    email: "steven@blockwise.sale",
    homePath: "/operator",
  },
] as const;

export function getRedirectForEmail(email?: string | null) {
  const normalizedEmail = email?.toLowerCase();
  return testUsers.find((user) => user.email === normalizedEmail)?.homePath ?? "/home";
}
