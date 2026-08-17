import { nadaPemeriksa, type NadaPemeriksa } from "./keuangan-laporan-model";
import { tierFor, type Tier } from "./keuangan-tutup-hari";

/**
 * Model Papan Keuangan Grup (Layar 1) — MURNI (tanpa I/O).
 *
 * ⛔ **PERTANYAAN PERTAMA PAPAN INI BUKAN "BERAPA LABANYA".** Yang pertama
 * dijawab adalah **apakah pembukuan unit masih seimbang** — sebab laba dari
 * pembukuan yang tidak seimbang bukan laba, melainkan angka. Urutan kolom dan
 * urutan baris keduanya mengikuti itu.
 *
 * ⛔ **"HARI TERLEWAT" DITURUNKAN DARI KETIADAAN BARIS** `day_close`, bukan dari
 * kolom `status` (§10.15). Baris itu lahir saat Layar 4 dibuka; hari yang tak
 * pernah dibuka **tidak punya baris sama sekali**. `WHERE status='open'` hanya
 * menemukan hari yang pernah dibuka lalu ditinggalkan — dan justru melewatkan
 * hari yang tak pernah disentuh, yaitu kasus yang paling perlu terlihat.
 */

/** Keadaan satu unit pada satu tanggal — diurut dari yang paling perlu dilihat. */
export type StatusUnit =
  | "belum_dimodelkan"
  | "belum_pernah_dibuka"
  | "belum_ditutup"
  | "ditutup_eksepsi"
  | "ditutup_normal";

export const URUTAN_STATUS: Record<StatusUnit, number> = {
  // Makin kecil = makin perlu dilihat lebih dulu.
  belum_pernah_dibuka: 0,
  belum_ditutup: 1,
  ditutup_eksepsi: 2,
  ditutup_normal: 3,
  belum_dimodelkan: 4,
};

export const LABEL_STATUS: Record<StatusUnit, string> = {
  belum_dimodelkan: "Belum dimodelkan",
  belum_pernah_dibuka: "Belum pernah dibuka",
  belum_ditutup: "Belum ditutup",
  ditutup_eksepsi: "Ditutup dengan eksepsi",
  ditutup_normal: "Ditutup",
};

/**
 * Penjelasan yang menyebut APA yang belum ada dan SIAPA yang mengisinya.
 * Kosong yang diam tak bisa dibedakan dari nol.
 */
export const PENJELASAN_STATUS: Record<StatusUnit, string> = {
  belum_dimodelkan:
    "Unit ini belum punya daftar rekening kas/bank, jadi Cash Flow dan Balance Sheet-nya " +
    "belum bisa disusun — tim keuangan yang mendaftarkannya.",
  belum_pernah_dibuka:
    "Tidak ada jejak penilaian untuk hari ini: halaman tutup harinya belum pernah dibuka. " +
    "Ini BUKAN 'seimbang' — ini 'belum diperiksa'.",
  belum_ditutup: "Sudah dinilai tetapi belum ditutup — tim keuangan, di layar Tutup hari.",
  ditutup_eksepsi: "Ditutup di luar toleransi, dengan reason code dan persetujuan.",
  ditutup_normal: "Ditutup dalam toleransi.",
};

export interface BarisUnit {
  unitId: number;
  code: string;
  nama: string;
  /** `null` = belum dimodelkan. */
  labaBersih: number | null;
  kasAkhir: number | null;
  /** LANGKAH harian `BSCheck` — yang dinilai gerbang. `null` = tak terhitung. */
  langkahHarian: number | null;
  /** Kumulatif: SELALU null sampai saldo pembuka ada (§1.2). */
  bsCheckKumulatif: number | null;
  status: StatusUnit;
  tier: Tier | null;
  nada: NadaPemeriksa;
}

export interface InputUnit {
  unitId: number;
  code: string;
  nama: string;
  /** Punya akun kas? Tanpa itu, unit belum bisa dimodelkan. */
  adaAkunKas: boolean;
  labaBersih: number | null;
  kasAkhir: number | null;
  langkahHarian: number | null;
  /** Baris `day_close` untuk tanggal itu; `null` = TIDAK ADA (bukan 'open'). */
  dayClose: { status: "open" | "closed"; differenceRp: number } | null;
}

export function barisUnit(i: InputUnit): BarisUnit {
  const status: StatusUnit = !i.adaAkunKas
    ? "belum_dimodelkan"
    : // ⛔ Ketiadaan baris ≠ status 'open'. Lihat §10.15.
      i.dayClose === null
      ? "belum_pernah_dibuka"
      : i.dayClose.status === "open"
        ? "belum_ditutup"
        : tierFor(i.dayClose.differenceRp) === "within_tolerance"
          ? "ditutup_normal"
          : "ditutup_eksepsi";

  return {
    unitId: i.unitId,
    code: i.code,
    nama: i.nama,
    labaBersih: i.adaAkunKas ? i.labaBersih : null,
    kasAkhir: i.adaAkunKas ? i.kasAkhir : null,
    langkahHarian: i.langkahHarian,
    // Kumulatif tak pernah tersedia sampai saldo pembuka ada — dan `null`
    // di sini adalah pengakuan, bukan nol yang menenangkan.
    bsCheckKumulatif: null,
    status,
    tier: i.langkahHarian === null ? null : tierFor(i.langkahHarian),
    nada: nadaPemeriksa(i.langkahHarian),
  };
}

/** Urut: yang paling perlu dilihat lebih dulu, lalu selisih terbesar. */
export function urutkanPapan(baris: readonly BarisUnit[]): BarisUnit[] {
  return [...baris].sort((a, b) => {
    const s = URUTAN_STATUS[a.status] - URUTAN_STATUS[b.status];
    if (s !== 0) return s;
    return Math.abs(b.langkahHarian ?? 0) - Math.abs(a.langkahHarian ?? 0);
  });
}

export interface RingkasPapan {
  /** Unit yang bisa dinilai sama sekali. */
  termodelkan: number;
  /** Dari yang termodelkan: berapa yang langkah hariannya nol. */
  seimbang: number;
  /** Unit yang tak punya jejak penilaian hari ini — bukan nol, bukan seimbang. */
  belumPernahDibuka: number;
  labaBersih: number | null;
  kasAkhir: number | null;
  /** Produk/unit yang menyumbang `null` — dinamai, bukan disembunyikan. */
  takTerhitung: string[];
}

/**
 * Ringkasan kartu KPI.
 *
 * ⛔ Total laba & kas **`null` bila ada unit termodelkan yang angkanya tak
 * terhitung**. Menjumlah yang ada saja akan melahirkan total yang terlihat sah
 * dari himpunan yang tidak lengkap — dan tak seorang pun akan tahu bahwa satu
 * unit hilang dari penjumlahan.
 */
export function ringkasPapan(baris: readonly BarisUnit[]): RingkasPapan {
  const model = baris.filter((b) => b.status !== "belum_dimodelkan");
  const takTerhitung = model
    .filter((b) => b.labaBersih === null || b.kasAkhir === null)
    .map((b) => b.nama);
  const lengkap = takTerhitung.length === 0;
  return {
    termodelkan: model.length,
    seimbang: model.filter((b) => b.langkahHarian === 0).length,
    belumPernahDibuka: baris.filter((b) => b.status === "belum_pernah_dibuka").length,
    labaBersih: lengkap ? model.reduce((s, b) => s + (b.labaBersih ?? 0), 0) : null,
    kasAkhir: lengkap ? model.reduce((s, b) => s + (b.kasAkhir ?? 0), 0) : null,
    takTerhitung,
  };
}
