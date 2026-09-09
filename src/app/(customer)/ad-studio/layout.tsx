import { StudioShell } from "@/components/adstudio/studio-shell";

export default function AdStudioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <StudioShell>{children}</StudioShell>;
}
