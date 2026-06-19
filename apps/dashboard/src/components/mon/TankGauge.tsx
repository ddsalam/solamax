import { fmtCm, fmtL, fmtTemp, idn } from "@/lib/format";

/**
 * Gauge tangki + blok detail terukur untuk kartu denah (Monitoring Realtime).
 * Presentational murni: semua nilai sudah diturunkan di page. Degradasi anggun —
 * tiap baris yang datanya hilang tampil "n/a" (muted), TAK pernah jadi placeholder
 * kosong. Bila fill% null (kapasitas/volume tak ada) gauge tampil "level" netral
 * dan halaman tetap memakai visual ketahanan di kepala kartu.
 */
export interface TankGaugeProps {
  fillPct: number | null;
  /** Nama CSS var warna isi per produk (mis. "--tank-solar"); null → netral. */
  fillVar: string | null;
  level: "danger" | "warning" | "ok" | "unknown";
  fuelMm: number | null; // ntinggi (mm)
  waterMm: number | null; // ntinggiair (mm)
  waterL: number | null; // nvolumeair (L)
  tempC: number | null; // nsuhu (°C); ≤0 dianggap tak terbaca → null di page
  ullageL: number | null; // kapasitas − volume (L)
  capacityL: number | null; // kapasitas maksimum tangki (L, dari config/kalibrasi)
  /**
   * true bila pembacaan ATG mustahil secara fisik (volume > kapasitas, atau
   * tinggi minyak > tinggi strapping tangki) → sensor faulting. Ditandai
   * eksplisit alih-alih disembunyikan sbg "100% penuh".
   */
  anomaly: boolean;
  lastFill: { vol: number | null; selisih: number | null; bad?: boolean } | null;
  /** Umur pembacaan ATG; null bila tak ada pembacaan (kartu pakai estimasi opname). */
  reading: { ageText: string; stale: boolean } | null;
}

const NA = <span className="t-tertiary">n/a</span>;

function Row({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`tg-row${wide ? " tg-row-wide" : ""}`}>
      <span className="tg-k t-tertiary">{label}</span>
      <span className="tg-v num">{children}</span>
    </div>
  );
}

export function TankGauge(props: TankGaugeProps) {
  const { fillPct, fillVar, level, fuelMm, waterMm, waterL, tempC, ullageL, capacityL, anomaly, lastFill, reading } = props;
  const fillStyle = anomaly || !fillVar ? undefined : { background: `var(${fillVar})` };

  return (
    <div>
      <div className={`tank-cyl${anomaly ? " anom" : ""}`}>
        {fillPct !== null && (
          <div
            className={`tank-fill${anomaly ? " anom" : fillVar ? " product" : level === "danger" ? " danger" : level === "warning" ? " warning" : ""}`}
            style={{ height: `${Math.max(2, Math.round(fillPct))}%`, ...fillStyle }}
          />
        )}
        <div className="tank-pct num">
          {anomaly ? (
            <span className="tg-anom-badge">⚠ ATG tak wajar</span>
          ) : fillPct !== null ? (
            `${idn(fillPct)}%`
          ) : (
            <span className="fs15 t-tertiary">level via ketahanan</span>
          )}
        </div>
      </div>

      <div className="tg-grid mt2">
        <Row label="Minyak">{fuelMm !== null ? fmtCm(fuelMm) : NA}</Row>
        <Row label="Air">{waterMm !== null ? `${fmtCm(waterMm)}${waterL ? ` · ${fmtL(waterL)}` : ""}` : NA}</Row>
        <Row label="Suhu">{tempC !== null ? fmtTemp(tempC) : NA}</Row>
        <Row label="Ruang kosong">
          {/* Anomali → tampilkan ullage nyata (bisa negatif) dlm nada danger, bukan dibulatkan ke 0. */}
          {ullageL !== null ? (
            anomaly ? <span className="t-danger">{fmtL(ullageL)}</span> : fmtL(Math.max(0, ullageL))
          ) : (
            NA
          )}
        </Row>
        <Row label="Kapasitas" wide>{capacityL !== null ? fmtL(capacityL) : NA}</Row>
      </div>

      <div className="tg-sub mt2">
        <div className="tg-sub-h t-tertiary fs15">Pengisian terakhir</div>
        {lastFill?.bad ? (
          <div className="fs15 t-warning">data tak wajar — perlu koreksi entri</div>
        ) : (
          <div className="tg-grid">
            <Row label="Volume">{lastFill?.vol != null ? fmtL(lastFill.vol) : NA}</Row>
            <Row label="Selisih">
              {lastFill?.selisih != null ? fmtL(lastFill.selisih) : NA}
            </Row>
          </div>
        )}
      </div>

      {reading && (
        <div className={`tg-live fs15 mt1${reading.stale ? " stale" : ""}`}>
          ● ATG · {reading.ageText}
        </div>
      )}
    </div>
  );
}
