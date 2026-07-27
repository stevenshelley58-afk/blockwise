import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonStatRow,
} from "@/components/skeletons/page-skeletons";

export default function SelfServeLoading() {
  return (
    <SkeletonPage label="Home">
      <SkeletonPageHead />
      <SkeletonStatRow />
      <div className="grid gap-3.5 lg:grid-cols-[3fr_2fr]">
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <SkeletonPanel height="h-12" />
        <SkeletonPanel height="h-12" />
      </div>
    </SkeletonPage>
  );
}
