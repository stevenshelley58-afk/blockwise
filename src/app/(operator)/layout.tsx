import { AppShell } from "@/components/app-shell";

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell requiredAccess="operator">{children}</AppShell>;
}
