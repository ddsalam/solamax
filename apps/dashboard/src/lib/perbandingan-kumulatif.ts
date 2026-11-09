/**
 * Perbandingan Penjualan Kumulatif (format laporan Pak Hendra) — MURNI, tanpa I/O.
 * Menggantikan "Rasio & Persentase BBK" di Laporan Harian (SOLA-424).
 *
 * Rumus disalin dari spreadsheet "Laporan Perbandingan Penjualan Kumulatif":
 *   - Volume = SUMIFS liter per produk, tgl 1 s/d D bulan ini vs tgl 1 s/d tanggal
 *     yang sama bulan lalu; tanggal itu tak ada di bulan lalu → tanggal terakhirnya.
 *   - Porsi = baris ÷ BioSolar (kelompok Solar) atau ÷ Pertalite (kelompok Bensin).
 *   - D+D = Dexlite + P.Dex · JML Solar = BS + D+D · PTX+TURBO = Pertamax + Turbo ·
 *     JML Bensin = PL + PTX+TURBO · JML ALL = JML Solar + JML Bensin.
 *   - Delta = bulan ini − bulan lalu · Delta % = Delta ÷ bulan lalu.
 * Produk di luar enam key (PLK/Premium, kode tak dikenal) TIDAK masuk JML ALL —
 * sama dengan spreadsheet — tetapi volumenya dilaporkan di `otherCur/otherPrev`
 * supaya tidak hilang diam-diam.
 */
import { canonicalProductKey } from "./config";
import { normalizeProductIdentity } from "./derive";
import { addMonthsClamped, monthStart } from "./periods";
import type { DailySalesRow } from "./queries";

export interface PkRange {
  from: string;
  to: string;
  /** Hari terakhir rentang (N di "tgl 1–N"). */
  lastDay: number;
}

export interface PkRanges {
  cur: PkRange;
  prev: PkRange;
}

/** Rentang bulan ini (1..D) dan bulan lalu (1..D, dipotong ke akhir bulan lalu). */
export function perbandinganRanges(date: string): PkRanges {
  const prevTo = addMonthsClamped(date, -1);
  return {
    cur: { from: monthStart(date), to: date, lastDay: Number(date.slice(8, 10)) },
    prev: { from: monthStart(prevTo), to: prevTo, lastDay: Number(prevTo.slice(8, 10)) },
  };
}

type ProductKey = "SOLAR" | "DEXLITE" | "PERTAMINA DEX" | "PERTALITE" | "PERTAMAX" | "PERTAMAX TURBO";
const PRODUCT_KEYS: readonly ProductKey[] = ["SOLAR", "DEXLITE", "PERTAMINA DEX", "PERTALITE", "PERTAMAX", "PERTAMAX TURBO"];

export type PkRowKind = "item" | "subtotal" | "total";

export interface PkRow {
  key: string;
  label: string;
  kind: PkRowKind;
  cur: number;
  /** null = baris tanpa porsi (JML) atau penyebut 0. */
  curShare: number | null;
  prev: number;
  prevShare: number | null;
  delta: number;
  /** null = bulan lalu 0. */
  deltaPct: number | null;
}

export interface PkGroup {
  label: string;
  rows: PkRow[];
}

export interface PkTable {
  /** null = ALL (semua unit yang dipilih). */
  unitId: number | null;
  code: string;
  name: string;
  groups: PkGroup[];
  total: PkRow;
  otherCur: number;
  otherPrev: number;
}

export interface PkUnit {
  unitId: number;
  code: string;
  name: string;
}

type Vols = Record<ProductKey, number>;
const emptyVols = (): Vols => ({ SOLAR: 0, DEXLITE: 0, "PERTAMINA DEX": 0, PERTALITE: 0, PERTAMAX: 0, "PERTAMAX TURBO": 0 });

interface Bucket {
  cur: Vols;
  prev: Vols;
  otherCur: number;
  otherPrev: number;
}
const emptyBucket = (): Bucket => ({ cur: emptyVols(), prev: emptyVols(), otherCur: 0, otherPrev: 0 });

function productKeyOf(row: DailySalesRow): ProductKey | null {
  const key = canonicalProductKey(row.nama ?? normalizeProductIdentity(row.ckdbbm));
  return key !== null && (PRODUCT_KEYS as readonly string[]).includes(key) ? (key as ProductKey) : null;
}

