import { ReportLoading } from "@/components/loading/ReportLoading";
import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Skeleton khusus /laporan — cermin laporan/page.tsx:267+: .lap-page →
 * .lap-toolbar (seg Ringkas/Lengkap + tombol kanan) → .board-head (eyebrow + h1
 * + headnums) → kartu seksi (tbl-card). Tampil instan; berukuran agar nol
 * pergeseran (rule 9). ReportLoading = reasuransi bertingkat + Batal (beban G/L
 * sebulan: agregat bulanan di halaman ini).
 */
export default function LaporanLoading() {
  return (
    <div className="lap-page">
      <div className="lap-toolbar">
        <Skeleton inline width="var(--space-32)" height="var(--target-min)" radius="var(--radius-full)" />
        <div className="lap-toolbar-right">
          <Skeleton inline width="var(--space-24)" height="var(--target-min)" radius="var(--radius-full)" />
          <Skeleton inline width="var(--space-20)" height="var(--target-min)" radius="var(--radius-full)" />
        </div>
      </div>

      <div className="board-head mt6">
        <div>
          <Skeleton width="var(--space-32)" height="var(--space-4)" />
          <Skeleton width="60%" height="var(--space-10)" radius="var(--radius-md)" className="mt2" />
        </div>
      </div>

      <div className="card tbl-card mt8 card-pad">
        <SkeletonTable rows={5} />
      </div>
      <div className="card tbl-card mt4 card-pad">
        <SkeletonTable rows={4} />
      </div>

      <ReportLoading />
    </div>
  );
}
