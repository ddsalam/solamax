/**
 * Batalkan & Balik baris pintu Finance (rencana 2026-11-07) — aturan MURNI.
 *
 * Satu pemeriksa per tindakan, dipakai jalur tulis (`batal-balik-tulis.ts`) dan
 * layar (pesan yang sama). Urutannya disengaja: ASAL-USUL baris diperiksa lebih
 * dulu daripada isian, supaya pengguna yang salah jalan diberi tahu jalan yang
 * benar — bukan disuruh mengisi alasan untuk tindakan yang tetap akan ditolak.
 */
import { jenisAkun, membentukLaba } from "./keuangan-reklas";

/** Fakta baris yang menentukan boleh-tidaknya Batalkan — dibaca ULANG di transaksi. */
export interface BarisBatal {
  sourceDoor: string;
  void: boolean;
  cashLedgerId: string | null;
  /** `day_close.status = 'closed'` untuk (unit, tanggal) baris. */
  hariTutup: boolean;
  /** Ada baris `tutup_bulan` (K5 maupun buku besar) untuk bulan baris. */
  bulanTutup: boolean;
}

export interface IsianBatal {
  reasonCode: string;
  alasan: string;
}

export const ALASAN_MIN = 5;

export const PESAN_BATAL = {
  pengawas:
    "Baris ini dicatat pengawas — Finance tidak membatalkannya. Pakai \"Kembalikan untuk perbaikan\" supaya pengawas yang memperbaiki.",
  bertautKas:
    "Baris ini lahir dari mutasi kas/bank. Batalkan mutasi kas asalnya di buku kas/bank — bebannya ikut batal, supaya kas dan laba tidak berpisah.",
  hariTutup: "Hari ini sudah ditutup — baris tidak bisa dibatalkan. Pakai \"Ajukan balik\" (perlu persetujuan orang kedua).",
  bulanTutup: "Bulan baris ini sudah ditutup — baris tidak bisa dibatalkan atau dibalik lagi.",
  sudahBatal: "Baris ini sudah dibatalkan.",
  kode: "Pilih kode alasan pembatalan dari daftar.",
  alasan: `Tulis alasan pembatalan (minimal ${ALASAN_MIN} huruf).`,
} as const;

export function periksaBatal(b: BarisBatal, isian: IsianBatal, kodeSah: ReadonlySet<string>): string | null {
  if (b.sourceDoor !== "finance") return PESAN_BATAL.pengawas;
  if (b.void) return PESAN_BATAL.sudahBatal;
  if (b.cashLedgerId !== null) return PESAN_BATAL.bertautKas;
  if (b.bulanTutup) return PESAN_BATAL.bulanTutup;
  if (b.hariTutup) return PESAN_BATAL.hariTutup;
  if (!kodeSah.has(isian.reasonCode)) return PESAN_BATAL.kode;
  if (isian.alasan.trim().length < ALASAN_MIN) return PESAN_BATAL.alasan;
  return null;
}

/**
 * Perubahan LABA BERSIH bila baris ini tidak lagi berlaku (Batalkan maupun
 * Balik). Akun EFEKTIF yang menentukan: baris yang sudah direklasifikasi ke akun
 * bukan-laba tidak lagi membentuk laba, jadi membatalkannya tak mengubah laba
 * (AE2 — tidak dihitung dua kali).
 */
export function dampakBatal(section: string, akunEfektif: string | null, amount: number): number {
  if (!membentukLaba(jenisAkun(akunEfektif, section))) return 0;
  const n = Math.abs(amount);
  return section === "pengeluaran" ? n : -n;
}

// ---------------------------------------------------------------------------
// Balik (rencana 2026-11-07 Rilis 2; R8–R12)
// ---------------------------------------------------------------------------

/** Kode alasan Balik: grup `adjustment` tanpa kode pembukuan maju (diisi sistem) & legacy Direksi. */
export const KODE_BALIK = ["ADJ-DUP", "ADJ-AMOUNT", "ADJ-DATE", "ADJ-PARTY"] as const;

export interface BarisBalik extends BarisBatal {
  /** Sudah ada `correction_entry` reversal untuk baris ini. */
  dibalik: boolean;
  /** Sudah ada `correction_request` berstatus menunggu untuk baris ini. */
  menunggu: boolean;
}

export const PESAN_BALIK = {
  pengawas: PESAN_BATAL.pengawas,
  bertautKas:
    "Baris ini lahir dari mutasi kas/bank — membaliknya sendiri memisahkan kas dari laba. Hubungi Head of Finance untuk koreksi mutasi kas asalnya.",
  sudahBatal: PESAN_BATAL.sudahBatal,
  bulanTutup: PESAN_BATAL.bulanTutup,
  hariTerbuka: "Hari ini belum ditutup — pakai Batalkan, bukan Balik.",
  sudahDibalik: "Baris ini sudah dibalik.",
  sudahMenunggu: "Sudah ada pengajuan balik yang menunggu persetujuan untuk baris ini.",
  kode: "Pilih kode alasan koreksi dari daftar.",
  alasan: `Tulis alasan pembalikan (minimal ${ALASAN_MIN} huruf).`,
  catatan: `Tulis catatan penolakan (minimal ${ALASAN_MIN} huruf).`,
  bukanMenunggu: "Pengajuan ini sudah diputus atau ditarik — muat ulang halaman.",
  diriSendiri: "Pengajuan balik tidak bisa disetujui atau ditolak oleh pengajunya sendiri — perlu orang kedua.",
  bukanPengaju: "Hanya pengaju yang bisa menarik pengajuannya.",
} as const;

export function periksaAjukanBalik(b: BarisBalik, isian: IsianBatal, kodeSah: ReadonlySet<string>): string | null {
  if (b.sourceDoor !== "finance") return PESAN_BALIK.pengawas;
  if (b.void) return PESAN_BALIK.sudahBatal;
  if (b.dibalik) return PESAN_BALIK.sudahDibalik;
  if (b.cashLedgerId !== null) return PESAN_BALIK.bertautKas;
  if (b.bulanTutup) return PESAN_BALIK.bulanTutup;
  if (!b.hariTutup) return PESAN_BALIK.hariTerbuka;
  if (b.menunggu) return PESAN_BALIK.sudahMenunggu;
  if (!kodeSah.has(isian.reasonCode)) return PESAN_BALIK.kode;
  if (isian.alasan.trim().length < ALASAN_MIN) return PESAN_BALIK.alasan;
  return null;
}

/** Satu baris yang dibalik SESUDAH harinya ditutup (R12b) — untuk Layar 4 & PDF tutup hari. */
export interface BarisDibalik {
  keterangan: string;
  section: string;
  /** Akun EFEKTIF saat ini. */
  akun: string | null;
  amount: number;
  kode: string;
  alasan: string;
  pengaju: string | null;
  penyetuju: string | null;
  /** WIB, `YYYY-MM-DD HH24:MI`. */
  waktu: string;
}

/**
 * R12b — `day_close` hari itu BEKU (§10.15): selisih saat ditutup tidak dihitung
 * ulang. Dampak Balik ditampilkan TERPISAH sebagai perubahan laba bersih hari
 * itu, supaya "angka yang disahkan" dan "angka sekarang" sama-sama terbaca.
 */
export function ringkasDibalik(rows: readonly BarisDibalik[]): { n: number; dampakLaba: number } {
  return {
    n: rows.length,
    dampakLaba: rows.reduce((s, r) => s + dampakBatal(r.section, r.akun, r.amount), 0),
  };
}
