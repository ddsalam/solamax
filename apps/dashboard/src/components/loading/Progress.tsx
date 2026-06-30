/**
 * Progress — bar progres untuk loader TERUKUR (rule 11). `value` 0..100; `null`
 * = indeterminate (sweep). DIBANGUN untuk kelengkapan kit; TIDAK diwire di pilot
 * (beban laporan G/L tak terukur → pakai pesan eskalasi, bukan bar palsu). Tetap
 * diekspor agar siap dipakai bila ada loader terukur kelak.
 */
export function Progress({
  value = null,
  label = "Memuat…",
  size,
}: {
  value?: number | null;
  label?: string;
  size?: string;
}) {
  const indet = value === null;
  const clamped = indet ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indet ? undefined : clamped}
      style={{ width: size }}
    >
      <div
        className={`progress-bar${indet ? " indet" : ""}`}
        style={indet ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
