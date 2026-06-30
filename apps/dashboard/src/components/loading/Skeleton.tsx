/**
 * Skeleton + varian (Text / Table / Card) — placeholder berbentuk konten untuk
 * cegah pergeseran tata letak (rule 9). Shimmer membaca --shimmer-duration
 * (timing bersama, rule 15) dan kalem saat prefers-reduced-motion. Dekoratif:
 * `aria-hidden` pada blok; wadah yang merender skeleton memegang status "memuat".
 *
 * `width`/`height` menerima nilai CSS (mis. "60%", "var(--space-10)") — JANGAN
 * px mentah di literal (lint DS). Default block (full-width); `inline` untuk
 * lebar token sebaris.
 */
export function Skeleton({
  width,
  height,
  radius,
  inline = false,
  className = "",
}: {
  width?: string;
  height?: string;
  radius?: string;
  inline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`skel-shimmer ${className}`}
      aria-hidden="true"
      style={{
        display: inline ? "inline-block" : "block",
        width,
        height,
        borderRadius: radius,
      }}
    />
  );
}

/** Beberapa baris teks; baris terakhir pendek (mirip paragraf). */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="skel-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={`skel-shimmer skel-line${i === lines - 1 && lines > 1 ? " short" : ""}`}
        />
      ))}
    </span>
  );
}

/** Tabel placeholder; `cols` hanya mempengaruhi tinggi/jumlah baris, bukan grid
 *  nyata (skeleton tak perlu kolom presisi—cukup tinggi & ritme baris cocok). */
export function SkeletonTable({
  rows = 5,
  head = true,
}: {
  rows?: number;
  head?: boolean;
}) {
  return (
    <div className="skel-table" role="status" aria-label="Memuat tabel" aria-live="polite">
      {head && <span className="skel-shimmer skel-row head" aria-hidden="true" />}
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skel-shimmer skel-row" aria-hidden="true" />
      ))}
      <span className="sr-only">Memuat tabel…</span>
    </div>
  );
}

/** Kartu placeholder; `media` menambah blok besar di atas (mis. grafik/gauge). */
export function SkeletonCard({
  lines = 3,
  media = false,
}: {
  lines?: number;
  media?: boolean;
}) {
  return (
    <div className="skel-card" aria-hidden="true">
      {media && <span className="skel-shimmer skel-media" />}
      <SkeletonText lines={lines} />
    </div>
  );
}
