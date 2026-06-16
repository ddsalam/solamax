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
  lastFill: { vol: number | null; selisih: number | null } | null;
  /** true bila angka volume/tinggi/suhu berasal dari ATG live (real_tank). */
  live: boolean;
}

const NA = <span className="t-tertiary">n/a</span>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tg-row">
      <span className="tg-k t-tertiary">{label}</span>
      <span className="tg-v num">{children}</span>
    </div>
  );
}

export function TankGauge(props: TankGaugeProps) {
  const { fillPct, fillVar, level, fuelMm, waterMm, waterL, tempC, ullageL, lastFill, live } = props;
  const fillStyle = fillVar ? { background: `var(${fillVar})` } : undefined;

  return (
    <div>
      <div className="tank-cyl">
        {fillPct !== null && (
          <div
            className={`tank-fill${fillVar ? " product" : level === "danger" ? " danger" : level === "warning" ? " warning" : ""}`}
            style={{ height: `${Math.max(2, Math.round(fillPct))}%`, ...fillStyle }}
          />
        )}
        <div className="tank-pct num">
          {fillPct !== null ? `${idn(fillPct)}%` : <span className="fs15 t-tertiary">level via ketahanan</span>}
        </div>
      </div>

      <div className="tg-grid mt2">
        <Row label="Minyak">{fuelMm !== null ? fmtCm(fuelMm) : NA}</Row>
        <Row label="Air">{waterMm !== null ? `${fmtCm(waterMm)}${waterL ? ` · ${fmtL(waterL)}` : ""}` : NA}</Row>
        <Row label="Suhu">{tempC !== null ? fmtTemp(tempC) : NA}</Row>
        <Row label="Ruang kosong">{ullageL !== null ? fmtL(Math.max(0, ullageL)) : NA}</Row>
      </div>

      <div className="tg-sub mt2">
        <div className="tg-sub-h t-tertiary fs15">Pengisian terakhir</div>
        <div className="tg-grid">
          <Row label="Volume">{lastFill?.vol != null ? fmtL(lastFill.vol) : NA}</Row>
          <Row label="Selisih">
            {lastFill?.selisih != null ? fmtL(lastFill.selisih) : NA}
          </Row>
        </div>
      </div>

      {live && <div className="tg-live fs15 mt1">● ATG live</div>}
    </div>
  );
}
