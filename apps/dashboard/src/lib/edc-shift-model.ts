/**
 * Penjualan EDC per shift × bank → EDC Penampungan (KEUANGAN-HARIAN §10.25).
 *
 * MURNI — tanpa I/O. SATU pembuat vonis untuk status tiap baris; layar
 * pengawas (Rincian), layar Keuangan (Input keuangan blok 3), dan server action
 * persetujuan semuanya membaca vonis dari sini.
 *
 * ⛔ Tiga aturan yang mengikat:
 *   1. **Nominal = BRUTO EasyMax.** Slip settlement adalah PEMERIKSA, bukan
 *      sumber — angka yang sudah diketahui sistem tidak diketik ulang.
 *   2. **Kode kartu tanpa peta tidak bisa dibukukan.** Ia muncul sebagai
 *      daftar terpisah yang menyebut kodenya, supaya yang berwenang memetakannya
 *      — bukan ditebak ke bank mana pun.
 *   3. **Cek yang BASI tidak bisa disetujui.** Bila bruto EasyMax berubah
 *      sesudah pengawas mencocokkan (sinkron susulan, ralat POS), slip itu
 *      mencocokkan angka yang sudah tidak ada.
 *
 * Rencana K6 U6 (R15, R16, KTD7): slip = EasyMax ⇒ TERPOSTING saat pengawas
 * mencocokkan (`vonisCekSlip`); slip ≠ EasyMax ⇒ DITAHAN untuk Finance. Sekali
 * sebuah kunci (unit, tanggal, shift, bank) pernah tercatat beda, cek ulang
 * berikutnya tetap ditahan. Posting yang angka EasyMax-nya berubah sesudahnya
 * ditandai `berubahSesudahDiposting` — dibalik Finance, bukan dicek ulang.
 */

/** Satu kelompok transaksi EDC dari EasyMax: (shift, kode kartu). */
export interface EdcEasymaxShift {
  cshift: string;
  ckdkartu: string;
  /** Nama kartu dari master EasyMax (`card.vcnmcard`) — SARAN peta, bukan peta. */
  namaKartu: string;
  rp: number;
  n: number;
}

export interface PetaKartu {
  ckdkartu: string;
  acquirer: string;
}

export interface CekSlip {
  id: string;
  cshift: string;
  acquirer: string;
  easymaxRp: number;
  slipRp: number;
  checkedByUserId: number;
  checkedByEmail: string | null;
  checkedAt: string;
  reasonCode: string | null;
  /** Sudah ada baris buku aktif (Debet EDC Penampungan) yang lahir dari cek ini. */
  dibukukan: boolean;
  adaFoto: boolean;
}

export type StatusShiftEdc =
  | "belum_dicek"
  | "cocok"
  | "selisih"
  | "berubah_sesudah_dicek"
  | "dibukukan";

export const LABEL_STATUS_EDC: Record<StatusShiftEdc, string> = {
  belum_dicek: "Belum dicocokkan pengawas",
  // Cek cocok yang BELUM terposting hanya lahir dari tahanan (KTD7, hari
  // tertutup, akun belum ada) atau dari cek sebelum posting otomatis.
  cocok: "Cocok — ditahan, menunggu Finance",
  selisih: "Selisih dengan slip — ditahan, menunggu Finance",
  berubah_sesudah_dicek: "Data EasyMax berubah — cocokkan ulang",
  dibukukan: "Terposting",
};

export interface BarisShiftEdc {
  /** Kunci stabil untuk React & form: `shift|acquirer`. */
  kunci: string;
  cshift: string;
  acquirer: string;
  /** Bruto EasyMax SEKARANG. */
  easymaxRp: number;
  nTransaksi: number;
  kodeKartu: string[];
  cek: CekSlip | null;
  /** slip − EasyMax-saat-dicek; `null` bila belum dicek. */
  selisih: number | null;
  status: StatusShiftEdc;
  /** KTD7 — sudah terposting, lalu bruto EasyMax berubah. Lihat {@link berubahSesudahDiposting}. */
  berubahSesudahDiposting: boolean;
}

export interface KartuTanpaPeta {
  ckdkartu: string;
  namaKartu: string;
  rp: number;
  n: number;
}

/** Selisih di bawah Rp 1 dianggap nol — pecahan sen dari penjumlahan desimal. */
const SAMA = (a: number, b: number) => Math.abs(a - b) < 1;

export function statusBaris(easymaxSekarang: number, cek: CekSlip | null): StatusShiftEdc {
  if (cek === null) return "belum_dicek";
  if (cek.dibukukan) return "dibukukan";
  if (!SAMA(cek.easymaxRp, easymaxSekarang)) return "berubah_sesudah_dicek";
  return SAMA(cek.slipRp, cek.easymaxRp) ? "cocok" : "selisih";
}

