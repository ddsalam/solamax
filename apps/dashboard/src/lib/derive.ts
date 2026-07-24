/**
 * Derivasi murni untuk panel-panel spec (teruji unit test):
 * bauran NPSO/PSO, gain/loss %, ketahanan stok, verdict, dan cek alarm.
 * Aturan status TETAP dari compliance.ts — tidak ada aturan baru.
 */
import { classifyProduct, targetBauran, targetBauranRange, type FuelKind } from "./config";
import { isSelisihAbnormal } from "./compliance";

export interface ProductVol {
  nama: string | null;
  vol: number;
}

/**
 * Bauran (definisi workbook, TERKONFIRMASI): rasio volume —
 * gasoline = (Pertamax + Turbo) / Pertalite; gasoil = (Dexlite + Dex) / Solar.
 * null bila penyebut 0 (tak ada penjualan PSO jenis itu).
 */
export function bauran(products: ProductVol[], kind: FuelKind): number | null {
  let npso = 0;
  let pso = 0;
  for (const p of products) {
    const cls = classifyProduct(p.nama);
    if (!cls || cls.kind !== kind) continue;
    if (cls.pso) pso += p.vol;
    else npso += p.vol;
  }
  if (pso <= 0) return null;
  return npso / pso;
}

export interface BauranStatus {
  kind: FuelKind;
  actual: number | null;
  target: number | null;
  /** delta dalam poin persen (actual−target)×100; null bila salah satu null */
  deltaPt: number | null;
  below: boolean;
}

export function bauranVsTarget(
  products: ProductVol[],
  unitCode: string,
  month: number,
  kind: FuelKind,
): BauranStatus {
  const actual = bauran(products, kind);
  const target = targetBauran(unitCode, kind, month);
  const deltaPt =
    actual !== null && target !== null ? (actual - target) * 100 : null;
  return { kind, actual, target, deltaPt, below: deltaPt !== null && deltaPt < 0 };
}

/**
 * bauranVsTarget untuk RENTANG tanggal — target = rata-rata tertimbang hari
 * (targetBauranRange, keputusan owner FASE 0 №1). `withTarget=false` untuk
 * jendela pembanding tahun lalu (target workbook 2026 tak berlaku ke aktual
 * 2025 — sel tampil tanpa target).
 */
export function bauranVsTargetRange(
  products: ProductVol[],
  unitCode: string,
  range: { from: string; to: string },
  kind: FuelKind,
  withTarget = true,
): BauranStatus {
  const actual = bauran(products, kind);
  const target = withTarget ? targetBauranRange(unitCode, kind, range) : null;
  const deltaPt = actual !== null && target !== null ? (actual - target) * 100 : null;
  return { kind, actual, target, deltaPt, below: deltaPt !== null && deltaPt < 0 };
}

/** Gain/Loss % = total selisih opname ÷ total volume jual (bertanda). */
export function glPercent(totalSelisih: number, totalVol: number): number | null {
  if (totalVol <= 0) return null;
  return totalSelisih / totalVol;
}

/** Ambang spec: abnormal bila |selisih| > 100 L atau > 0,5% basis. */
export { isSelisihAbnormal };

// ---------------------------------------------------------------------------
// Gain/Loss dari opname PENUTUP + guard data-garbage (tambahan A)
// ---------------------------------------------------------------------------

/**
 * Ambang kewajaran fisik (bukan ambang losses operasional). Satu tangki SPBU
 * 20–40 KL; pembacaan/selisih di luar batas ini = error entri EasyMax (mis.
 * stok buku ±2 juta L 5 Jun; DO 452.729 L), BUKAN losses → dikecualikan dari
 * KPI/alarm G/L dan dimunculkan sebagai anomali KUALITAS DATA.
 */
export const GARBAGE_STOCK_L = 100_000; // tak ada tangki SPBU sebesar ini
export const GARBAGE_SELISIH_L = 50_000; // selisih sebesar ini = salah entri

