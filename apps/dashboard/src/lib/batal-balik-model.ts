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
  hariTutup: "Hari ini sudah ditutup — baris tidak bisa dibatalkan. Pembalikan untuk hari tertutup menyusul.",
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
