/**
 * Seksi tabel Laporan Harian (server component murni — hanya membaca model).
 *
 * Aturan tampilan yang mengikat (keputusan owner №4 + №7):
 *  - Kolom unit BASI ditandai `⚠` + subteks "data s/d …". Sel-selnya TETAP
 *    menampilkan angka — tampilkan, tapi tandai keras.
 *  - Kolom/baris TOTAL diberi label "TIDAK LENGKAP" selama ada unit basi.
 *  - Unit yang BELUM beroperasi pada tanggal itu dirender "—", bukan 0.
 */
import { fmtL, idn, pct, signed } from "@/lib/format";
import type {
  BbkCell,
  HarianModel,
  MonthlyRow,
  RatioCell,
  UnitStatus,
  ValueRow,
} from "@/lib/harian-model";

const nbsp = " ";

function colStyle(n: number): React.CSSProperties {
  return { ["--ncols" as string]: String(n) };
}

/** Kepala kolom unit — dipakai semua tabel matriks. */
function UnitHeads({ units }: { units: UnitStatus[] }) {
  return (
    <>
      {units.map((u) => (
        <span key={u.unitId} className={`right${u.stale ? " harian-stale-head" : ""}`}>
          {u.stale && <span aria-hidden>⚠ </span>}
          {u.name}
          {u.stale && u.lastDataDate && (
            <span className="harian-stale-sub">data s/d {u.lastDataDate.slice(8)}/{u.lastDataDate.slice(5, 7)}</span>
          )}
        </span>
      ))}
    </>
  );
}

function cellText(u: UnitStatus, v: number | undefined, fmt: (n: number) => string): string {
  if (u.notYet) return "—";
  return fmt(v ?? 0);
}

/** Kelas warna untuk angka bertanda (dipakai tabel G/L): negatif = danger. */
function toneOf(signTone: boolean, v: number | undefined): string {
  return signTone && (v ?? 0) < 0 ? " t-danger" : "";
}

// ---------------------------------------------------------------------------

