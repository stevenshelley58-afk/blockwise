import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

export default function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><AppShell>{children}</AppShell><Toaster /></>;
}
