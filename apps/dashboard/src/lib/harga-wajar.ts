/**
 * Vonis "harga jual wajar" — SATU aturan, satu tempat.
 *
 * Masalah yang dijaga: POS EasyMax sesekali merekam tutupan shift dengan harga
 * jual milik PRODUK LAIN. Insiden yang membuka kelas ini: SPBU Korek 23 Agu
 * 2026 shift 3, Dexlite direkam Rp 7.850/L (harga produk BB-01 "PLK") alih-alih
 * Rp 20.150/L → omzet kurang catat Rp 4.119.885 pada 334,95 L. Volume &
 * totalisatornya BENAR; yang salah hanya harganya. Sapuan riwayat 7 unit
 * menemukan 72 kejadian sepanjang 2026 — kelas berulang, bukan sekali.
 *
 * Kenapa ia berbahaya lebih dari sekadar "angka laporan salah": omzet A adalah
 * komponen pertama rekonsiliasi tunai (H = A − (B+C+D) + F − G). Omzet yang
 * kurang catat membuat H terlalu kecil, sehingga setoran yang SEBENARNYA benar
 * terbaca "melebihi uang tunai". Satu cacat harga karena itu melahirkan alarm
 * kedua yang menuduh orang yang tak bersalah.
 *
 * ── Aturannya ──────────────────────────────────────────────────────────────
 * Untuk tiap (unit, produk, tanggal): `dom` = harga dengan volume terbesar hari
 * itu. Baris yang harganya ≠ `dom` BUKAN otomatis cacat — pada hari perubahan
 * harga Pertamina sebagian shift memang memakai harga lama. Pembedanya:
 *
 *   harga = dom_prev  → perubahan harga (sebagian shift masih harga kemarin)
 *   harga = dom_next  → perubahan harga (sebagian shift sudah harga besok)
 *   dom_next belum ada → MENUNGGU — belum bisa divonis, jangan menuduh
 *   selain itu        → CACAT — harga ini tak pernah dipakai unit ini di sekitar
 *                       tanggal itu
 *
 * `dom_prev`/`dom_next` diambil dari HARI-JUAL tetangga (bukan tanggal kalender)
 * — lihat `getHargaDeviasi` di lib/queries.ts.
 *
 * ── Batas yang diketahui (jangan dibaca sebagai vonis) ─────────────────────
 * 1. Aturan ini **menyaring, bukan memutuskan**. Ia menunjuk baris yang layak
 *    dilihat manusia; pembuktiannya tetap di EasyMax unit ybs.
 * 2. **Cacat yang menutupi sehari penuh lolos.** Kalau SELURUH shift memakai
 *    harga salah yang sama, harga itu menjadi `dom` dan tak ada yang menyimpang.
 *    Yang tertangkap hanya cacat MINORITAS dalam satu hari.
 * 3. **Cacat yang harganya kebetulan sama dengan harga kemarin lolos** (dianggap
 *    perubahan harga). Sengaja: arah aman adalah diam, bukan menuduh.
 * 4. Baris nol-liter tak dinilai sama sekali (tak membawa rupiah).
 */

export type VonisHarga = "perubahan_harga" | "menunggu" | "cacat";

/** Bentuk minimum yang dibutuhkan aturan — sengaja bukan tipe query penuh. */
export interface DeviasiHarga {
  harga: number;
  dom: number;
  dom_prev: number | null;
  dom_next: number | null;
  vol: number;
}

/**
 * Vonis satu baris deviasi. Pemanggil dijamin hanya menyerahkan baris yang
 * `harga !== dom` (itulah yang dipulangkan query); baris `harga === dom`
 * tetap dijawab "perubahan_harga" agar fungsi ini total, bukan melempar.
 */
export function vonisHarga(r: DeviasiHarga): VonisHarga {
  if (r.harga === r.dom) return "perubahan_harga";
  if (r.dom_prev !== null && r.harga === r.dom_prev) return "perubahan_harga";
  if (r.dom_next === null) return "menunggu";
  if (r.harga === r.dom_next) return "perubahan_harga";
  return "cacat";
}

/**
 * Rupiah yang KURANG tercatat oleh baris ini (positif = omzet kurang catat,
 * negatif = omzet lebih catat). Basisnya `dom` — harga yang dipakai mayoritas
 * volume hari itu — bukan master harga, sebab master hanya menyimpan harga KINI
 * dan akan salah untuk tiap tanggal sebelum perubahan harga terakhir.
 */
export function selisihRp(r: DeviasiHarga): number {
  return r.vol * (r.dom - r.harga);
}

export interface RingkasHarga<T extends DeviasiHarga> {
  cacat: T[];
  menunggu: T[];
  /** Σ selisih rupiah baris CACAT saja (yang menunggu belum tentu cacat). */
  selisihRp: number;
  /** |Σ| terbesar satu baris cacat — untuk urutan keparahan feed anomali. */
  maxAbsRp: number;
}

/** Pisahkan kandidat menjadi cacat / menunggu, dan jumlahkan rupiahnya. */
export function ringkasHarga<T extends DeviasiHarga>(rows: readonly T[]): RingkasHarga<T> {
  const cacat: T[] = [];
  const menunggu: T[] = [];
  for (const r of rows) {
    const v = vonisHarga(r);
    if (v === "cacat") cacat.push(r);
    else if (v === "menunggu") menunggu.push(r);
  }
  return {
    cacat,
    menunggu,
    selisihRp: cacat.reduce((t, r) => t + selisihRp(r), 0),
    maxAbsRp: cacat.reduce((t, r) => Math.max(t, Math.abs(selisihRp(r))), 0),
  };
}
