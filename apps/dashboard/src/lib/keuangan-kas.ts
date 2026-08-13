/**
 * Buku kas & buku bank — aturan MURNI (tanpa I/O).
 *
 * Rujukan: [`KEUANGAN-HARIAN.md`](../../KEUANGAN-HARIAN.md) §1.3 (tujuh akun kas,
 * Cash Flow Check) dan §1.4 (modul kas EasyMax `tr_hkasbank` **dorman sejak
 * 2019** ⇒ seluruh isi buku ini adalah INPUT, bukan tarikan).
 *
 * ⛔ **SALDO ADALAH TURUNAN, BUKAN KOLOM.** Workbook menyimpan `Saldo Akhir` di
 * setiap baris; itulah sebabnya satu sisipan di tengah mendiamkan seluruh kolom
 * di bawahnya — angka lama tetap terlihat benar sampai ada yang menjumlah ulang.
 * Di sini saldo selalu dihitung dari mutasi. Jangan pernah menambahkan kolom
 * saldo "biar cepat": indeks parsial di migrasi 0029 sudah membuatnya murah.
 *
 * **Nominal BERTANDA** (mengikuti workbook): debet positif, kredit negatif ⇒
 * saldo = `Σ amount`. Satu operasi, tanpa cabang, tanpa kesempatan salah tanda
 * di tempat lain.
 */

export type JenisMutasi = "debet" | "kredit" | "adjustment";
export type SisiKategori = "debet" | "kredit";

export interface MutasiKas {
  accountId: string;
  /** `YYYY-MM-DD`. */
  businessDate: string;
  jenis: JenisMutasi;
  /** `null` untuk `adjustment` (mis. baris "Saldo Awal"). */
  categorySide: SisiKategori | null;
  categoryLabel: string | null;
  /** Bertanda: debet > 0, kredit < 0. */
  amount: number;
  void: boolean;
}

/**
 * Saldo satu akun **sampai dengan** `date` (inklusif).
 *
 * Baris `void` diabaikan — pembatalan di repo ini selalu VOID, tak pernah DELETE,
 * jadi setiap penjumlahan wajib menyaringnya. Menghitungnya ikut = membatalkan
 * pembatalan.
 */
export function saldoAkun(
  mutasi: readonly MutasiKas[],
  accountId: string,
  date: string,
): number {
  let s = 0;
  for (const m of mutasi) {
    if (m.void || m.accountId !== accountId) continue;
    if (m.businessDate > date) continue;
    s += m.amount;
  }
  return s;
}

/** Saldo seluruh akun pada satu tanggal, dikunci `accountId`. */
export function saldoSemuaAkun(
  mutasi: readonly MutasiKas[],
  date: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of mutasi) {
    if (m.void || m.businessDate > date) continue;
    out.set(m.accountId, (out.get(m.accountId) ?? 0) + m.amount);
  }
  return out;
}

/**
 * Kas on Hand = jumlah saldo SELURUH akun kas pada satu tanggal (§1.2 komponen
 * `Cash On Hand`). Akun yang belum punya mutasi apa pun tidak menyumbang — dan
 * itu benar: akun tanpa mutasi bersaldo nol.
 */
export function kasOnHand(mutasi: readonly MutasiKas[], date: string): number {
  let s = 0;
  for (const v of saldoSemuaAkun(mutasi, date).values()) s += v;
  return s;
}

/** Kategori mutasi harus SESISI dengan jenisnya (ditegakkan juga di DB, 0029). */
export function kategoriCocok(
  jenis: JenisMutasi,
  side: SisiKategori | null,
): boolean {
  return jenis === "adjustment" ? side === null : side === jenis;
}

/** Tanda nominal mengikuti jenis; mutasi nol bukan mutasi. */
export function tandaCocok(jenis: JenisMutasi, amount: number): boolean {
  if (jenis === "debet") return amount > 0;
  if (jenis === "kredit") return amount < 0;
  return amount !== 0;
}

// ---------------------------------------------------------------------------
// Cash Flow Check (§1.3)
// ---------------------------------------------------------------------------

/**
 * `CashFlow Check = Net Cash Change − ΔKas Akhir (dari buku)`.
 *
 * ⛔ Ia menjaga hal **BERBEDA** dari `Balance Sheet Check`: yang ini menguji
 * apakah **arus** cocok dengan **saldo buku**; yang itu menguji konsistensi
 * aset-vs-ekuitas. Satu tidak mewakili yang lain.
 *
 * Bukti bahwa keduanya benar-benar berbeda — Bakau 30-01-2026: `CashFlow Check`
 * = −915.007.430 (penebusan masuk arus tapi tak pernah masuk buku bank),
 * sementara `BSCheck` hari itu justru **positif**. Gerbang yang hanya melihat
 * salah satunya akan menyatakan hari itu sehat.
 *
 * ⚠️ **BELUM tersambung ke `day_close`.** `day_close.difference_rp` mengukur
 * langkah harian `BSCheck` (§1.2), bukan angka ini. Menyambungkannya butuh
 * keputusan yang belum tertulis: apakah `CashFlow Check ≠ 0` MENAHAN penutupan,
 * dan pada ambang berapa — tangga §3.2 dibuat untuk selisih neraca, bukan untuk
 * selisih arus. Kaitnya sengaja dibiarkan terlihat di sini alih-alih ditebak.
 */
export function cashFlowCheck(input: {
  netCashChange: number;
  saldoBukuAwal: number;
  saldoBukuAkhir: number;
}): number {
  return input.netCashChange - (input.saldoBukuAkhir - input.saldoBukuAwal);
}

/**
 * Ringkasan per kategori untuk satu rentang — dasar laporan bulanan.
 *
 * Dikunci `side|label` supaya tiga label yang muncul di KEDUA sisi (Pindah Buku,
 * Hutang Piutang, Temporary Investment) tidak tergabung diam-diam menjadi satu
 * baris yang artinya bukan apa-apa.
 */
export function ringkasPerKategori(
  mutasi: readonly MutasiKas[],
  from: string,
  to: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of mutasi) {
    if (m.void || m.businessDate < from || m.businessDate > to) continue;
    const key =
      m.categorySide === null ? "adjustment|(tanpa kategori)" : `${m.categorySide}|${m.categoryLabel}`;
    out.set(key, (out.get(key) ?? 0) + m.amount);
  }
  return out;
}