/**
 * Ambang kewajaran PENJUALAN satu unit dalam satu hari. Dipakai HANYA sebagai
 * guard pencarian rekor grup ("Penjualan Total Tertinggi dalam 1 Hari") — bukan
 * ambang KPI, dan TIDAK menyaring baris dari tabel/total mana pun.
 *
 * Bukti angkanya (probe live 2026-07-24, seluruh sejarah 7 unit):
 *   - unit-hari SAH tertinggi yang pernah tercatat: **121.214 L** (KR 2021-11-06);
 *     era 2026 tak pernah melewati ~81.405 L (IB 2026-04-02).
 *   - satu-satunya unit-hari di atas 200.000 L: **31.615.851 L** (KR 2021-10-18)
 *     — sampah, ±260× hari tersibuk unit itu.
 * 200.000 L duduk ~1,6× di atas rekor sah dan ~158× di bawah sampahnya → tak ada
 * nilai nyata yang berisiko terpangkas.
 */
export const GARBAGE_DAY_SALES_L = 200_000;

export function isOpnameGarbage(bk: number | null, op: number | null): boolean {
  if (bk === null || op === null) return false; // null ditangani terpisah
  if (bk < 0 || op < 0) return true;
  if (bk > GARBAGE_STOCK_L || op > GARBAGE_STOCK_L) return true;
  if (Math.abs(op - bk) > GARBAGE_SELISIH_L) return true;
  return false;
}

/** Satu baris opname penutup per tangki (signed = fisik − buku). */
export interface ClosingRow {
  d: string; // tanggal bisnis
  ckdtangki: string;
  ckdbbm: string | null;
  nama: string | null;
  bk: number | null; // stok buku
  op: number | null; // stok fisik
  signed: number; // op − bk (bertanda; − = losses)
  dtgljam: string | null;
  provisional: boolean; // penutup D+1 belum terekam
}

export interface ClosingAgg {
  byProduct: Map<string, { nama: string | null; signed: number }>;
  totalSigned: number;
  provisional: boolean;
  /** Baris losses abnormal (lolos garbage, |signed|>100 L atau >0,5% buku). */
  abnormal: ClosingRow[];
  /** Baris kualitas-data (di luar ambang fisik). */
  garbage: ClosingRow[];
}

/**
 * Agregasi G/L dari baris opname penutup: jumlahkan SIGNED dari baris yang
 * lolos garbage guard; pisahkan baris garbage & abnormal untuk anomali.
 */
export function aggregateClosingGl(rows: ClosingRow[]): ClosingAgg {
  const byProduct = new Map<string, { nama: string | null; signed: number }>();
  const abnormal: ClosingRow[] = [];
  const garbage: ClosingRow[] = [];
  let totalSigned = 0;
  let provisional = false;

  for (const r of rows) {
    if (isOpnameGarbage(r.bk, r.op)) {
      garbage.push(r);
      continue;
    }
    if (r.provisional) provisional = true;
    totalSigned += r.signed;
    const key = r.ckdbbm ?? r.ckdtangki;
    const cur = byProduct.get(key);
    if (cur) cur.signed += r.signed;
    else byProduct.set(key, { nama: r.nama, signed: r.signed });
    if (isSelisihAbnormal(r.signed, r.bk)) abnormal.push(r);
  }
  return { byProduct, totalSigned, provisional, abnormal, garbage };
}

// ---------------------------------------------------------------------------
// Gain/Loss harian metode RESUME (Σ harian) — agregasi untuk tabel & kumulatif
// ---------------------------------------------------------------------------

/** Baris harian per produk dari getDailyGlByProduct (struktural; hindari siklus import). */
export interface DailyGlInput {
  ckdbbm: string;
  nama: string | null;
  gl: number | null; // bertanda; null = tak terhitung (anchor D−1 hilang)
  tera: number;
  excluded_tanks: number;
  provisional: boolean;
}

export interface DailyGlAgg {
  /** Per produk: G/L bertanda terjumlah + Σ tera. */
  byProduct: Map<string, { nama: string | null; signed: number; tera: number }>;
  totalSigned: number;
  totalTera: number;
  /** Ada baris provisional / gl tak terhitung → angka belum final. */
  provisional: boolean;
  /** Σ tangki garbage yang dikecualikan dari Stock Fisik. */
  excludedTanks: number;
  /** Ada minimal satu baris G/L terhitung (gl != null). */
  hasGl: boolean;
}

/**
 * Agregasi G/L harian (metode RESUME) per produk untuk satu hari (filter ke
 * tanggal di pemanggil) atau seluruh bulan (Σ harian → kumulatif). Baris gl=null
 * (anchor D−1 hilang) dilewati dari jumlah tapi menandai provisional. Tera tetap
 * dijumlah (kolom info, tak tergantung G/L terhitung).
 */
