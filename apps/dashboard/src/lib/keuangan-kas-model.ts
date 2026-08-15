import { saldoAkun, type MutasiKas } from "./keuangan-kas";

/**
 * Model tampilan blok 2 Layar 3 — "Buku kas besar & lima buku bank".
 *
 * MURNI (tanpa I/O). Aturannya tinggal di `keuangan-kas.ts`; berkas ini hanya
 * merangkai hasilnya jadi baris tabel dan daftar tawaran.
 *
 * ⛔ **SALDO DIHITUNG, TIDAK PERNAH DIKETIK DAN TIDAK PERNAH DISIMPAN.** Kolom
 * "Saldo" pada tabel adalah saldo BERJALAN yang dijumlahkan di sini setiap kali
 * halaman dirender. Workbook menyimpannya per baris, dan itulah sebabnya satu
 * sisipan di tengah mendiamkan seluruh kolom di bawahnya — angka lama tetap
 * terlihat benar sampai ada yang menjumlah ulang.
 */

export interface AkunKas {
  id: string;
  nama: string;
  kind: "kas" | "bank" | "edc_penampungan";
  active: boolean;
}

/** Satu baris buku, sudah membawa saldo berjalannya. */
export interface BarisBuku extends MutasiKas {
  id: string;
  keterangan: string;
  /** Saldo SETELAH baris ini — turunan, bukan kolom tabel. */
  saldoBerjalan: number;
  /** Baris ini lahir dari setoran pengawas yang disetujui (0033). */
  dariSetoranPengawas: boolean;
}

/**
 * Baris satu akun pada satu tanggal, berurut waktu, dengan saldo berjalan.
 *
 * Saldo dimulai dari saldo akun pada H−1 — bukan nol. Buku yang memulai tiap
 * hari dari nol akan terlihat rapi dan salah.
 */
export function barisBuku(
  mutasi: readonly (MutasiKas & { id: string; keterangan: string; sourceManualEntryId?: string | null })[],
  accountId: string,
  date: string,
  hariSebelumnya: string,
): BarisBuku[] {
  let saldo = saldoAkun(mutasi, accountId, hariSebelumnya);
  const out: BarisBuku[] = [];
  for (const m of mutasi) {
    if (m.void || m.accountId !== accountId || m.businessDate !== date) continue;
    saldo += m.amount;
    out.push({ ...m, saldoBerjalan: saldo, dariSetoranPengawas: !!m.sourceManualEntryId });
  }
  return out;
}

/** Ringkasan kaki tabel: jumlah mutasi hari itu + saldo akhir. */
export interface KakiBuku {
  nMutasi: number;
  totalMutasi: number;
  saldoAkhir: number;
}

/**
 * ⛔ `saldoAkhir` diambil dari **saldo berjalan baris terakhir**, bukan dihitung
 * ulang sebagai `saldoAwal + Σ`. Keduanya seharusnya sama — dan justru itu
 * masalahnya: dua jalan menuju satu angka berarti ada kemungkinan keduanya
 * berselisih, dan yang berselisih di sini adalah saldo akhir buku kas.
 *
 * (Ditemukan oleh tesnya sendiri: pemanggil yang mengirim `saldoAwal` berbeda
 * dari yang dipakai {@link barisBuku} menghasilkan dua angka sah yang tak
 * cocok. `saldoAwal` kini hanya dipakai saat hari itu KOSONG.)
 */
export function kakiBuku(baris: readonly BarisBuku[], saldoAwal: number): KakiBuku {
  const total = baris.reduce((s, b) => s + b.amount, 0);
  return {
    nMutasi: baris.length,
    totalMutasi: total,
    saldoAkhir: baris.at(-1)?.saldoBerjalan ?? saldoAwal,
  };
}

// ---------------------------------------------------------------------------
// Tawaran setoran — DITAWARKAN, bukan diposting (§1.4)
// ---------------------------------------------------------------------------

/** Setoran yang diisi pengawas di Rincian Penjualan (`manual_entry`). */
export interface SetoranPengawas {
  id: string;
  keterangan: string;
  amount: number;
}

export interface TawaranSetoran extends SetoranPengawas {
  /** Sudah pernah disetujui & masuk buku kas? */
  sudahDibukukan: boolean;
}

/**
 * Gabungkan setoran pengawas dengan status "sudah dibukukan atau belum".
 *
 * ⛔ Pencocokannya lewat **id setoran** (`source_manual_entry_id`, 0033), BUKAN
 * lewat nominal+tanggal. Dua shift dengan nominal kebetulan sama adalah kejadian
 * biasa, dan pencocokan berbasis nominal akan menganggap yang kedua sudah
 * dibukukan — setoran hilang, kas terlihat lebih kecil, tanpa satu pun angka
 * tampak salah.
 */
export function tawaranSetoran(
  setoran: readonly SetoranPengawas[],
  sudahDipakai: ReadonlySet<string>,
): TawaranSetoran[] {
  return setoran.map((s) => ({ ...s, sudahDibukukan: sudahDipakai.has(s.id) }));
}

/** Yang masih menunggu persetujuan. */
export function tawaranTertunda(t: readonly TawaranSetoran[]): TawaranSetoran[] {
  return t.filter((x) => !x.sudahDibukukan);
}

/**
 * Nilai total yang akan masuk buku bila SELURUH tawaran tertunda disetujui.
 * Dipakai untuk kalimat "N setoran senilai Rp X menunggu persetujuan" — angka
 * yang membuat tawaran yang terlupakan bisa terlihat, bukan cuma terdaftar.
 */
export function nilaiTertunda(t: readonly TawaranSetoran[]): number {
  return tawaranTertunda(t).reduce((s, x) => s + x.amount, 0);
}
