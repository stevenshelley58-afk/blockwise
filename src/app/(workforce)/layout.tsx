import { AppShell } from "@/ui/app-shell";

export default function WorkforceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell requiredAccess="operator">{children}</AppShell>;
}
