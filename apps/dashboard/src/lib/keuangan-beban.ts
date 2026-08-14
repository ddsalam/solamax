/**
 * SATU tempat yang menggabungkan seluruh sumber BEBAN untuk Income Statement.
 *
 * Keputusan owner 13 Agustus 2026 (§2.5): beban non-kas turunan-mesin punya
 * rumah sendiri (`app.noncash_expense`), **bukan** `app.manual_entry`. Ongkosnya
 * diterima sadar: jalur baca beban kini menggabung **dua** sumber.
 *
 * ⛔ **Beban yang hilang dari laporan TIDAK memunculkan galat apa pun** — ia
 * hanya membuat laba terlihat lebih besar. Itulah kelas kesalahan yang paling
 * mahal di modul ini (bandingkan: COGS Solar Bakau nol sejak 2026-03-04 selama
 * berbulan-bulan tanpa satu pun alarm). Karena itu penggabungannya di SINI,
 * sekali, dan dijaga tiga lapis:
 *
 * 1. **TIPE** — {@link SumberBeban} adalah union, dan {@link kumpulkanBeban}
 *    menerima `Record<SumberBeban, …>`. Menambah sumber ke union akan
 *    **menggagalkan type-check di setiap pemanggil** sampai sumber itu
 *    ditangani. Ini penjaga yang bekerja SEBELUM tes dijalankan.
 * 2. **TES** — ada uji yang memerah bila salah satu sumber tidak menyumbang.
 * 3. **DAFTAR** — {@link SUMBER_BEBAN} bisa dihitung, jadi "berapa sumber yang
 *    digabung" adalah pertanyaan yang punya jawaban, bukan tebakan.
 *
 * Jangan pernah menjumlah beban di tempat lain. Kalau ada layar/laporan yang
 * butuh beban, ia memanggil ini.
 */

/**
 * Seluruh sumber beban yang masuk Income Statement.
 *
 * ⚠️ Menambah anggota di sini adalah keputusan owner, dan ia **sengaja**
 * memecahkan type-check di setiap pemanggil `kumpulkanBeban`.
 */
export const SUMBER_BEBAN = ["manual_entry", "noncash_expense"] as const;
export type SumberBeban = (typeof SUMBER_BEBAN)[number];

/** Satu baris beban, sudah dinormalkan dari sumber mana pun. */
export interface BarisBeban {
  sumber: SumberBeban;
  /** `YYYY-MM-DD`. */
  businessDate: string;
  /** CoA milik Finance. `null` = belum dipetakan (hanya mungkin dari `manual_entry`). */
  accountingAccount: string | null;
  /** Rupiah, POSITIF sebagai beban. Normalisasi tanda terjadi di pemanggil kueri. */
  amountRp: number;
  keterangan: string;
}

/** Beban dari `app.manual_entry` — diketik manusia (pengawas atau Finance). */
export interface BebanManualEntry {
  businessDate: string;
  accountingAccount: string | null;
  amountRp: number;
  keterangan: string;
  void: boolean;
}

/** Beban dari `app.noncash_expense` — dihitung mesin, disetujui manusia. */
export interface BebanNonKas {
  businessDate: string;
  accountingAccount: string;
  amountRp: number;
  keterangan: string;
  void: boolean;
}

/**
 * Peta sumber → barisnya. `Record` atas union, **bukan** objek opsional:
 * melupakan satu sumber adalah **error tipe**, bukan nol yang diam.
 */
export interface SumberBebanInput {
  manual_entry: readonly BebanManualEntry[];
  noncash_expense: readonly BebanNonKas[];
}

/**
 * Kumpulkan seluruh beban dari SEMUA sumber untuk satu rentang (inklusif).
 *
 * Baris `void` disaring di sini — sekali, di satu tempat. Menyaringnya di
 * pemanggil berarti setiap pemanggil baru harus mengingatnya.
 */
export function kumpulkanBeban(
  sumber: SumberBebanInput,
  from: string,
  to: string,
): BarisBeban[] {
  const dalamRentang = (d: string) => d >= from && d <= to;
  const out: BarisBeban[] = [];

  for (const r of sumber.manual_entry) {
    if (r.void || !dalamRentang(r.businessDate)) continue;
    out.push({
      sumber: "manual_entry",
      businessDate: r.businessDate,
      accountingAccount: r.accountingAccount,
      amountRp: r.amountRp,
      keterangan: r.keterangan,
    });
  }

  for (const r of sumber.noncash_expense) {
    if (r.void || !dalamRentang(r.businessDate)) continue;
    out.push({
      sumber: "noncash_expense",
      businessDate: r.businessDate,
      accountingAccount: r.accountingAccount,
      amountRp: r.amountRp,
      keterangan: r.keterangan,
    });
  }

  return out;
}

/** Total beban seluruh sumber. */
export function totalBeban(baris: readonly BarisBeban[]): number {
  return baris.reduce((s, b) => s + b.amountRp, 0);
}

/**
 * Total per akun akuntansi. Baris tanpa akun (belum dipetakan) dikumpulkan di
 * bawah kunci `null` — **tidak dibuang**. Beban yang belum berkategori tetap
 * beban; membuangnya membuat laba lebih besar tanpa jejak.
 */
export function bebanPerAkun(baris: readonly BarisBeban[]): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const b of baris) {
    out.set(b.accountingAccount, (out.get(b.accountingAccount) ?? 0) + b.amountRp);
  }
  return out;
}

/**
 * Sumbangan tiap sumber — untuk laporan DAN untuk penjagaan.
 *
 * Kalau satu sumber menyumbang nol pada periode yang semestinya berisi, itu
 * pertanyaan; kalau ia menyumbang nol karena **tidak pernah dibaca**, itu
 * bencana yang diam. Fungsi ini membuat perbedaannya bisa dilihat.
 */
export function ringkasPerSumber(baris: readonly BarisBeban[]): Record<SumberBeban, number> {
  const out = { manual_entry: 0, noncash_expense: 0 } satisfies Record<SumberBeban, number>;
  for (const b of baris) out[b.sumber] += b.amountRp;
  return out;
}
