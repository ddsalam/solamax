import {
  compareTagihanRows,
  deriveTagihanStatus,
  paginateTagihan,
  summarizeTagihan,
  type TagihanFilter,
  type TagihanTermin,
} from "@/lib/tagihan-model";
import type {
  CocokSaldoPelanggan,
  TagihanBaris,
  TagihanDaftar,
  TagihanKesiapanSiap,
  TagihanPembayaranBaris,
  TagihanUbin,
} from "@/lib/tagihan-queries";

/**
 * Bahan UJI layar Tagihan pelanggan — HANYA diimpor berkas `*.test.*`.
 * Semua nilai ilustratif (repositori publik): bukan pelanggan, nomor faktur,
 * atau angka nyata. Statusnya selalu diturunkan `deriveTagihanStatus`, jadi
 * uji tampilan tak pernah menulis vonis sendiri.
 */

export const CONTOH_HARI_INI = "2026-11-13";
export const CONTOH_UNIT = { code: "6400001", name: "SPBU Contoh" };

export const CONTOH_KESIAPAN: TagihanKesiapanSiap = {
  tersedia: true,
  selesaiAt: "2026-11-13T02:00:00Z",
  selesaiWib: "2026-11-13 09:00",
  jumlahFaktur: 8,
  jumlahPembayaran: 5,
  pembayaranTerakhir: "2026-11-12",
};

export interface ContohBarisOpsi {
  kode: string;
  customerCode?: string;
  nama?: string | null;
  tanggal?: string;
  jtEasymax?: string | null;
  nilai?: number;
  dibayar?: number;
  /** Bawaan: cocok dengan hitungan (tanpa penanda beda). */
  statusEasymax?: number | null;
  sisaEasymax?: number | null;
  termin?: TagihanTermin;
  tanggalBayarTerakhir?: string | null;
  keterangan?: string | null;
}

export function contohBaris(o: ContohBarisOpsi): TagihanBaris {
  const nilai = o.nilai ?? 10_000_000;
  const dibayar = o.dibayar ?? 0;
  const faktur = {
    kode: o.kode,
    customerCode: o.customerCode ?? "P-001",
    tanggalFaktur: o.tanggal ?? "2026-10-01",
    jatuhTempoEasymax: o.jtEasymax ?? null,
    nilai,
    statusEasymax: o.statusEasymax === undefined ? (dibayar >= nilai ? 1 : 0) : o.statusEasymax,
    sisaEasymax: o.sisaEasymax === undefined ? nilai - dibayar : o.sisaEasymax,
    batal: false,
  };
  const status = deriveTagihanStatus(
    faktur,
    [{ jumlah: dibayar, batal: false }],
    o.termin ?? { terminPelanggan: null, terminUnit: 30 },
    CONTOH_HARI_INI,
  )!;
  return {
    faktur,
    status,
    namaPelanggan: o.nama === undefined ? "PT Pelanggan Contoh" : o.nama,
    tanggalFakturKosong: false,
    tanggalBayarTerakhir: o.tanggalBayarTerakhir ?? (dibayar > 0 ? "2026-11-05" : null),
    jumlahPembayaran: dibayar > 0 ? 1 : 0,
    jumlahPembayaranBatal: 0,
    keterangan: o.keterangan ?? null,
  };
}

/** Satu faktur per keadaan yang harus bisa dibedakan layar. */
export const CONTOH = {
  /** Belum dibayar, termin unit 30 hari → jatuh tempo 31 Okt, lewat 13 hari. */
  lewat: () => contohBaris({ kode: "TG-0001" }),
  /** AE2: dibayar 4 jt dari 10 jt, jatuh tempo EasyMax kemarin → Sebagian + Lewat 1 hari. */
  sebagianLewat: () => contohBaris({
    kode: "TG-0002", customerCode: "P-002", nama: "CV Mitra Contoh",
    tanggal: "2026-10-29", jtEasymax: "2026-11-12", dibayar: 4_000_000,
  }),
  /** Termin pelanggan 14 hari → jatuh tempo 24 Nov, 11 hari lagi. */
  belumJatuhTempo: () => contohBaris({
    kode: "TG-0003", tanggal: "2026-11-10", termin: { terminPelanggan: 14, terminUnit: 30 },
  }),
  terminBelumDiatur: () => contohBaris({
    kode: "TG-0004", customerCode: "P-003", nama: "UD Tanpa Termin",
    termin: { terminPelanggan: null, terminUnit: null },
  }),
  lunas: () => contohBaris({ kode: "TG-0005", dibayar: 10_000_000 }),
  /** AE3: kelebihan 50.000. */
  lebihBayar: () => contohBaris({ kode: "TG-0006", dibayar: 10_050_000 }),
  /** AE5: EasyMax menandai lunas dan sisanya nol, padahal baru dibayar 4 jt. */
  bedaEasymax: () => contohBaris({
    kode: "TG-0007", dibayar: 4_000_000, statusEasymax: 1, sisaEasymax: 0,
  }),
  /** AE9: jatuh tempo EasyMax puluhan tahun kemudian → tak dipakai, jatuh ke termin. */
  jtTakWajar: () => contohBaris({ kode: "TG-0008", jtEasymax: "2060-01-01" }),
} as const;

export function contohUbin(baris: readonly TagihanBaris[], belumDitagihkan?: TagihanUbin["belumDitagihkan"]): TagihanUbin {
  return {
    ...summarizeTagihan(baris.map((b) => b.status)),
    belumDitagihkan: belumDitagihkan ?? { jumlahDokumen: 3, jumlahPelanggan: 2, total: 1_750_000 },
  };
}

/** Bentuk hasil `getTagihanDaftar`: baris diurutkan model, lalu dihalamankan. */
export function contohDaftar(
  baris: readonly TagihanBaris[],
  o: Partial<Pick<TagihanDaftar, "filter" | "cari" | "periodeLunas" | "terpotong" | "ubin">> & { halaman?: number } = {},
): TagihanDaftar {
  const filter: TagihanFilter = o.filter ?? "perlu_tindakan";
  return {
    tersedia: true,
    kesiapan: CONTOH_KESIAPAN,
    ubin: o.ubin ?? contohUbin(baris),
    fakturBergantungTermin: 0,
    terpotong: o.terpotong ?? false,
    filter,
    cari: o.cari ?? "",
    periodeLunas: o.periodeLunas ?? null,
    halaman: paginateTagihan([...baris].sort(compareTagihanRows), o.halaman ?? 1),
  };
}

export function contohPembayaran(o: Partial<TagihanPembayaranBaris> & { kode: string }): TagihanPembayaranBaris {
  return {
    kodeFaktur: "TG-0002",
    tanggal: "2026-11-05",
    bukti: "BKT-01",
    keterangan: null,
    tempatKas: null,
    jumlah: 4_000_000,
    batal: false,
    alasanBatal: null,
    fakturBatal: false,
    ...o,
  };
}

export function contohCocok(o: Partial<CocokSaldoPelanggan> = {}): CocokSaldoPelanggan {
  return {
    sisaFaktur: 6_000_000,
    belumDitagihkan: 1_250_000,
    jumlah: 7_250_000,
    kelompokSaldo: "lokal",
    saldoPiutang: 7_000_000,
    saldoPerTanggal: "2026-11-12",
    selisih: 250_000,
    ...o,
  };
}