export function aggregateDailyGl(rows: DailyGlInput[]): DailyGlAgg {
  const byProduct = new Map<string, { nama: string | null; signed: number; tera: number }>();
  let totalSigned = 0;
  let totalTera = 0;
  let provisional = false;
  let excludedTanks = 0;
  let hasGl = false;

  for (const r of rows) {
    if (r.provisional) provisional = true;
    excludedTanks += r.excluded_tanks;
    const cur = byProduct.get(r.ckdbbm) ?? { nama: r.nama, signed: 0, tera: 0 };
    cur.tera += r.tera;
    totalTera += r.tera;
    if (r.gl === null) {
      provisional = true; // tak terhitung → jangan klaim final
    } else {
      hasGl = true;
      cur.signed += r.gl;
      totalSigned += r.gl;
    }
    byProduct.set(r.ckdbbm, cur);
  }
  return { byProduct, totalSigned, totalTera, provisional, excludedTanks, hasGl };
}

/**
 * Stok hasil hitung yang MUSTAHIL secara fisik (negatif) → jangan tampilkan
 * sebagai angka; render "data tak wajar". Backstop: idealnya tak terjadi setelah
 * mutasi garbage dibatasi di query (abs ≤ GARBAGE_STOCK_L), tapi menutup kelas
 * "nilai mustahil ditampilkan sebagai fakta" untuk data korup tak terduga.
 */
export function isStockImplausible(stock: number | null): boolean {
  return stock !== null && stock < 0;
}

/** Stok kini = stok opname − terjual sejak opname + diterima sejak opname. */
export function stockNow(
  stockOp: number | null,
  soldSince: number,
  receivedSince: number,
): number | null {
  if (stockOp === null) return null;
  return stockOp - soldSince + receivedSince;
}

/** Ketahanan hari = stok ÷ rata-rata jual harian; null bila tak terhitung. */
export function enduranceDays(
  stock: number | null,
  avgDaily: number,
): number | null {
  if (stock === null || avgDaily <= 0) return null;
  return stock / avgDaily;
}

/** Warna ketahanan ala spec: <1,5 hari merah, <3 kuning, else normal. */
export function enduranceLevel(days: number | null): "danger" | "warning" | "ok" | "unknown" {
  if (days === null) return "unknown";
  if (days < 1.5) return "danger";
  if (days < 3) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Verdict & chips (Board)
// ---------------------------------------------------------------------------

export interface VerdictChip {
  tone: "danger" | "warning";
  text: string;
}

export function verdictHeadline(chips: VerdictChip[]): string {
  if (chips.length === 0) return "Grup sehat.";
  const n = ["Satu", "Dua", "Tiga", "Empat", "Lima"][chips.length - 1] ?? String(chips.length);
  // Headline harus mencerminkan status: JANGAN bilang "sehat" bila ada chip danger.
  const hasDanger = chips.some((c) => c.tone === "danger");
  return hasDanger
    ? `Grup perlu tindakan. ${n} hal perlu perhatian.`
    : `Grup perlu perhatian. ${n} hal perlu ditinjau.`;
}

// ---------------------------------------------------------------------------
// Alarm indikator (Laporan Operasional) — 11 cek spec
// ---------------------------------------------------------------------------

export type AlarmState = "ok" | "fail" | "provisional" | "na";

export interface AlarmCheck {
  label: string;
  state: AlarmState;
  note: string;
}

/**
 * Skor cek alarm. `active` = cek yang sudah TERPUTUS final (ok + fail); skor =
 * ok/active. `provisional` (mis. losses harian partial-day) dilaporkan TERPISAH
 * — bukan pass, bukan fail — agar tak mengaburkan denominator. `na` (belum ada
 * data) juga di luar penyebut.
 */
export function alarmScore(checks: AlarmCheck[]): {
  ok: number;
  fail: number;
  active: number;
  provisional: number;
  na: number;
  text: string;
} {
  const ok = checks.filter((c) => c.state === "ok").length;
  const fail = checks.filter((c) => c.state === "fail").length;
  const provisional = checks.filter((c) => c.state === "provisional").length;
  const na = checks.filter((c) => c.state === "na").length;
  const active = ok + fail;
  return { ok, fail, active, provisional, na, text: `${ok}/${active}` };
}
