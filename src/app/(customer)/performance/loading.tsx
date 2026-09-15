import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonStatRow,
} from "@/components/skeletons/page-skeletons";

export default function PerformanceLoading() {
  return (
    <SkeletonPage label="Performance">
      <SkeletonPageHead />
      <SkeletonStatRow count={6} />
      <div className="grid gap-3.5 md:grid-cols-3">
        <SkeletonPanel height="h-[180px]" />
        <SkeletonPanel height="h-[180px]" />
        <SkeletonPanel height="h-[180px]" />
      </div>
    </SkeletonPage>
  );
}
