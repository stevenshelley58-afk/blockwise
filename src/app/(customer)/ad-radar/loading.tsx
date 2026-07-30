import { SkeletonPage, SkeletonPageHead, SkeletonPanel } from "@/components/skeletons/page-skeletons";

export default function AdRadarLoading() {
  return (
    <SkeletonPage label="page">
      <SkeletonPageHead action={false} />
      <SkeletonPanel height="h-44" />
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonPanel height="h-44" />
        <SkeletonPanel height="h-44" />
        <SkeletonPanel height="h-44" />
      </div>
    </SkeletonPage>
  );
}
