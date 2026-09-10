export function validateEmail(value: string, label = "email"): string | null {
  const email = value.trim();
  if (!email) return label === "work email" ? "Enter your work email." : "Enter your email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return label === "work email" ? "Enter a valid work email." : "Enter a valid email.";
  }
  return null;
}

export function validateLoginCredentials(email: string, password: string): string | null {
  return validateEmail(email) ?? (password ? null : "Enter your password.");
}
