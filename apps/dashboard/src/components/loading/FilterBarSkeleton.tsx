import { Skeleton } from "@/components/loading/Skeleton";

/**
 * Cermin baris filter milik halaman (UnitDateFilters) untuk loading.tsx rute
 * per-unit. Ada karena filter kini hidup DI halaman: tanpa placeholder ini
 * baris filter lenyap selama memuat lalu muncul lagi — persis pergeseran tata
 * letak yang dilarang (rule 9).
 *
 * `date=false` untuk halaman tanpa dimensi tanggal (denah realtime).
 */
export function FilterBarSkeleton({ date = true }: { date?: boolean }) {
  return (
    <div className="board-filters">
      <Skeleton inline width="var(--space-32)" height="var(--target-min)" radius="var(--radius-full)" />
      {date && (
        <div className="range-inputs">
          <Skeleton inline width="var(--space-12)" height="var(--space-5)" />
          <Skeleton inline width="var(--space-24)" height="var(--target-min)" radius="var(--radius-full)" />
        </div>
      )}
    </div>
  );
}
