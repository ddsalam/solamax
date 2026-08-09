/**
 * ARUS MINYAK HARIAN — dekomposisi per produk dari G/L metode RESUME.
 *
 * Padanan blok "ARUS MINYAK" pada **LAPORAN RESUME OPERASIONAL** EasyMax (oracle
 * sah; BUKAN "Laporan Penjualan Harian" — definisinya beda). Identitasnya:
 *
 *   Stock Teori = Stock Awal + Penerimaan − Penjualan
 *   Losses      = Stock Fisik − Stock Teori
 *   %           = Losses / Penjualan × 100        (BUKAN Losses / Persediaan)
 *
 * **Bukan angka baru.** Substitusi ketiganya memberi
 *   Losses = fisik − (fisik_prev + pen_do − penjualan)
 * yang identik `DailyGlRow.gl` — jadi section ini MENGURAI G/L yang sudah dipakai
 * papan direksi & PDF, bukan menyainginya. Karena itu sumbernya `getDailyGlByProduct`
 * yang sudah ditarik halaman Laporan (nol query tambahan), dan angkanya wajib tetap
 * sama dengan panel "Omset Penjualan, Gain (Losses) & Tera" di halaman yang sama —
 * dijaga `arus-minyak.test.ts`.
 *
 * **Penjualan = jual KOTOR − tera RESMI** (bukan kotor). Diputuskan oleh oracle,
 * bukan selera: satu-satunya sel ber-tera ≠ 0 di rentang oracle (2 Agu 2026 Dexlite,
 * tera 0,64 L) mencetak Penjualan 3.801,75 = 3.802,39 − 0,64, dan Stock Teori-nya
 * 15.874,04 = 19.675,79 − 3.801,75 mengonfirmasi lewat sel kedua yang bebas.
 * Memakai kotor melahirkan 6 sel MISMATCH; bersih menyisakan 0 (kecuali D-5).
 *
 * Kolom "Persediaan (L)" EasyMax (= Awal + Penerimaan) sengaja TIDAK dirender —
 * keputusan owner; secara informasi ia memang redundan.
 */
import type { DailyGlRow } from "./queries";

export interface ArusRow {
  ckdbbm: string;
  nama: string;
  /** Stock Fisik hari-bisnis sebelumnya. null = anchor tak ada. */
  awal: number | null;
  penerimaan: number;
  /** Jual KOTOR − tera RESMI. */
  penjualan: number;
  /** Awal + Penerimaan − Penjualan. null bila `awal` null. */
  teori: number | null;
  fisik: number | null;
  /** Fisik − Teori (+ gain, − loss). null bila salah satu komponen null. */
  losses: number | null;
  /** Losses/Penjualan × 100. null = rasio tak terdefinisi (lihat lossPct). */
  pct: number | null;
}

export interface ArusMinyak {
  rows: ArusRow[];
  total: ArusRow;
  /** Ada baris yang G/L-nya belum final (opname penutup belum ada / ada celah). */
  provisional: boolean;
  /** Σ tangki di luar batas wajar yang dikecualikan dari Stock Fisik hari itu. */
  excludedTanks: number;
  /** Ada baris tanpa Stock Awal/Fisik → total kolom itu tidak lengkap. */
  incomplete: boolean;
}

export function stockTeori(
  awal: number | null,
  penerimaan: number,
  penjualan: number,
): number | null {
  return awal === null ? null : awal + penerimaan - penjualan;
}

export function losses(fisik: number | null, teori: number | null): number | null {
  return fisik === null || teori === null ? null : fisik - teori;
}

/**
 * Losses sebagai % PENJUALAN (penyebutnya penjualan — terbukti di oracle: 4 Agu
 * P. Turbo 7,72/64,69 = 11,93 %, dan 6 Agu Pertamina Dex 184,69 % yang mustahil
 * bila penyebutnya Persediaan).
 *
 * Penjualan = 0: oracle hanya pernah memperlihatkan kasus ini dengan Losses = 0
 * juga (baris Premium) dan mencetak 0,00 → itu yang ditiru. Untuk Penjualan = 0
 * **dengan** Losses ≠ 0 oracle TIDAK memberi bukti, dan mencetak "0,00" di sana
 * berarti menyatakan "tidak ada losses" padahal ada → dikembalikan null ("—").
 */
