import Link from "next/link";
import type { AnomalyItem } from "@/lib/anomalies";

/** Feed anomali & exception — diurutkan dari yang paling perlu tindakan. */
export function AnomalyFeed({
  items,
  withLinks = true,
}: {
  items: AnomalyItem[];
  withLinks?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="banner info">
        <span className="dot lg info" />
        <div>
          <div className="text-caption w600 t-info">Tidak ada anomali terbuka</div>
          <div className="fs16 t-secondary mt1">
            Semua indikator dalam ambang pada data tersinkron terakhir.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="anom-list">
      {items.map((a, i) => (
        <div key={i} className={`anom ${a.tone}`}>
          <span className={`dot lg ${a.tone}`} />
          <div className="anom-body">
            <div className="section-h">
              <span className={`text-caption w600 anom-title ${a.tone}`}>{a.title}</span>
              <span className="fs15 t-tertiary">{a.unit}</span>
            </div>
            <div className="fs16 t-secondary mt1">{a.desc}</div>
          </div>
          {withLinks && a.href ? (
            <Link href={a.href} className="fs15 w600 t-accent nowrap">
              Buka laporan →
            </Link>
          ) : (
            <span className="fs15 t-tertiary nowrap">{a.time}</span>
          )}
        </div>
      ))}
    </div>
  );
}
