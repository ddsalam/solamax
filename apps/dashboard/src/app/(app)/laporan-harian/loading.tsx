import { HarianSkeleton } from "@/components/harian/HarianSkeleton";
import { ReportLoading } from "@/components/loading/ReportLoading";

export default function LaporanHarianLoading() {
  return (
    <div>
      <HarianSkeleton />
      <ReportLoading />
    </div>
  );
}
