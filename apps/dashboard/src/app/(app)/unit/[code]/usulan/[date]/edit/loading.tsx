import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Skeleton khusus /usulan/edit — cermin edit/page.tsx:91+: .lap-page →
 * UsulanToolbar → .board-head → UsulanForm (kartu tabel grid cols-usulan, 7
 * kolom). Beban G/L di sini 1-hari (murah) → tanpa ReportLoading; skeleton
 * instan nol-pergeseran (rule 9).
 */
export default function UsulanEditLoading() {
  return (
    <div className="lap-page">
      <div className="lap-toolbar">
        <Skeleton inline width="var(--space-24)" height="var(--space-10)" radius="var(--radius-full)" />
        <div className="lap-toolbar-right">
          <Skeleton inline width="var(--space-20)" height="var(--target-min)" radius="var(--radius-full)" />
        </div>
      </div>

      <div className="board-head mt6">
        <div>
          <Skeleton width="var(--space-32)" height="var(--space-4)" />
          <Skeleton width="50%" height="var(--space-8)" radius="var(--radius-md)" className="mt2" />
        </div>
      </div>

      <div className="card tbl-card mt4 card-pad">
        <SkeletonTable rows={6} />
      </div>
    </div>
  );
}
