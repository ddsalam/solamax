/**
 * Settlement EDC — aturan MURNI (tanpa I/O). Rujukan: §10.5 (keputusan owner B5)
 * dan §1.4 (pola "DITAWARKAN, bukan diposting").
 *
 * `EDC Penampungan` adalah **akun kliring RIIL yang cair H+1**, dengan **MDR
 * dipotong DI MUKA** (bank mentransfer neto).
 *
 * ⚠️ Konteks yang membuat ini mendesak: saldo pos itu di Bakau naik dari nol
 * (2021) ke **Rp 12.435.466.761** dan hanya turun pada 78 dari 2.067 hari.
 * Akun yang cair tiap hari semestinya berisi ± SATU hari omzet non-tunai.
 */

export interface Settlement {
  id: string;
  acquirer: string;
  /** `YYYY-MM-DD` — tanggal uang masuk rekening (H+1). */
  settlementDate: string;
  /** `YYYY-MM-DD` — hari penjualan yang di-settle. */
  businessDate: string;
  /** Akun kas tujuan neto. */
  toAccountId: string;
  grossRp: number;
  netRp: number;
  /** Total transaksi menurut `public.edc`; `null` = belum direkonsiliasi. */
  txnTotalRp: number | null;
  void: boolean;
}

/** MDR = bruto − neto. **Tidak pernah diketik** (§10.5). */
export function mdrRp(s: Pick<Settlement, "grossRp" | "netRp">): number {
  return s.grossRp - s.netRp;
}

/**
 * Selisih transaksi vs settlement. **Berdiri sebagai selisih**, tidak dibulatkan
 * hilang — kodenya dari grup `closing` (`CLS-EDC-TIMING` / `CLS-EDC-MDR`).
 *
 * `null` (belum direkonsiliasi) ⇒ `null`, **bukan nol**: "belum diperiksa" dan
 * "sudah diperiksa, cocok" adalah dua keadaan berbeda, dan menyamakannya
 * membuat batch yang belum pernah disentuh terlihat bersih.
 */
export function selisihSettlement(s: Pick<Settlement, "grossRp" | "txnTotalRp">): number | null {
  return s.txnTotalRp === null ? null : s.txnTotalRp - s.grossRp;
}

// ---------------------------------------------------------------------------
// Jurnal pencairan H+1 — DITAWARKAN, bukan diposting
// ---------------------------------------------------------------------------

export interface BarisJurnal {
  /** Akun kas tujuan, atau akun buku besar untuk kaki beban. */
  akun: string;
  /** Bertanda, sama seperti `cash_ledger`: debet > 0, kredit < 0. */
  amount: number;
  keterangan: string;
  /** `true` = kaki ini BUKAN akun kas ⇒ tidak boleh masuk `cash_ledger`. */
  bukanAkunKas?: boolean;
}

/**
 * Usulan jurnal tiga kaki (§10.5):
 *
 * ```
 * Kas Bank (neto)          D
 * Beban MDR  7-1200        D
 *     EDC Penampungan (bruto)  K
 * ```
 *
 * ⛔ **USULAN, bukan posting.** Ia tidak menulis apa pun — barisnya baru lahir
 * di buku kas saat ada yang MENYETUJUI (pola §1.4, sama seperti baris "Setoran
 * Hasil Penjualan"). Sistem yang memposting sendiri akan menghapus satu-satunya
 * titik di mana manusia melihat angka itu.
 *
 * ⚠️ Kaki **Beban MDR bukan akun kas** — ia ditandai `bukanAkunKas` supaya
 * pemanggil tidak menyalinnya ke `cash_ledger`.
 *
 * 📌 KOREKSI (0031, 13 Agu 2026): kalimat lama di sini menyebut rumahnya
 * `app.manual_entry` dengan `operational_category='MDR'`. **Sudah tidak
 * berlaku.** Justru karena mesin tak boleh memilih `operational_category`
 * (§2.1), owner memberi beban non-kas turunan-mesin **rumahnya sendiri**:
 * `app.noncash_expense` — tabel yang **tidak punya kolom itu sama sekali**
 * (§2.5). Kaki ketiga tetap hanya DIUSULKAN; yang berubah adalah ke mana ia
 * mendarat setelah disetujui.
 */
