import { bacaRupiah } from "./angka-input";
import { rpSen, rupiahKeSen } from "./pihak-lawan-model";
import { KODE_MAJU_PURCHASE } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";
import { DATE_RE } from "./selection-keys";

/**
 * Penebusan BBM per nomor SO — MURNI, tanpa I/O (rencana 2026-10-29 U7;
 * R10–R15, R29; KTD9). Dipakai server action (`penebusan-actions.ts`), kueri
 * (`penebusan-queries.ts`), formulir, dan ekspor — satu aturan, satu tempat.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Σ komponen = Gross, tepat Rp 0, dalam SEN BULAT** (R10, AE2). Net + PPN
 *    + PPh + PBBKB + Nota (bertanda). Tak pernah float; pesan tolaknya menyebut
 *    selisihnya. CHECK `penebusan_jumlah_komponen` (0050) menegakkan hal yang
 *    sama di DB.
 * 2. **Penebusan memiliki SATU baris kas "Pembelian BBM" −Gross** (KTD9, R29):
 *    bila baris itu sudah diketik manual (rekening sama, nominal sama, tanggal
 *    sama, belum diikat) penebusan MENGIKATNYA; dua kandidat atau lebih ⇒
 *    Keuangan memilih, tak pernah ditebak. Arus kas "Penebusan SO" tetap
 *    Σ baris kas kategori itu (`keuangan-sisi-kas.ts`) — tak ada hitung ganda.
 * 3. **HPP / harga beli / laba tidak disentuh** (R14). Tak ada fungsi di sini
 *    yang menghasilkan angka laba.
 */

export const KATEGORI_PENEBUSAN = "Pembelian BBM";
/** Kode alasan maju (0049) bila hari bayarnya sudah ditutup (R28). */
export const KODE_MAJU_PENEBUSAN = KODE_MAJU_PURCHASE;


/** Konvensi `lower(trim(cnoso))` — `so_macet` (0028) dan join EasyMax di `queries.ts`. */
export function normalisasiSo(s: string): string {
  return s.trim().toLowerCase();
}

export function keteranganKasPenebusan(noSoTampil: string): string {
  return `Penebusan SO ${noSoTampil}`;
}

export const KOMPONEN = ["net", "ppn", "pph", "pbbkb", "nota"] as const;
export type Komponen = (typeof KOMPONEN)[number];

export const LABEL_KOMPONEN: Record<Komponen | "gross", string> = {
  net: "Harga Net",
  ppn: "PPN",
  pph: "PPh",
  pbbkb: "PBBKB",
  nota: "Nota Debet/Kredit",
  gross: "Harga Gross",
};

export interface MasukanPenebusan {
  noSo: string;
  tanggalBayar: string;
  accountId: string;
  net: number;
  ppn: number;
  pph: number;
  pbbkb: number;
  /** BERTANDA: nota debet menambah (+), nota kredit mengurangi (−). */
  nota: number;
  gross: number;
}

export type SenPenebusan = Record<Komponen | "gross", number>;

export type HasilPeriksaPenebusan =
  | { ok: true; noSo: string; noSoTampil: string; sen: SenPenebusan }
  | { ok: false; error: string };

export function periksaPenebusan(m: MasukanPenebusan): HasilPeriksaPenebusan {
  const noSoTampil = typeof m.noSo === "string" ? m.noSo.trim() : "";
  const noSo = normalisasiSo(noSoTampil);
  if (noSo === "") return { ok: false, error: "Nomor SO wajib diisi." };
  if (!DATE_RE.test(m.tanggalBayar)) return { ok: false, error: "Tanggal bayar tak valid (YYYY-MM-DD)." };
  if (!UUID_RE.test(m.accountId)) return { ok: false, error: "Pilih rekening bank pembayarnya." };

  const sen = {} as SenPenebusan;
  for (const k of [...KOMPONEN, "gross"] as const) {
    const s = rupiahKeSen(m[k]);
    if (s === null) {
      return { ok: false, error: `${LABEL_KOMPONEN[k]} tak valid — angka rupiah, paling banyak dua desimal.` };
    }
    sen[k] = s;
  }
  if (sen.gross <= 0) return { ok: false, error: "Harga Gross harus lebih dari nol — ia keluar dari rekening bank." };

  const jumlah = sen.net + sen.ppn + sen.pph + sen.pbbkb + sen.nota;
  if (jumlah !== sen.gross) {
    return {
      ok: false,
      error:
        `Net + PPN + PPh + PBBKB + Nota = ${rpSen(jumlah)}, Harga Gross ${rpSen(sen.gross)} — ` +
        `selisih ${rpSen(jumlah - sen.gross)}. Perbaiki komponennya sampai selisihnya Rp 0.`,
    };
  }
  return { ok: true, noSo, noSoTampil, sen };
}

