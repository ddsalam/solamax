/**
 * Spinner — primitif loader paling kecil. Mendukung facet rule-15: `size`
 * (sm/md/lg), `label` aksesibel (role=status + teks sr-only), inline vs block,
 * dan timing bersama (rotasi membaca --shimmer-duration via .spinner). Reduced
 * motion: berhenti berputar tapi cincin tetap TERLIHAT (lihat app.css).
 */
export function Spinner({
  size = "sm",
  label = "Memuat…",
  inline = false,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  inline?: boolean;
}) {
  return (
    <span
      className={inline ? "spinner-inline" : "spinner-block"}
      role="status"
      aria-live="polite"
    >
      <span className={`spinner ${size}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
