import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Skeleton khusus /rincian — cermin rincian/page.tsx:234+: .doc-wrap →
 * .rincian-links → .rincian-toolbar (card) → .doc-sheet (kop + judul + ledger).
 * Halaman ini RINGAN (tanpa G/L) → tanpa ReportLoading; cukup skeleton instan
 * nol-pergeseran (rule 9).
 */
export default function RincianLoading() {
  return (
    <div className="doc-wrap">
      <div className="rincian-links">
        <Skeleton inline width="var(--space-32)" height="var(--space-5)" />
      </div>

      <div className="card card-pad rincian-toolbar">
        <Skeleton inline width="40%" height="var(--space-5)" />
        <Skeleton inline width="var(--space-24)" height="var(--target-min)" radius="var(--radius-full)" />
      </div>

      <div className="doc-sheet mt6">
        <div className="doc-kop">
          <div>
            <Skeleton width="var(--space-32)" height="var(--space-6)" />
            <Skeleton width="60%" height="var(--space-4)" className="mt2" />
          </div>
        </div>
        <div className="doc-titlewrap">
          <Skeleton width="var(--space-24)" height="var(--space-8)" />
        </div>
        <div className="mt6">
          <SkeletonTable rows={8} />
        </div>
      </div>
    </div>
  );
}