// ---------------------------------------------------------------------------
// Kaki formulir: Σ komponen / Gross / Selisih (diperbarui saat mengetik)
// ---------------------------------------------------------------------------

export interface RingkasKomponen {
  /** Semua isian wajib terbaca (hanya Nota yang boleh kosong = 0). */
  lengkap: boolean;
  /** Σ komponen yang SUDAH terbaca, rupiah bulat. */
  jumlah: number;
  gross: number | null;
  /** Σ − Gross; `null` selama belum lengkap. */
  selisih: number | null;
}

export function ringkasKomponen(t: Record<Komponen | "gross", string>): RingkasKomponen {
  let jumlah = 0;
  let lengkap = true;
  for (const k of KOMPONEN) {
    const h = bacaRupiah(t[k], { bolehNegatif: k === "nota" });
    if (h.keadaan === "sah") jumlah += h.nilai;
    else if (!(h.keadaan === "kosong" && k === "nota")) lengkap = false;
  }
  const g = bacaRupiah(t.gross);
  const gross = g.keadaan === "sah" ? g.nilai : null;
  if (gross === null) lengkap = false;
  return { lengkap, jumlah, gross, selisih: lengkap && gross !== null ? jumlah - gross : null };
}

// ---------------------------------------------------------------------------
// Ikat baris kas yang sudah ada (R29)
// ---------------------------------------------------------------------------

export interface KandidatKas {
  id: string;
  businessDate: string;
  tanggalAsal: string | null;
  keterangan: string;
  amountSen: number;
}

export type PilihanIkat =
  | { aksi: "buat" }
  | { aksi: "ikat"; id: string }
  | { aksi: "pilih"; kandidat: KandidatKas[] }
  | { aksi: "tolak"; error: string };

/**
 * `kandidat` = baris kas Pembelian BBM non-void di rekening yang sama, nominal
 * −Gross, tanggal (hari buku atau tanggal asal) = tanggal bayar, belum diikat
 * penebusan aktif — disaring kueri. Di sini hanya keputusannya.
 */
export function pilihKandidat(kandidat: readonly KandidatKas[], pilihan: string | null): PilihanIkat {
  if (pilihan !== null) {
    if (kandidat.some((k) => k.id === pilihan)) return { aksi: "ikat", id: pilihan };
    return {
      aksi: "tolak",
      error: "Baris kas yang dipilih bukan lagi kandidat (sudah diikat, dibatalkan, atau nominalnya beda) — muat ulang.",
    };
  }
  if (kandidat.length === 0) return { aksi: "buat" };
  if (kandidat.length === 1) return { aksi: "ikat", id: kandidat[0]!.id };
  return { aksi: "pilih", kandidat: [...kandidat] };
}

// ---------------------------------------------------------------------------
// Rekap pajak (R13)
// ---------------------------------------------------------------------------

export interface BarisRekapSen {
  noSo: string;
  netSen: number;
  ppnSen: number;
  pphSen: number;
  pbbkbSen: number;
  notaSen: number;
  grossSen: number;
}

export interface TotalRekap {
  n: number;
  netSen: number;
  ppnSen: number;
  pphSen: number;
  pbbkbSen: number;
  notaSen: number;
  grossSen: number;
}

export function rekapPajak(rows: readonly BarisRekapSen[]): TotalRekap {
  const t: TotalRekap = { n: 0, netSen: 0, ppnSen: 0, pphSen: 0, pbbkbSen: 0, notaSen: 0, grossSen: 0 };
  for (const r of rows) {
    t.n += 1;
    t.netSen += r.netSen;
    t.ppnSen += r.ppnSen;
    t.pphSen += r.pphSen;
    t.pbbkbSen += r.pbbkbSen;
    t.notaSen += r.notaSen;
    t.grossSen += r.grossSen;
  }
  return t;
}

export { bulanSah, rentangBulan } from "./bulan";

/**
 * Unit satu PT (tenant) dengan `code` — HANYA bila pengguna memegang SEMUA unit
 * aktif tenant itu (rekap per PT, R13). Memegang sebagian ⇒ `null`: rekap PT
 * yang diam-diam tak lengkap lebih berbahaya daripada tak ada rekap PT.
 */
export function unitSatuPt<U extends { code: string }>(
  code: string,
  tenantPerUnit: ReadonlyMap<string, string>,
  units: readonly U[],
): U[] | null {
  const t = tenantPerUnit.get(code);
  if (t === undefined) return null;
  const kodeTenant = [...tenantPerUnit].filter(([, v]) => v === t).map(([k]) => k);
  const dipegang = units.filter((u) => kodeTenant.includes(u.code));
  if (dipegang.length !== kodeTenant.length) return null;
  return dipegang;
}
