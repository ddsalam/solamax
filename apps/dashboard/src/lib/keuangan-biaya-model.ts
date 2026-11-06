/**
 * Model tampilan blok 4 Layar 3 — "Biaya operasional & pendapatan lain-lain".
 *
 * MURNI (tanpa I/O).
 *
 * ⛔ **DUA PINTU, SATU DAFTAR** (§2.4). Baris dari pengawas dan baris dari
 * Finance duduk di tabel yang sama dengan daftar kategori yang sama — tetapi
 * **asal-usulnya tidak pernah kabur**, sebab ia kolom yang direkam saat
 * penulisan (`source_door`, 0034), bukan turunan dari peran pembuatnya hari ini.
 *
 * ⛔ **TIDAK ADA TOMBOL EDIT GENERIK**, sekarang maupun nanti (§2.3). Baris
 * milik pengawas tidak bisa ditimpa Finance — yang tersedia hanya empat tindakan
 * bernama, dan masing-masing meninggalkan jejak yang berbeda. Berkas ini
 * menghitung tindakan apa yang TERSEDIA untuk sebuah baris; ia tidak pernah
 * menghasilkan "edit".
 */

/** Pintu masuk baris biaya. Daftar TERTUTUP — cerminan CHECK di 0034. */
export const PINTU_BIAYA = ["pengawas", "finance"] as const;
export type PintuBiaya = (typeof PINTU_BIAYA)[number];

export type StatusBiaya = "draft" | "submitted" | "returned" | "closed";

export interface BarisBiaya {
  id: string;
  /** `pendapatan_lain` | `pengeluaran`. */
  section: string;
  keterangan: string;
  /**
   * Nominal POSITIF dari kedua pintu — arah ditentukan `section`
   * (`manual-entry-nominal.ts`). Untuk tampilan & total, pakai
   * {@link nilaiBertanda}, jangan `amount` langsung.
   */
  amount: number;
  /** Milik PENGAWAS. `null` = belum berkategori. */
  operationalCategory: string | null;
  /**
   * Milik FINANCE — akun EFEKTIF: reklasifikasi terakhir bila ada (§10.29),
   * kalau tidak akun beku di barisnya. `null` = belum dipetakan.
   */
  accountingAccount: string | null;
  /** Akun beku di baris aslinya (0024) — pembanding "semula" setelah reklasifikasi. */
  akunAsli: string | null;
  /** §10.27 — titipan outlet Bright: bukan pendapatan, tak direklasifikasi. */
  titipanBright: boolean;
  status: StatusBiaya;
  sourceDoor: PintuBiaya;
  void: boolean;
  /** 0053 — baris pintu Finance yang lahir dari mutasi kas/bank (`cash_ledger_id`). */
  bertautKas: boolean;
  /** `day_close.status = 'closed'` untuk (unit, tanggal) — yang benar-benar menutup hari. */
  hariTutup: boolean;
  /** Jejak Batalkan (rencana 2026-11-07, 0059): kapan (WIB), oleh siapa, kode, alasan. */
  voidAt: string | null;
  voidOleh: string | null;
  voidReasonCode: string | null;
  voidAlasan: string | null;
}

/**
 * Empat tindakan bernama (§2.3). **`edit` bukan salah satunya, dan tak akan
 * pernah jadi salah satunya.**
 */
export const TINDAKAN = ["review", "return", "reclassify", "batalkan", "correct"] as const;
export type Tindakan = (typeof TINDAKAN)[number];

export const LABEL_TINDAKAN: Record<Tindakan, string> = {
  review: "Tinjau",
  return: "Kembalikan untuk perbaikan",
  reclassify: "Reklasifikasi",
  batalkan: "Batalkan",
  correct: "Koreksi / balik",
};

/**
 * Tindakan yang TERSEDIA untuk satu baris, mengikuti daur hidup §2.2:
 *
 * | tahap | Finance boleh |
 * |---|---|
 * | `draft` | — (belum terlihat Finance) |
 * | `submitted`, hari belum ditutup | Tinjau · Kembalikan (pengawas) · Reklasifikasi · Batalkan (Finance, tanpa tautan kas) |
 * | `closed` | Reklasifikasi · Koreksi / balik |
 *
 * `Reklasifikasi` tersedia **kapan saja** setelah baris terlihat: ia tidak
 * menyentuh transaksi aslinya, hanya penyajian akuntansinya.
 *
 * Baris dari pintu **Finance** tidak punya `Kembalikan` — tak ada pengawas yang
 * bisa dikembalikan kepadanya. Menawarkannya akan membuat tombol yang tak punya
 * tujuan.
 */
export function tindakanTersedia(b: BarisBiaya): Tindakan[] {
  if (b.void) return [];
  if (b.status === "draft") return [];
  // Hari ditutup oleh `day_close`, bukan oleh status baris (aplikasi tak pernah
  // menyetel status 'closed') — dua-duanya dihormati.
  if (b.hariTutup || b.status === "closed") return ["reclassify", "correct"];
  // submitted / returned
  const t: Tindakan[] = ["review", "reclassify"];
  if (b.sourceDoor === "pengawas") t.splice(1, 0, "return");
  // Rencana 2026-11-07 R1 — Batalkan hanya baris pintu Finance yang TIDAK lahir
  // dari mutasi kas (yang itu dibatalkan lewat mutasi asalnya, R3).
  if (b.sourceDoor === "finance" && !b.bertautKas) t.push("batalkan");
  return t;
}

/** Baris yang menunggu tinjauan Finance — bahan hitungan di kepala blok. */
export function menungguTinjauan(baris: readonly BarisBiaya[]): BarisBiaya[] {
  return baris.filter((b) => !b.void && b.status === "submitted");
}

/** Baris yang belum punya akun akuntansi — beban tanpa rumah di laporan. */
export function belumBerakun(baris: readonly BarisBiaya[]): BarisBiaya[] {
  return baris.filter((b) => !b.void && b.accountingAccount === null);
}

/**
 * Total per pintu. `Record` atas union: menambah pintu ketiga akan
 * **menggagalkan type-check** sampai ia ditangani — pola yang sama dengan
 * `ringkasPerSumber` di `keuangan-beban.ts`, dan alasannya sama: baris yang
 * hilang dari total tidak memunculkan galat apa pun, ia hanya membuat angkanya
 * lebih kecil.
 */
export function totalPerPintu(baris: readonly BarisBiaya[]): Record<PintuBiaya, number> {
  const out = { pengawas: 0, finance: 0 } satisfies Record<PintuBiaya, number>;
  for (const b of baris) {
    if (b.void) continue;
    out[b.sourceDoor] += nilaiBertanda(b);
  }
  return out;
}

/**
 * Nilai bertanda untuk DITAMPILKAN & DIJUMLAH: pengeluaran negatif, pendapatan
 * positif. Tandanya diturunkan dari SEKSI — satu-satunya tempat arah disimpan —
 * sehingga total per pintu adalah angka neto, bukan biaya ditambah pendapatan.
 */
export function nilaiBertanda(b: Pick<BarisBiaya, "section" | "amount">): number {
  return b.section === "pengeluaran" ? -Math.abs(b.amount) : Math.abs(b.amount);
}
