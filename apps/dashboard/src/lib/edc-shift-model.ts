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
  cocok: "Cocok dengan slip",
  selisih: "Selisih dengan slip",
  berubah_sesudah_dicek: "Data EasyMax berubah — cocokkan ulang",
  dibukukan: "Sudah dibukukan",
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
      } satisfies BarisShiftEdc);
    b.cek = c;
    kelompok.set(kunci, b);
  }

  const baris = [...kelompok.values()]
    .map((b) => ({
      ...b,
      selisih: b.cek === null ? null : b.cek.slipRp - b.cek.easymaxRp,
      status: statusBaris(b.easymaxRp, b.cek),
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

/** Keterangan baris buku — dibentuk di SATU tempat. */
export function keteranganBuku(date: string, cshift: string, acquirer: string): string {
  return `Penjualan EDC ${date} shift ${cshift} ${acquirer}`;
}
