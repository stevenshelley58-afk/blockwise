import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Onboarding was folded into Settings. Keep the old URL working.
export default function OnboardingRedirectPage() {
  redirect("/settings");
}
