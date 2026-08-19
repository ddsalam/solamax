import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ALAT UKUR ONGKOS KUERI — dipasang di jalur nyata, bukan di beban tiruan.
 *
 * Kenapa ada: angka ongkos papan pernah **ditaksir** ("≈16 kueri per unit") lalu
 * dikutip di komentar, penjaga, dan header halaman. Taksirannya meleset 37%, dan
 * tak satu pun dari ketiga tempat itu bisa berbunyi merah karena semuanya
 * menjaga KALIMATNYA, bukan kebenarannya. Angka yang dikutip di lebih dari satu
 * tempat butuh sumber yang DIUKUR — ini sumbernya.
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **Tak boleh menjatuhkan yang diukur.** Seluruh penulisan dibungkus
 *    `try/catch` kosong, dan `ukur()` mengembalikan/melempar apa adanya dari
 *    `fn`. Alat ukur yang bisa menjatuhkan halaman lebih mahal dari yang diukur.
 * 2. **Yang dicatat HANYA jumlah dan durasi.** Labelnya dibatasi himpunan
 *    tetap `LABEL_UKUR` — bukan string bebas. Ini bukan gaya: label bebas adalah
 *    pintu tempat nama pelanggan, nominal, atau kode unit ikut keluar ke log.
 * 3. **Dua penghitung, bukan satu.** `kueri` = panggilan logis (`q`/`qScoped`);
 *    `pernyataan` = round-trip SQL sesungguhnya. `qScoped` berharga EMPAT
 *    pernyataan per satu kueri (BEGIN · set_config · kueri · COMMIT), dan
 *    mencampur keduanya persis yang melahirkan taksiran yang meleset itu.
 */

/** Himpunan label yang boleh keluar ke log. Sengaja tertutup — lihat butir 2. */
export const LABEL_UKUR = ["papan", "bahan-laporan", "lain"] as const;
export type LabelUkur = (typeof LABEL_UKUR)[number];

export interface Ukuran {
  readonly label: LabelUkur;
  readonly kueri: number;
  readonly pernyataan: number;
  readonly ms: number;
}

interface Penghitung {
  kueri: number;
  pernyataan: number;
  /** Skop pembungkus, kalau ada — dipakai supaya papan menjumlahkan anak-anaknya. */
  readonly induk: Penghitung | null;
}

const skop = new AsyncLocalStorage<Penghitung>();

/** Naik ke seluruh rantai skop: satu kueri anak juga kueri induknya. */
function naikkan(bidang: "kueri" | "pernyataan"): void {
  let p = skop.getStore() ?? null;
  while (p !== null) {
    p[bidang]++;
    p = p.induk;
  }
}

/** Dipanggil `q`/`qScoped` sekali per panggilan LOGIS. Di luar skop = no-op. */
export function catatKueri(): void {
  naikkan("kueri");
}

/** Dipanggil sekali per ROUND-TRIP SQL. Di luar skop = no-op. */
export function catatPernyataan(): void {
  naikkan("pernyataan");
}

/**
 * Penulis baris ukur. Objek (bukan fungsi lepas) supaya uji bisa menukarnya —
 * dan supaya penukaran itu terlihat sebagai satu titik, bukan tersebar.
 */
export const PENULIS: { tulis: (baris: string) => void } = {
  tulis: (baris) => console.info(baris),
};

/**
 * Bentuk baris log. Ketat dengan sengaja: penjaganya mencocokkan REGEX ini, jadi
 * menambahkan medan bernilai data akan membuat ujinya merah — itu tujuannya.
 */
export const BARIS_UKUR_RE = /^\[ukur\] (?:papan|bahan-laporan|lain) kueri=\d+ pernyataan=\d+ ms=\d+$/;

export function barisUkur(u: Ukuran): string {
  return `[ukur] ${u.label} kueri=${u.kueri} pernyataan=${u.pernyataan} ms=${u.ms}`;
}

/** Label tak dikenal (pemanggil JS tanpa type-check) jatuh ke "lain", tak lolos apa adanya. */
function labelAman(label: string): LabelUkur {
  return (LABEL_UKUR as readonly string[]).includes(label) ? (label as LabelUkur) : "lain";
}

/**
 * Jalankan `fn` sambil menghitung kueri & wall-clock, lalu tulis SATU baris.
 *
 * Baris tetap ditulis saat `fn` melempar — render yang GAGAL tetap memakan
 * koneksi dan waktu, dan justru itu yang mahal.
 */
export async function ukur<T>(label: LabelUkur, fn: () => Promise<T>): Promise<T> {
  const p: Penghitung = { kueri: 0, pernyataan: 0, induk: skop.getStore() ?? null };
  const t0 = performance.now();
  try {
    return await skop.run(p, fn);
  } finally {
    try {
      PENULIS.tulis(
        barisUkur({
          label: labelAman(label),
          kueri: p.kueri,
          pernyataan: p.pernyataan,
          ms: Math.round(performance.now() - t0),
        }),
      );
    } catch {
      /* alat ukur tak pernah menjatuhkan yang diukur (butir 1) */
    }
  }
}