export function lossPct(lossesL: number | null, penjualan: number): number | null {
  if (lossesL === null) return null;
  if (penjualan === 0) return lossesL === 0 ? 0 : null;
  return (lossesL / penjualan) * 100;
}

/**
 * Baris = produk yang punya opname PENUTUP pada tanggal-bisnis itu (persis
 * himpunan baris `getDailyGlByProduct`), diurutkan oleh pemanggil.
 *
 * Beda yang DIKETAHUI terhadap oracle: EasyMax mencetak 7 slot produk tetap —
 * termasuk PREMIUM seluruh-nol — dan menghilangkan BIO SOLAR meski ada di master
 * `product` (8 baris). Jadi barisnya bukan "dari master" dan bukan "yang
 * bertransaksi"; tampaknya daftar tetap di dalam laporan EasyMax. Meniru daftar
 * tetap itu salah untuk unit lain (BB-01 benar-benar hidup s/d 2021 di 5 unit),
 * maka baris di sini digerakkan data. Baris seluruh-nol yang hilang tidak
 * mengubah satu pun angka Total.
 */
export function buildArusMinyak(glRows: DailyGlRow[]): ArusMinyak {
  const rows: ArusRow[] = glRows.map((r) => {
    const penjualan = r.sales_gross - r.tera;
    const teori = stockTeori(r.fisik_prev, r.pen_do, penjualan);
    const l = losses(r.fisik, teori);
    return {
      ckdbbm: r.ckdbbm,
      nama: r.nama ?? r.ckdbbm,
      awal: r.fisik_prev,
      penerimaan: r.pen_do,
      penjualan,
      teori,
      fisik: r.fisik,
      losses: l,
      pct: lossPct(l, penjualan),
    };
  });

  // TOTAL = penjumlahan kolom apa adanya; % Total = ΣLosses/ΣPenjualan (BUKAN
  // rata-rata persen — terbukti 1 Agu: −2.441,70/54.079,83 = −4,51 sedangkan
  // rata-rata ketujuh persen = −7,49).
  //
  // ⚠️ SENGAJA BEDA DARI ORACLE di satu titik: EasyMax mencetak Total Penjualan
  // dari jual KOTOR sementara kolom di atasnya bersih-tera, sehingga TOTAL-nya
  // tidak sama dengan jumlah kolomnya sendiri (2 Agu: 52.909,68 vs 52.909,04 —
  // persis 0,64 L tera). Di sini TOTAL selalu jumlah kolom yang tercetak.
  const nz = (xs: (number | null)[]): number =>
    xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const totPenjualan = nz(rows.map((r) => r.penjualan));
  const totFisik = rows.every((r) => r.fisik === null) && rows.length > 0 ? null : nz(rows.map((r) => r.fisik));
  const totTeori = rows.every((r) => r.teori === null) && rows.length > 0 ? null : nz(rows.map((r) => r.teori));
  const totLosses = rows.every((r) => r.losses === null) && rows.length > 0 ? null : nz(rows.map((r) => r.losses));
  const total: ArusRow = {
    ckdbbm: "",
    nama: "TOTAL",
    awal: rows.every((r) => r.awal === null) && rows.length > 0 ? null : nz(rows.map((r) => r.awal)),
    penerimaan: nz(rows.map((r) => r.penerimaan)),
    penjualan: totPenjualan,
    teori: totTeori,
    fisik: totFisik,
    losses: totLosses,
    pct: lossPct(totLosses, totPenjualan),
  };

  return {
    rows,
    total,
    provisional: glRows.some((r) => r.provisional || r.gl === null),
    excludedTanks: glRows.reduce((s, r) => s + r.excluded_tanks, 0),
    incomplete: rows.some((r) => r.awal === null || r.fisik === null),
  };
}
