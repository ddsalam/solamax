/**
 * Reklasifikasi biaya & pendapatan lain-lain pengawas (§2.3 `Reclassify`, §10.29) — MURNI.
 *
 * ⛔ Reklasifikasi TIDAK menyentuh baris pengawas: keterangan, nominal, tanggal,
 * dan kategori operasional tetap milik pengawas (§2.1). Yang berpindah hanya
 * AKUN AKUNTANSI-nya — lewat baris baru di `app.reclassification` (0021,
 * append-only). Akun efektif = reklasifikasi terakhir bila ada, kalau tidak
 * akun beku di barisnya (0024).
 *
 * Akun menentukan KE MANA baris itu masuk laporan — dan karena itu apakah ia
 * membentuk laba. Tiga kasus nyata 12–25 Sep 2026 yang melahirkan berkas ini
 * dicatat pengawas sebagai pengeluaran padahal bukan beban: prive ke pemilik,
 * setoran tunai ke bank, dan penjualan yang dibayar lewat transfer.
 */

export type JenisAkun = "beban" | "pendapatan" | "ekuitas" | "pindah_dana";
export type SeksiBiaya = "pengeluaran" | "pendapatan_lain";

export interface AkunReklas {
  kode: string;
  nama: string;
  jenis: JenisAkun;
  /** Seksi baris pengawas yang boleh dipindah ke akun ini. */
  untuk: readonly SeksiBiaya[];
}

const KEDUA: readonly SeksiBiaya[] = ["pengeluaran", "pendapatan_lain"];
const KELUAR: readonly SeksiBiaya[] = ["pengeluaran"];

/**
 * Daftar TERTUTUP akun tujuan reklasifikasi.
 *
 * · Beban & pendapatan = bagan §10.3 apa adanya.
 * · Dua akun BUKAN LABA (§10.29, usulan pelaksana — kodenya boleh diganti owner
 *   selama belum ada reklasifikasi yang memakainya):
 *     `3-9100` — uang yang keluar ke/ masuk dari PEMILIK (prive, kontribusi ke
 *       pusat, setoran modal). Mengalir ke `deltaKontribusi` neraca harian, jadi
 *       langkah harian tetap seimbang saat laba tak lagi memikulnya.
 *     `1-1800` — uang yang hanya BERPINDAH TEMPAT (laci → bank, penjualan yang
 *       dibayar transfer). Kedua sisinya sudah ada di buku kas Finance; baris
 *       pengawas ini tidak masuk laba maupun arus kas.
 */
export const AKUN_REKLAS: readonly AkunReklas[] = [
  { kode: "3-9100", nama: "Prive / kontribusi pemilik", jenis: "ekuitas", untuk: KEDUA },
  { kode: "1-1800", nama: "Perpindahan dana (setoran ke bank, pembayaran via transfer)", jenis: "pindah_dana", untuk: KEDUA },
  { kode: "6-1100", nama: "Gaji & Tunjangan", jenis: "beban", untuk: KELUAR },
  { kode: "6-1300", nama: "Konsumsi & Lembur", jenis: "beban", untuk: KELUAR },
  { kode: "6-2100", nama: "Supir Tangki", jenis: "beban", untuk: KELUAR },
  { kode: "6-2200", nama: "Kendaraan Operasional", jenis: "beban", untuk: KELUAR },
  { kode: "6-2300", nama: "Pemeliharaan Sarana", jenis: "beban", untuk: KELUAR },
  { kode: "6-2400", nama: "Utilitas & Prasarana", jenis: "beban", untuk: KELUAR },
  { kode: "6-3100", nama: "Perlengkapan Kantor", jenis: "beban", untuk: KELUAR },
  { kode: "6-3300", nama: "IT & Komunikasi", jenis: "beban", untuk: KELUAR },
  { kode: "6-3500", nama: "Sumbangan & Donasi", jenis: "beban", untuk: KELUAR },
  { kode: "6-4100", nama: "Promosi & Iklan", jenis: "beban", untuk: KELUAR },
  { kode: "6-9100", nama: "Beban Taktis", jenis: "beban", untuk: KELUAR },
  { kode: "6-9900", nama: "Beban Lain-Lain", jenis: "beban", untuk: KELUAR },
  { kode: "7-1100", nama: "Administrasi Bank", jenis: "beban", untuk: KELUAR },
  { kode: "7-1200", nama: "MDR", jenis: "beban", untuk: KELUAR },
  { kode: "8-1000", nama: "Pendapatan Lain-Lain", jenis: "pendapatan", untuk: ["pendapatan_lain"] },
];

/** Penanda akun asal yang KOSONG (baris pengawas belum pernah dipetakan). */
export const AKUN_KOSONG = "(belum dipetakan)";

const PER_KODE = new Map(AKUN_REKLAS.map((a) => [a.kode, a]));

export function akunReklas(kode: string | null): AkunReklas | null {
  return kode === null ? null : (PER_KODE.get(kode) ?? null);
}

