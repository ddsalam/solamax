import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Skeleton khusus /usulan (daftar) — cermin usulan/page.tsx:25+: .lap-page →
 * UsulanToolbar (.lap-toolbar) → .board-head → kartu tabel (grid cols-usulan-list,
 * 6 kolom). Ringan; skeleton instan nol-pergeseran (rule 9).
 */
export default function UsulanListLoading() {
  return (
    <div className="lap-page">
      <div className="lap-toolbar">
        <Skeleton inline width="var(--space-32)" height="var(--target-min)" radius="var(--radius-full)" />
        <div className="lap-toolbar-right">
          <Skeleton inline width="var(--space-24)" height="var(--target-min)" radius="var(--radius-full)" />
        </div>
      </div>

      <div className="board-head mt6">
        <div>
          <Skeleton width="var(--space-32)" height="var(--space-4)" />
          <Skeleton width="50%" height="var(--space-8)" radius="var(--radius-md)" className="mt2" />
        </div>
      </div>

      <div className="card tbl-card mt8 card-pad">
        <SkeletonTable rows={5} />
      </div>
    </div>
  );
}
