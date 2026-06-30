import { ReportLoading } from "@/components/loading/ReportLoading";
import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Skeleton khusus /board — cermin struktur asli (board/page.tsx:241+):
 * .board-head (eyebrow + h1 verdict + .chip-row + .seg periode) → .kpi-grid
 * (4 kartu) → kartu ranking (tabel). Tampil INSTAN (obat layar-beku) dan
 * berukuran sehingga TAK menggeser tata letak saat data asli masuk (rule 9).
 * ReportLoading menambah reasuransi bertingkat + Batal (beban G/L sebulan).
 */
export default function BoardLoading() {
  return (
    <div>
      <div className="board-head">
        <div>
          <Skeleton width="var(--space-32)" height="var(--space-4)" />
          <Skeleton width="55%" height="var(--space-10)" radius="var(--radius-md)" className="mt2" />
          <div className="chip-row mt3">
            <Skeleton inline width="var(--space-24)" height="var(--space-6)" radius="var(--radius-full)" />
            <Skeleton inline width="var(--space-20)" height="var(--space-6)" radius="var(--radius-full)" />
            <Skeleton inline width="var(--space-24)" height="var(--space-6)" radius="var(--radius-full)" />
          </div>
        </div>
        <Skeleton width="var(--space-32)" height="var(--target-min)" radius="var(--radius-full)" />
      </div>

      <div className="kpi-grid mt8">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="kpi-card">
            <Skeleton width="60%" height="var(--space-4)" />
            <Skeleton width="80%" height="var(--space-8)" className="mt2" />
            <Skeleton width="50%" height="var(--space-4)" className="mt2" />
          </div>
        ))}
      </div>

      <div className="card tbl-card mt8 card-pad">
        <SkeletonTable rows={6} />
      </div>

      <ReportLoading />
    </div>
  );
}