/**
 * Pos empat digit (rencana K6 U1, migrasi 0056) yang bisa tersimpan di baris
 * biaya & pendapatan lain-lain: seluruh pos kelas 4 dan 5, plus dua pos
 * bukan-laba tujuan kode lama (3300 ← 3-9100, 1190 ← 1-1800).
 *
 * ⚠️ CERMIN seed `app.pos` 0056, bukan sumber kebenarannya — dipakai layar
 * klien yang tak bisa membaca basis data. Uji di keuangan-reklas.test.ts
 * membaca teks migrasi dan memerah bila nama atau jenisnya menyimpang.
 */
export const POS_BIAYA: Readonly<Record<string, { nama: string; jenis: JenisAkun }>> = {
  "1190": { nama: "Dana dalam Perjalanan", jenis: "pindah_dana" },
  "3300": { nama: "Prive", jenis: "ekuitas" },
  "4100": { nama: "Penjualan BBM", jenis: "pendapatan" },
  "4110": { nama: "Tera", jenis: "pendapatan" },
  "4200": { nama: "Pendapatan Lain-lain", jenis: "pendapatan" },
  "5100": { nama: "HPP - Harga Pokok BBM", jenis: "beban" },
  "5110": { nama: "Susut / Losses-Gain BBM", jenis: "beban" },
  "5120": { nama: "Selisih Harga Pembelian & Persediaan", jenis: "beban" },
  "5130": { nama: "Selisih Kas", jenis: "beban" },
  "5200": { nama: "Beban Gaji & THR", jenis: "beban" },
  "5300": { nama: "Beban Listrik, Air, Internet", jenis: "beban" },
  "5400": { nama: "Beban Sewa", jenis: "beban" },
  "5500": { nama: "Beban Bank & Biaya MDR QRIS", jenis: "beban" },
  "5600": { nama: "Beban Penyusutan", jenis: "beban" },
  "5700": { nama: "Beban Operasional Lain (ATK, kebersihan)", jenis: "beban" },
  "5800": { nama: "Beban Pajak", jenis: "beban" },
  "5900": { nama: "Beban Bunga Bank", jenis: "beban" },
};

/**
 * Kode lama → pos empat digit — CERMIN `app.pos_kode_lama` 0056 (dijaga uji
 * yang sama). Baris lama TIDAK ditulis ulang (KTD2); peta ini hanya
 * mengelompokkannya di bawah pos barunya saat ditampilkan.
 */
export const KODE_LAMA_POS: Readonly<Record<string, string>> = {
  "6-1100": "5200",
  "6-2400": "5300",
  "6-3300": "5300",
  "7-1200": "5500",
  "7-1100": "5500",
  "6-3100": "5700",
  "6-2300": "5700",
  "6-2200": "5700",
  "6-2100": "5700",
  "6-4100": "5700",
  "6-3500": "5700",
  "6-1300": "5700",
  "6-9100": "5700",
  "6-9900": "5700",
  "8-1000": "4200",
  "3-9100": "3300",
  "1-1800": "1190",
};

/** Pos pendapatan lain-lain (pengganti 8-1000) — R26. */
export const KODE_PENDAPATAN_LAIN = "4200";

/** Pos tempat sebuah kode tersimpan dikelompokkan. Tak dikenal / kosong ⇒ `null`. */
export function kodePos(kode: string | null): string | null {
  if (kode === null) return null;
  if (kode in POS_BIAYA) return kode;
  return KODE_LAMA_POS[kode] ?? null;
}

/**
 * Label KELOMPOK pos: "5300 Beban Listrik, Air, Internet" untuk 5300 maupun
 * 6-2400 lama — dipakai saat baris lama dan baru dijumlah bersama.
 */
export function labelPos(kode: string | null): string {
  if (kode === null || kode === AKUN_KOSONG) return "belum dipetakan";
  const k = kodePos(kode);
  return k === null ? kode : `${k} ${POS_BIAYA[k]!.nama}`;
}

/**
 * Label akun SEBAGAIMANA TERSIMPAN: "6-9900 Beban Lain-Lain", "5300 Beban
 * Listrik, Air, Internet" — atau kode apa adanya bila di luar kedua daftar.
 * Kode lama tetap berlabel lamanya (riwayat "semula …").
 */
export function labelAkun(kode: string | null): string {
  if (kode === null || kode === AKUN_KOSONG) return "belum dipetakan";
  const a = PER_KODE.get(kode);
  if (a) return `${a.kode} ${a.nama}`;
  const p = POS_BIAYA[kode];
  return p ? `${kode} ${p.nama}` : kode;
}

