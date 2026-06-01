import { AppShell } from "@/ui/app-shell";

export default function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
