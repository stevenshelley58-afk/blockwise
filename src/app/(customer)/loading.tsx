import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonPanel,
  SkeletonStatRow,
} from "@/components/skeletons/page-skeletons";

export default function CustomerLoading() {
  return (
    <SkeletonPage label="Workspace">
      <SkeletonPageHead action={false} />
      <SkeletonStatRow />
      <div className="grid gap-3.5 lg:grid-cols-[3fr_2fr]">
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
    </SkeletonPage>
  );
}