export function MatrixTable({
  title,
  hint,
  units,
  rows,
  totalsByUnit,
  grandTotal,
  incomplete,
  fmt = (n) => idn(Math.round(n)),
  delta,
  deltaTotal,
  signTone = false,
  provisional = false,
}: {
  title: string;
  hint: string;
  units: UnitStatus[];
  rows: ValueRow[];
  totalsByUnit: Record<number, number>;
  grandTotal: number;
  incomplete: boolean;
  fmt?: (n: number) => string;
  delta?: Record<number, number | null>;
  deltaTotal?: number | null;
  /** true = angka bertanda (G/L): negatif diberi warna danger. */
  signTone?: boolean;
  /** true = baris G/L tanggal ini masih provisional (penutup belum final). */
  provisional?: boolean;
}) {
  const style = colStyle(units.length);
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">{title}</div>
        <span className="fs16 t-tertiary">{hint}</span>
      </div>
      <div className="card tbl-card mt5 harian-scroll">
        <div className="harian-min">
          <div className="grid-head cols-harian" style={style}>
            <span>Produk</span>
            <UnitHeads units={units} />
            <span className="right">TOTAL{incomplete ? nbsp : ""}</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid-row cols-harian" style={style}>
              <span className="fs16 t-primary">{r.label}</span>
              {units.map((u) => (
                <span key={u.unitId} className={`fs16 right num${toneOf(signTone, r.byUnit[u.unitId])}`}>
                  {cellText(u, r.byUnit[u.unitId], fmt)}
                </span>
              ))}
              <span className={`fs16 w600 right num${toneOf(signTone, r.total)}`}>{fmt(r.total)}</span>
            </div>
          ))}
          <div className="grid-total cols-harian" style={style}>
            <span className="fs16 w700 t-brand">Total</span>
            {units.map((u) => (
              <span key={u.unitId} className={`fs16 w700 right num${toneOf(signTone, totalsByUnit[u.unitId])}`}>
                {cellText(u, totalsByUnit[u.unitId], fmt)}
              </span>
            ))}
            <span className={`fs16 w700 right num${toneOf(signTone, grandTotal)}`}>{fmt(grandTotal)}</span>
          </div>
          {delta && (
            <div className="grid-row cols-harian harian-delta" style={style}>
              <span className="fs15 t-tertiary">Δ vs hari sebelumnya</span>
              {units.map((u) => {
                const d = delta[u.unitId];
                return (
                  <span
                    key={u.unitId}
                    className={`fs15 right num ${d === null || d === undefined ? "t-tertiary" : d < 0 ? "t-danger" : "t-success"}`}
                  >
                    {d === null || d === undefined ? "—" : signed(Math.round(d))}
                  </span>
                );
              })}
              <span
                className={`fs15 w600 right num ${
                  deltaTotal === null || deltaTotal === undefined
                    ? "t-tertiary"
                    : deltaTotal < 0
                      ? "t-danger"
                      : "t-success"
                }`}
              >
                {deltaTotal === null || deltaTotal === undefined ? "—" : signed(Math.round(deltaTotal))}
              </span>
            </div>
          )}
        </div>
      </div>
      {incomplete && (
        <div className="fs15 t-warning mt2">
          ⚠ TOTAL menjumlah unit yang datanya belum lengkap untuk tanggal ini — angkanya terlalu kecil.
        </div>
      )}
      {provisional && (
        <div className="fs15 t-warning mt2">
          ⏳ Angka SEMENTARA — opname penutup tanggal ini belum lengkap (baru terekam pagi
          berikutnya). Nilai akan berubah.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MonthlyMatrix({
  title,
  hint,
  units,
  rows,
  totalsByUnit,
  grand,
  divisor,
  incomplete,
  signTone = false,
}: {
  title: string;
  hint: string;
  units: UnitStatus[];
  rows: MonthlyRow[];
  totalsByUnit: Record<number, { kum: number; avg: number }>;
  grand: { kum: number; avg: number };
  divisor: number;
  incomplete: boolean;
  signTone?: boolean;
}) {
  const style = colStyle(units.length * 2);
  const cell = (u: UnitStatus, c: { kum: number; avg: number } | undefined, bold = false) =>
    u.notYet ? (
      <>
        <span key={`${u.unitId}k`} className={`fs16 right num${bold ? " w700" : ""}`}>—</span>
        <span key={`${u.unitId}a`} className="fs15 right num t-tertiary">—</span>
      </>
    ) : (
      <>
        <span
          key={`${u.unitId}k`}
          className={`fs16 right num${bold ? " w700" : ""}${toneOf(signTone, c?.kum)}`}
        >
          {idn(Math.round(c?.kum ?? 0))}
        </span>
        <span key={`${u.unitId}a`} className="fs15 right num t-tertiary">
          {idn(Math.round(c?.avg ?? 0))}
        </span>
      </>
    );

  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">{title}</div>
        <span className="fs16 t-tertiary">{hint}</span>
      </div>
      <div className="card tbl-card mt5 harian-scroll">
        <div className="harian-min-wide">
          <div className="grid-head cols-harian2" style={style}>
            <span>Produk</span>
            {units.map((u) => (
              <span key={u.unitId} className={`right harian-span2${u.stale ? " harian-stale-head" : ""}`}>
                {u.stale && <span aria-hidden>⚠ </span>}
                {u.name}
                <span className="harian-stale-sub">Kumulatif · Rata-Rata (÷{divisor} hari)</span>
              </span>
            ))}
            <span className="right harian-span2">
              TOTAL
              <span className="harian-stale-sub">Kumulatif · Rata-Rata</span>
            </span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid-row cols-harian2" style={style}>
              <span className="fs16 t-primary">{r.label}</span>
              {units.map((u) => cell(u, r.byUnit[u.unitId]))}
              <span className="fs16 w600 right num">{idn(Math.round(r.total.kum))}</span>
              <span className="fs15 right num t-tertiary">{idn(Math.round(r.total.avg))}</span>
            </div>
          ))}
          <div className="grid-total cols-harian2" style={style}>
            <span className="fs16 w700 t-brand">Total</span>
            {units.map((u) => cell(u, totalsByUnit[u.unitId], true))}
            <span className="fs16 w700 right num">{idn(Math.round(grand.kum))}</span>
            <span className="fs15 w600 right num t-tertiary">{idn(Math.round(grand.avg))}</span>
          </div>
        </div>
      </div>
      {incomplete && (
        <div className="fs15 t-warning mt2">⚠ TOTAL tidak lengkap — lihat banner di atas halaman.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * RASIO + BBK dalam SATU tabel dengan rumusnya tercetak. Digabung dengan sengaja:
 * keduanya turun dari angka yang sama tetapi punya PENYEBUT berbeda, dan selama
 * ini hidup di dua halaman berbeda sehingga dikira sama. Rumus di layar =
 * pertahanan termurah terhadap kekeliruan itu.
 */
export function RatioBbkTable({
  units,
  model,
}: {
  units: UnitStatus[];
  model: HarianModel;
}) {
  const style = colStyle(units.length);
  const P = (v: number | null) => (v === null ? "—" : pct(v, 2));

  const block = (
    label: string,
    get: (id: number) => RatioCell,
    total: RatioCell,
  ) => (
    <>
      <div className="grid-row cols-harian harian-subhead" style={style}>
        <span className="fs15 w700 t-tertiary">{label}</span>
        {units.map((u) => (
          <span key={u.unitId} />
        ))}
        <span />
      </div>
      {(
        [
          ["% Dexlite / Solar", (c: RatioCell) => c.dexSolar],
          ["% P Dex / Solar", (c: RatioCell) => c.pdexSolar],
          ["Total (= bauran gasoil)", (c: RatioCell) => c.total],
        ] as const
      ).map(([name, pick]) => (
        <div key={name} className="grid-row cols-harian" style={style}>
          <span className="fs16 t-primary">{name}</span>
          {units.map((u) => (
            <span key={u.unitId} className="fs16 right num">
              {u.notYet ? "—" : P(pick(get(u.unitId)))}
            </span>
          ))}
          <span className="fs16 w600 right num">{P(pick(total))}</span>
        </div>
      ))}
    </>
  );

  const bbkRow = (name: string, pick: (c: BbkCell) => number | null) => (
    <div key={name} className="grid-row cols-harian" style={style}>
      <span className="fs16 t-primary">{name}</span>
      {units.map((u) => (
        <span key={u.unitId} className="fs16 right num">
          {u.notYet ? "—" : P(pick(model.bbk.monthly[u.unitId] ?? { gasoline: null, diesel: null }))}
        </span>
      ))}
      <span className="fs16 w600 right num">{P(pick(model.bbk.monthlyTotal))}</span>
    </div>
  );

  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Rasio &amp; Persentase BBK</div>
        <span className="fs16 t-tertiary">dua definisi berbeda — penyebutnya tercetak</span>
      </div>
      <div className="card tbl-card mt5 harian-scroll">
        <div className="harian-min">
          <div className="grid-head cols-harian" style={style}>
            <span>Rasio</span>
            <UnitHeads units={units} />
            <span className="right">TOTAL</span>
          </div>
          {block("HARIAN", (id) => model.ratios.daily[id] ?? { dexSolar: null, pdexSolar: null, total: null }, model.ratios.dailyTotal)}
          {block("BULANAN (MTD)", (id) => model.ratios.monthly[id] ?? { dexSolar: null, pdexSolar: null, total: null }, model.ratios.monthlyTotal)}
          <div className="grid-row cols-harian harian-subhead" style={style}>
            <span className="fs15 w700 t-tertiary">PERSENTASE BBK (bulan berjalan)</span>
            {units.map((u) => (
              <span key={u.unitId} />
            ))}
            <span />
          </div>
          {bbkRow("GASOLINE", (c) => c.gasoline)}
          {bbkRow("DIESEL", (c) => c.diesel)}
        </div>
      </div>
      <div className="fs15 t-tertiary mt2">
        Rasio: pembilang ÷ <b>Solar</b> (baris Total ≡ bauran gasoil (Dexlite + P.Dex) ÷ Solar).
        BBK: NPSO ÷ (NPSO + PSO) <i>dalam jenis yang sama</i> — GASOLINE = (Pertamax + Turbo) ÷
        (Pertalite + Pertamax + Turbo), DIESEL = (Dexlite + P.Dex) ÷ (Solar + Dexlite + P.Dex).
        Keduanya bukan angka yang sama.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RecordCard({ units, model }: { units: UnitStatus[]; model: HarianModel }) {
  const r = model.record;
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Rekor — penjualan grup tertinggi dalam 1 hari</div>
        <span className="fs16 t-tertiary">
          periode pembanding {r.from} – {r.to}
        </span>
      </div>
      {r.date === null ? (
        <div className="card card-pad mt5 empty-inline">
          Belum ada hari yang bisa dibandingkan pada periode ini.
        </div>
      ) : (
        <div className="card tbl-card mt5 harian-scroll">
          <div className="harian-min">
            <div className="grid-head cols-harian" style={colStyle(units.length)}>
              <span>Tanggal</span>
              <UnitHeads units={units} />
              <span className="right">TOTAL</span>
            </div>
            <div className="grid-total cols-harian" style={colStyle(units.length)}>
              <span className="fs16 w700 t-brand">{r.date}</span>
              {units.map((u) => (
                <span key={u.unitId} className="fs16 right num">
                  {idn(Math.round(r.byUnit[u.unitId] ?? 0))}
                </span>
              ))}
              <span className="fs16 w700 right num">{idn(Math.round(r.total))}</span>
            </div>
          </div>
        </div>
      )}
      <div className="fs15 t-tertiary mt2">
        Periode dimulai {r.from} — tanggal seluruh armada terpantau di SolaMax. Sebelum itu TOTAL
        harian selalu kurang satu unit atau lebih, sehingga rekornya tak sebanding. Bertambahnya SPBU
        akan menggeser batas ini.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function StaleBanner({ model }: { model: HarianModel }) {
  const s = model.freshness.staleUnits;
  if (s.length === 0) return null;
  return (
    <div className="banner danger mt5">
      <span className="dot danger" />
      <div>
        <div className="fs16 w700 t-danger">
          TOTAL di halaman ini TIDAK LENGKAP — {s.length} dari {model.units.length} SPBU belum
          mengirim data untuk {model.date}.
        </div>
        <div className="fs15 t-secondary mt2">
          {s
            .map((u) =>
              u.lastDataDate
                ? `${u.name} (terakhir ${u.lastDataDate}, −${u.daysBehind} hari)`
                : `${u.name} (belum ada data)`,
            )
            .join(" · ")}
        </div>
        <div className="fs15 t-tertiary mt2">
          Angka TOTAL tetap ditampilkan tetapi terlalu kecil. Kolom unit yang tertinggal ditandai ⚠.
        </div>
      </div>
    </div>
  );
}

export function HarianNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="card card-pad mt10">
      <div className="text-caption t-tertiary">Catatan data</div>
      <ul className="harian-notes mt2">
        {notes.map((n, i) => (
          <li key={i} className="fs15 t-secondary">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { fmtL };
