import { SkeletonPage, SkeletonPageHead, SkeletonPanel } from "@/components/skeletons/page-skeletons";

export default function SettingsLoading() {
  return (
    <SkeletonPage label="Settings" width="max-w-4xl">
      <SkeletonPageHead action={false} />
      <SkeletonPanel height="h-24" />
      <SkeletonPanel height="h-32" />
      <SkeletonPanel height="h-24" />
    </SkeletonPage>
  );
}