const share = (v: number, base: number): number | null => (base > 0 ? v / base : null);

function row(key: string, label: string, kind: PkRowKind, cur: number, prev: number, curBase: number | null, prevBase: number | null): PkRow {
  const delta = cur - prev;
  return {
    key,
    label,
    kind,
    cur,
    curShare: curBase === null ? null : share(cur, curBase),
    prev,
    prevShare: prevBase === null ? null : share(prev, prevBase),
    delta,
    deltaPct: prev !== 0 ? delta / prev : null,
  };
}

function tableOf(unit: { unitId: number | null; code: string; name: string }, b: Bucket): PkTable {
  const { cur: c, prev: p } = b;
  const dd = (v: Vols) => v.DEXLITE + v["PERTAMINA DEX"];
  const ptxT = (v: Vols) => v.PERTAMAX + v["PERTAMAX TURBO"];
  const solar = (v: Vols) => v.SOLAR + dd(v);
  const bensin = (v: Vols) => v.PERTALITE + ptxT(v);
  const sb = [c.SOLAR, p.SOLAR] as const;
  const pb = [c.PERTALITE, p.PERTALITE] as const;
  return {
    ...unit,
    groups: [
      {
        label: "SOLAR / DIESEL (porsi terhadap BioSolar)",
        rows: [
          row("BS", "BS · BioSolar", "item", c.SOLAR, p.SOLAR, ...sb),
          row("DL", "DL · Dexlite", "item", c.DEXLITE, p.DEXLITE, ...sb),
          row("DEX", "DEX · Pertamina Dex", "item", c["PERTAMINA DEX"], p["PERTAMINA DEX"], ...sb),
          row("DD", "D+D (DL + DEX)", "item", dd(c), dd(p), ...sb),
          row("JML_SOLAR", "JML Solar", "subtotal", solar(c), solar(p), null, null),
        ],
      },
      {
        label: "BENSIN (porsi terhadap Pertalite)",
        rows: [
          row("PL", "PL · Pertalite", "item", c.PERTALITE, p.PERTALITE, ...pb),
          row("PTX", "PTX · Pertamax", "item", c.PERTAMAX, p.PERTAMAX, ...pb),
          row("TURBO", "TURBO · Pertamax Turbo", "item", c["PERTAMAX TURBO"], p["PERTAMAX TURBO"], ...pb),
          row("PTX_TURBO", "PTX + TURBO", "item", ptxT(c), ptxT(p), ...pb),
          row("JML_BENSIN", "JML Bensin", "subtotal", bensin(c), bensin(p), null, null),
        ],
      },
    ],
    total: row("JML_ALL", "JML ALL", "total", solar(c) + bensin(c), solar(p) + bensin(p), null, null),
    otherCur: b.otherCur,
    otherPrev: b.otherPrev,
  };
}

/**
 * Tabel ALL (unit-unit yang diberikan) lalu satu tabel per unit, urutan `units`.
 * `rows` boleh mencakup tanggal di luar kedua rentang (diabaikan) dan unit lain
 * (diabaikan) — halaman memberi baris 12 bulan apa adanya.
 */
export interface Perbandingan {
  ranges: PkRanges;
  tables: PkTable[];
}

export function buildPerbandingan(rows: readonly DailySalesRow[], units: readonly PkUnit[], date: string): Perbandingan {
  const ranges = perbandinganRanges(date);
  const buckets = new Map<number, Bucket>(units.map((u) => [u.unitId, emptyBucket()]));
  const all = emptyBucket();
  const inRange = (d: string, r: PkRange) => d >= r.from && d <= r.to;

  for (const r of rows) {
    const b = buckets.get(r.unit_id);
    if (!b) continue;
    const period = inRange(r.d, ranges.cur) ? "cur" : inRange(r.d, ranges.prev) ? "prev" : null;
    if (period === null) continue;
    const key = productKeyOf(r);
    for (const t of [b, all]) {
      if (key === null) {
        if (period === "cur") t.otherCur += r.vol;
        else t.otherPrev += r.vol;
      } else {
        t[period][key] += r.vol;
      }
    }
  }

  return {
    ranges,
    tables: [
      tableOf({ unitId: null, code: "ALL", name: "SEMUA SPBU" }, all),
      ...units.map((u) => tableOf(u, buckets.get(u.unitId)!)),
    ],
  };
}
