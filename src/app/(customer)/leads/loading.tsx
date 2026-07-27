import {
  SkeletonPage,
  SkeletonPageHead,
  SkeletonStatRow,
  SkeletonTablePanel,
} from "@/components/skeletons/page-skeletons";

export default function LeadsLoading() {
  return (
    <SkeletonPage label="Leads">
      <SkeletonPageHead />
      <SkeletonStatRow count={3} />
      <SkeletonTablePanel rows={8} />
    </SkeletonPage>
  );
}
