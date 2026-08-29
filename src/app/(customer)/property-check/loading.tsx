import { SkeletonPage, SkeletonPageHead, SkeletonPanel } from "@/components/skeletons/page-skeletons";

export default function PropertyCheckLoading() {
  return (
    <SkeletonPage label="page" width="max-w-4xl">
      <SkeletonPageHead action={false} />
      <SkeletonPanel height="h-14" />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <SkeletonPanel height="h-24" />
        <SkeletonPanel height="h-24" />
      </div>
    </SkeletonPage>
  );
}