export function rakitShiftEdc(
  easymax: readonly EdcEasymaxShift[],
  peta: readonly PetaKartu[],
  cek: readonly CekSlip[],
): { baris: BarisShiftEdc[]; kartuTanpaPeta: KartuTanpaPeta[] } {
  const acquirerDari = new Map(peta.map((p) => [p.ckdkartu, p.acquirer]));
  const kelompok = new Map<string, BarisShiftEdc>();
  const tanpaPeta = new Map<string, KartuTanpaPeta>();

  for (const e of easymax) {
    const acq = acquirerDari.get(e.ckdkartu);
    if (acq === undefined) {
      const t = tanpaPeta.get(e.ckdkartu) ?? { ckdkartu: e.ckdkartu, namaKartu: e.namaKartu, rp: 0, n: 0 };
      t.rp += e.rp;
      t.n += e.n;
      tanpaPeta.set(e.ckdkartu, t);
      continue;
    }
    const kunci = `${e.cshift}|${acq}`;
    const b =
      kelompok.get(kunci) ??
      ({
        kunci,
        cshift: e.cshift,
        acquirer: acq,
        easymaxRp: 0,
        nTransaksi: 0,
        kodeKartu: [],
        cek: null,
        selisih: null,
        status: "belum_dicek",
        berubahSesudahDiposting: false,
      } satisfies BarisShiftEdc);
    b.easymaxRp += e.rp;
    b.nTransaksi += e.n;
    if (!b.kodeKartu.includes(e.ckdkartu)) b.kodeKartu.push(e.ckdkartu);
    kelompok.set(kunci, b);
  }

  // Cek yang kelompoknya tak lagi ada di EasyMax (transaksi dihapus di POS,
  // peta kartu diganti) tetap DITAMPILKAN — sebagai "berubah", bukan lenyap.
  for (const c of cek) {
    const kunci = `${c.cshift}|${c.acquirer}`;
    const b =
      kelompok.get(kunci) ??
      ({
        kunci,
        cshift: c.cshift,
        acquirer: c.acquirer,
        easymaxRp: 0,
        nTransaksi: 0,
        kodeKartu: [],
        cek: null,
        selisih: null,
        status: "belum_dicek",
        berubahSesudahDiposting: false,
      } satisfies BarisShiftEdc);
    b.cek = c;
    kelompok.set(kunci, b);
  }

  const baris = [...kelompok.values()]
    .map((b) => ({
      ...b,
      selisih: b.cek === null ? null : b.cek.slipRp - b.cek.easymaxRp,
      status: statusBaris(b.easymaxRp, b.cek),
      berubahSesudahDiposting: berubahSesudahDiposting(b.cek, b.easymaxRp),
    }))
    .sort((a, b) => a.cshift.localeCompare(b.cshift) || a.acquirer.localeCompare(b.acquirer));

  return {
    baris,
    kartuTanpaPeta: [...tanpaPeta.values()].sort((a, b) => b.rp - a.rp),
  };
}

/** Baris yang boleh disetujui Keuangan: sudah dicek, tidak basi, belum dibukukan. */
export function bolehDisetujui(b: BarisShiftEdc): boolean {
  return b.status === "cocok" || b.status === "selisih";
}

/** Persetujuan baris berselisih WAJIB membawa kode alasan penutupan. */
export function butuhAlasan(b: BarisShiftEdc): boolean {
  return b.status === "selisih";
}

/**
 * KTD7 — posting yang angka EasyMax-nya berubah SESUDAH terposting. Nominal
 * terposting selalu `cek.easymaxRp` (inti tulis `edc-shift-tulis.ts` hanya
 * pernah menulis angka itu), jadi pembandingnya cukup cek itu sendiri.
 * Dihitung saat halaman dibuka; tidak disimpan.
 */
export function berubahSesudahDiposting(cek: CekSlip | null, easymaxSekarang: number): boolean {
  return cek !== null && cek.dibukukan && !SAMA(cek.easymaxRp, easymaxSekarang);
}

/** Daftar "EDC ditahan" milik Finance: cek yang ditahan, plus posting yang berubah sesudahnya. */
export function perluKeputusanFinance(b: BarisShiftEdc): boolean {
  return bolehDisetujui(b) || b.berubahSesudahDiposting;
}

export type VonisCekSlip = "terposting" | "ditahan";

/** Kalimat hasil yang dilihat pengawas sesudah menyimpan cek (R15, R16). */
export const PESAN_HASIL_CEK: Record<VonisCekSlip, string> = {
  terposting: "Terposting",
  ditahan: "Ditahan, menunggu Finance",
};

/**
 * R15/R16/KTD7 — vonis cek slip yang BARU disimpan pengawas.
 *
 * `riwayat` = SEMUA cek lain untuk kunci (unit, tanggal, shift, bank) yang
 * sama, TERMASUK yang sudah dibatalkan. Sekali tercatat beda, kunci itu
 * menunggu Finance: cek ulang pengawas tidak melepas tahanan.
 */
export function vonisCekSlip(m: {
  slipRp: number;
  easymaxRp: number;
  riwayat: readonly { slipRp: number; easymaxRp: number }[];
}): VonisCekSlip {
  if (!SAMA(m.slipRp, m.easymaxRp)) return "ditahan";
  if (m.riwayat.some((r) => !SAMA(Number(r.slipRp), Number(r.easymaxRp)))) return "ditahan";
  return "terposting";
}

/** Keterangan baris buku — dibentuk di SATU tempat. */
export function keteranganBuku(date: string, cshift: string, acquirer: string): string {
  return `Penjualan EDC ${date} shift ${cshift} ${acquirer}`;
}