/**
 * Jenis akun efektif sebuah baris.
 *
 * ⛔ R26 — SEKSI memutuskan arah laba, akun hanya bisa mengeluarkan baris dari
 * laba. Baris berakun beban/pendapatan berjenis menurut seksinya
 * (pengeluaran = beban, pendapatan lain = pendapatan), apa pun kode
 * tersimpannya. Sebelum ini, pendapatan lain dari pintu Finance tersimpan
 * berkode beban (peta kategori hanya berisi beban) dan lenyap dari laba:
 * bukan pendapatan karena kodenya beban, bukan beban karena seksinya
 * pendapatan. Hanya dua akun bukan-laba (prive, pindah dana — kode lama
 * maupun pos barunya) yang mengubah rumah baris.
 *
 * Akun kosong atau di luar daftar juga mengikuti seksi — supaya laba baris
 * yang tak pernah direklasifikasi tidak berubah serupiah pun.
 */
export function jenisAkun(kode: string | null, section: string): JenisAkun {
  const k = kodePos(kode);
  const j = akunReklas(kode)?.jenis ?? (k === null ? null : POS_BIAYA[k]!.jenis);
  if (j === "ekuitas" || j === "pindah_dana") return j;
  return section === "pendapatan_lain" ? "pendapatan" : "beban";
}

/**
 * Akun yang disimpan baris pintu Finance (R26). Pendapatan lain-lain SELALU
 * 4200 — peta kategori operasional hanya berisi pos beban, dan memakainya
 * untuk pendapatan menyimpan kode beban. Pengeluaran memakai hasil peta apa
 * adanya (`null` = kategori tanpa peta ⇒ pemanggil menolak).
 */
export function akunPintuFinance(
  section: SeksiBiaya,
  akunPeta: string | null,
): string | null {
  return section === "pendapatan_lain" ? KODE_PENDAPATAN_LAIN : akunPeta;
}

/** Apakah akun ini membentuk LABA (beban/pendapatan) — kebalikan dua akun bukan-laba. */
export function membentukLaba(j: JenisAkun): boolean {
  return j === "beban" || j === "pendapatan";
}

/**
 * Akun efektif dalam SQL — SATU rumus untuk laporan, layar Biaya, dan
 * Pemantauan. `alias` = alias tabel `app.manual_entry` di kueri pemanggil.
 */
export const SQL_AKUN_EFEKTIF = (alias: string): string =>
  `COALESCE((SELECT r.to_account FROM app.reclassification r
              WHERE r.source_kind = 'manual_entry' AND r.source_txn_id = ${alias}.id
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT 1), ${alias}.accounting_account)`;

/**
 * Dampak reklasifikasi pada LABA hari itu (positif = laba naik). Dipakai
 * pratinjau layar — Finance melihat akibatnya sebelum menyimpan.
 */
export function dampakLaba(
  section: string,
  dari: string | null,
  ke: string,
  nominal: number,
): number {
  const n = Math.abs(nominal);
  const sebelum = membentukLaba(jenisAkun(dari, section));
  const sesudah = membentukLaba(jenisAkun(ke, section));
  if (sebelum === sesudah) return 0;
  const tandaLaba = section === "pengeluaran" ? -n : n; // sumbangan baris ke laba
  return sesudah ? tandaLaba : -tandaLaba;
}

export interface CekReklas {
  section: string;
  void: boolean;
  status: string;
  titipanBright: boolean;
  dari: string | null;
  ke: string;
  alasan: string;
  alasanSah: ReadonlySet<string>;
  catatan: string;
}

/** Pemeriksaan server & layar — satu tempat. `null` = boleh. */
export function periksaReklas(c: CekReklas): string | null {
  if (c.void) return "Baris ini sudah dibatalkan — tidak ada yang bisa direklasifikasi.";
  if (c.status === "draft") return "Baris masih draft pengawas — tunggu sampai disubmit.";
  if (c.section !== "pengeluaran" && c.section !== "pendapatan_lain") {
    return "Hanya biaya operasional & pendapatan lain-lain yang bisa direklasifikasi.";
  }
  if (c.titipanBright) {
    return "Titipan outlet Bright sudah bukan pendapatan (§10.27) — ubah lewat centang titipan di Rincian, bukan reklasifikasi.";
  }
  const tujuan = akunReklas(c.ke);
  if (tujuan === null) return "Akun tujuan tidak dikenal — pilih dari daftar.";
  if (!tujuan.untuk.includes(c.section as SeksiBiaya)) {
    return c.section === "pengeluaran"
      ? "Pengeluaran tidak bisa dipindah ke akun pendapatan."
      : "Pendapatan lain-lain tidak bisa dipindah ke akun beban.";
  }
  if ((c.dari ?? AKUN_KOSONG) === c.ke) return "Baris ini sudah berada di akun itu.";
  if (!c.alasanSah.has(c.alasan)) return "Pilih alasan reklasifikasi.";
  // Memindahkan baris KELUAR dari laba mengubah laba — alasannya harus tertulis,
  // bukan hanya kode: "prive ke PT X", "setoran ke BCA oleh Pak Y".
  if (!membentukLaba(tujuan.jenis) && c.catatan.trim().length < 5) {
    return "Tulis catatan singkat untuk akun bukan-laba — misalnya ke siapa uangnya pergi.";
  }
  return null;
}