export function usulanJurnalPencairan(
  s: Pick<Settlement, "grossRp" | "netRp" | "toAccountId" | "acquirer" | "settlementDate">,
  akunPenampungan: string,
  akunBebanMdr = "7-1200",
): BarisJurnal[] {
  const mdr = mdrRp(s);
  const ket = `Pencairan EDC ${s.acquirer} ${s.settlementDate}`;
  const baris: BarisJurnal[] = [
    { akun: s.toAccountId, amount: s.netRp, keterangan: ket },
    { akun: akunPenampungan, amount: -s.grossRp, keterangan: ket },
  ];
  // MDR nol = tak ada potongan; baris beban nol bukan baris.
  if (mdr !== 0) {
    baris.splice(1, 0, {
      akun: akunBebanMdr,
      amount: mdr,
      keterangan: `${ket} — potongan MDR`,
      bukanAkunKas: true,
    });
  }
  return baris;
}

/** Jurnal seimbang bila jumlah bertandanya nol. */
export function jurnalSeimbang(baris: readonly BarisJurnal[]): boolean {
  const total = baris.reduce((s, b) => s + b.amount, 0);
  return Math.abs(total) < 0.005;
}

// ---------------------------------------------------------------------------
// Kontrol MDR% (§10.5)
// ---------------------------------------------------------------------------

export interface RingkasMdr {
  acquirer: string;
  /** `YYYY-MM`. */
  bulan: string;
  grossRp: number;
  mdrRp: number;
  /** Fraksi, bukan persen: 0,0175 = 1,75 %. `null` bila bruto nol. */
  rasio: number | null;
}

/**
 * MDR sebagai % omzet EDC, **per acquirer per bulan**.
 *
 * Kontrol ini tidak menambah data apa pun — ia hanya membaginya. Nilainya: MDR
 * adalah persentase yang disepakati di perjanjian, jadi **persentase yang
 * bergeser tanpa perubahan perjanjian adalah TEMUAN**, bukan derau. Digabung
 * lintas acquirer, pergeseran satu acquirer akan tenggelam di rata-rata.
 */
export function ringkasMdr(settlements: readonly Settlement[]): RingkasMdr[] {
  const acc = new Map<string, { acquirer: string; bulan: string; gross: number; mdr: number }>();
  for (const s of settlements) {
    if (s.void) continue;
    const bulan = s.settlementDate.slice(0, 7);
    const key = `${s.acquirer}|${bulan}`;
    const cur = acc.get(key) ?? { acquirer: s.acquirer, bulan, gross: 0, mdr: 0 };
    cur.gross += s.grossRp;
    cur.mdr += mdrRp(s);
    acc.set(key, cur);
  }
  return [...acc.values()]
    .map((v) => ({
      acquirer: v.acquirer,
      bulan: v.bulan,
      grossRp: v.gross,
      mdrRp: v.mdr,
      rasio: v.gross === 0 ? null : v.mdr / v.gross,
    }))
    .sort((a, b) => (a.acquirer + a.bulan < b.acquirer + b.bulan ? -1 : 1));
}

/**
 * Acquirer yang rasio MDR-nya **bergeser** antar bulan melebihi `ambang`.
 *
 * `ambang` default 0,0005 (5 basis poin) — cukup ketat untuk menangkap
 * perubahan tarif yang sesungguhnya, cukup longgar untuk mengabaikan pembulatan
 * rupiah pada batch kecil. Ia **ambang PELAPORAN**, bukan ambang yang menolak
 * apa pun: tidak ada satu pun keputusan owner yang menggantung padanya.
 */
export function pergeseranMdr(
  ringkas: readonly RingkasMdr[],
  ambang = 0.0005,
): Array<{ acquirer: string; dari: string; ke: string; rasioDari: number; rasioKe: number }> {
  const out: Array<{ acquirer: string; dari: string; ke: string; rasioDari: number; rasioKe: number }> = [];
  const perAcq = new Map<string, RingkasMdr[]>();
  for (const r of ringkas) {
    if (r.rasio === null) continue;
    perAcq.set(r.acquirer, [...(perAcq.get(r.acquirer) ?? []), r]);
  }
  for (const baris of perAcq.values()) {
    const urut = [...baris].sort((a, b) => (a.bulan < b.bulan ? -1 : 1));
    for (let i = 1; i < urut.length; i++) {
      const a = urut[i - 1]!;
      const b = urut[i]!;
      if (Math.abs(b.rasio! - a.rasio!) > ambang) {
        out.push({
          acquirer: b.acquirer,
          dari: a.bulan,
          ke: b.bulan,
          rasioDari: a.rasio!,
          rasioKe: b.rasio!,
        });
      }
    }
  }
  return out;
}
