import { addDays } from "./periods";

/**
 * ATURAN TANGGAL BUKU (rencana 2026-10-29 KTD5; R22, R28) — MURNI, tanpa I/O.
 *
 * Satu fungsi untuk SEMUA jalur tulis baru (impor, klasifikasi, pemindahan
 * penampung, pinjaman antar unit, penebusan, pembatalan). Pembungkus kuerinya,
 * yang membaca cut-over & hari tertutup dan MENGUNCI hari tujuan di dalam
 * transaksi pemanggil, ada di `hari-buku-queries.ts`.
 *
 * ⛔ DUA HASIL YANG TIDAK BOLEH DICAMPUR:
 *
 * 1. **Pra-cut-over = TIDAK DIBUKUKAN sama sekali** (R22, §10.24 butir 2).
 *    Saldo pembuka berarti "saldo pada AWAL hari cut-over"; mutasi yang lebih
 *    tua sudah termuat di dalamnya. Mendorongnya maju ke hari terbuka pertama
 *    akan MENGHITUNGNYA DUA KALI — karena itu ia bukan kasus "maju".
 * 2. **Hari tertutup = DIDORONG MAJU, tidak pernah disunting** (Key Decision
 *    "Koreksi dibukukan maju…", session-settled). Hari buku = hari pertama
 *    ≥ tanggal transaksi yang `day_close`-nya tidak `closed`. Baris yang
 *    terdorong membawa tanggal asal + kode alasan `ADJ-FWD-*` (0049).
 *
 * Hari TANPA baris `day_close` = TERBUKA: baris lahir saat Layar 4 dibuka
 * (§10.15), jadi hari yang tak pernah dibuka memang belum ditutup. Yang dicari
 * di sini hanya baris berstatus `closed`.
 *
 * `cutOver === null` (unit/rekening belum punya saldo pembuka) ⇒ tak ada batas
 * bawah — sama persis dengan `simpanMutasiKas` hari ini, yang hanya menolak
 * bila saldo pembuka ADA dan tanggalnya lebih muda.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MasukanHariBuku {
  /** Tanggal transaksi (mis. tanggal bank), 'YYYY-MM-DD'. */
  tanggal: string;
  /** Cut-over yang berlaku (§10.24/§10.26); `null` = belum ada saldo pembuka. */
  cutOver: string | null;
  /** Hari berstatus `closed` milik unit itu — cukup yang ≥ `tanggal`. */
  tertutup: Iterable<string>;
}

export type HasilHariBuku =
  | { status: "pra-cut-over"; cutOver: string }
  | { status: "dibukukan"; hariBuku: string; terdorongMaju: boolean };

function wajibTanggal(nama: string, v: string): void {
  // Ditolak keras, bukan ditebak: perbandingan string 'YYYY-MM-DD' hanya benar
  // bila bentuknya persis begitu — '2026-10-2' > '2026-10-10' secara leksikal.
  if (!DATE_RE.test(v)) throw new Error(`${nama} harus berbentuk YYYY-MM-DD, diterima "${v}".`);
}

export function tentukanHariBuku(m: MasukanHariBuku): HasilHariBuku {
  wajibTanggal("tanggal", m.tanggal);
  if (m.cutOver !== null) wajibTanggal("cutOver", m.cutOver);

  if (m.cutOver !== null && m.tanggal < m.cutOver) {
    return { status: "pra-cut-over", cutOver: m.cutOver };
  }

  const tutup = new Set<string>();
  for (const d of m.tertutup) {
    wajibTanggal("hari tertutup", d);
    tutup.add(d);
  }

  // Berhenti pasti: himpunan hari tertutup terbatas, jadi paling lama
  // |tutup| langkah sebelum menemukan hari yang tak ada di dalamnya.
  let hari = m.tanggal;
  while (tutup.has(hari)) hari = addDays(hari, 1);

  return { status: "dibukukan", hariBuku: hari, terdorongMaju: hari !== m.tanggal };
}
