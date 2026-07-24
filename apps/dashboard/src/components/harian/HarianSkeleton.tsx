import { Skeleton, SkeletonTable } from "@/components/loading/Skeleton";

/**
 * Cermin struktur Laporan Harian: head → 4 kartu ringkas → tabel matriks.
 * Berukuran agar TIDAK menggeser tata letak saat data asli masuk.
 */
export function HarianSkeleton() {
  return (
    <div>
      <div className="board-head mt4">
        <div>
          <Skeleton width="var(--space-32)" height="var(--space-4)" />
          <Skeleton width="60%" height="var(--space-10)" radius="var(--radius-md)" className="mt2" />
          <Skeleton width="40%" height="var(--space-4)" className="mt2" />
        </div>
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
      <div className="card tbl-card mt10 card-pad">
        <SkeletonTable rows={8} />
      </div>
      <div className="card tbl-card mt10 card-pad">
        <SkeletonTable rows={8} />
      </div>
    </div>
  );
}
