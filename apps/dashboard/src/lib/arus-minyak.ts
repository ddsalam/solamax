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
 * **KONVENSI TERA — tidak seragam, dan itu memang perilaku EasyMax.**
 * Diturunkan dari oracle 21 Nov 2025 (tera 1.000,00 L pada SATU produk) yang untuk
 * pertama kalinya mampu mendiskriminasi. Enumerasi penuh: dari 56 sel, **8**
 * berbeda antara konvensi bersih-tera dan kotor, dan oracle membelah:
 *
 *   BERSIH (jual kotor − tera): kolom **Penjualan**, **Teori**, **Losses** —
 *     baik per baris MAUPUN di baris TOTAL.
 *   KOTOR (jual kotor apa adanya): **TOTAL Penjualan**, dan **penyebut %**
 *     (per baris maupun TOTAL).
 *
 * Jadi EasyMax mengurangkan tera di KOLOM tapi tidak di dua TURUNAN itu. Bukti
 * per sel (Dexlite 21 Nov): Penjualan 10.142,88 = 11.142,88 − 1.000 (bersih) ·
 * Teori 10.758,34 (bersih) · Losses 162,35 (bersih) · **% 1,46 =
 * 162,35/11.142,88** — bukan 1,60 (bersih) dan bukan 10,43 (kotor penuh),
 * melainkan Losses BERSIH di atas penyebut KOTOR. TOTAL Penjualan 69.903,06 =
 * Σ kotor, sedangkan TOTAL Teori 68.271,60 & TOTAL Losses 813,47 = Σ kolom bersih.
 * 48 sel sisanya (yang tak terdiskriminasi) cocok seluruhnya → tak ada salah lain.
 *
 * Konsekuensinya tabel ini **sengaja tidak menjumlah dirinya sendiri** pada kolom
 * Penjualan di hari ber-tera; catatan kaki WAJIB menyebut angka teranya supaya
 * pembaca yang menjumlah menemukan jawabannya di halaman yang sama.
 *
 * Kolom "Persediaan (L)" EasyMax (= Awal + Penerimaan) sengaja TIDAK dirender —
 * keputusan owner; secara informasi ia memang redundan.
 */
import type { DailyGlRow, ZeroClosingRow } from "./queries";
import { GL_ARTEFACT_MIN_L, glSuspectReason, normalizeProductIdentity, usableGl, type GlSuspect } from "./derive";

/**
 * Ambang "teori mengatakan tangki mestinya berisi" untuk penanda penutup-nol
 * kelas 1 (lihat ZeroFlag). Nilainya menyamai `prev > 1000` pada aturan tertala
 * `getZeroClosingEvents`, dengan alasan yang sama: di bawah itu, "0" adalah
 * pembacaan yang masuk akal untuk tangki yang memang hampir kering. Ambang yang
 * sama dipakai heuristik penahanan G/L artefak (GL_ARTEFACT_MIN_L) agar penanda &
 * penahanan sejalan — ambang deteksi, bukan toleransi stok yang terukur.
 */
export const ZERO_CLOSING_TEORI_MIN_L = GL_ARTEFACT_MIN_L;

/**
 * Penanda penutup-nol. Losses tetap ≡ `gl` panel Gain/Losses; untuk artefak
 * keduanya "—" (lihat ArusRow.artefak), stok mentahnya tetap tampil.
 *
 * - **kelas 2** = detektor tertala `getZeroClosingEvents` (op=0 ∧ prev>1.000 ∧
 *   next>1.000 ∧ ΣDO hari-berikutnya < next). Inilah yang BERBAHAYA: pada hari
 *   yang sudah selesai ia bisa mengenai SEBAGIAN tangki saja, sehingga angkanya
 *   tidak nol melainkan hanya kurang ±10.000 L, dan `provisional` = FALSE —
 *   tampil final dan meyakinkan. (28 Oktober 22 Jul 2026: T-05 Pertamax.)
 * - **kelas 1** = penutup 0 pada hari yang BELUM punya jangkar hari-berikutnya,
 *   jadi aturan tertala itu belum bisa menyala. Dikenali dari `fisik = 0`
 *   sementara Teori > ZERO_CLOSING_TEORI_MIN_L: teori mengatakan tangki mestinya
 *   berisi ribuan liter. Syarat "Teori > x" penting — tangki yang memang terjual
 *   habis punya Teori ≈ 0 juga, jadi ia TIDAK ikut tertandai.
 */
export interface ZeroFlag {
  kelas: 1 | 2;
  /** Tangki yang penutupnya 0 (hanya terisi untuk kelas 2). */
  tangki: string[];
}

export interface ArusRow {
  ckdbbm: string | null;
  nama: string;
  /** Stock Fisik hari-bisnis sebelumnya. null = anchor tak ada. */
  awal: number | null;
  penerimaan: number;
  /** Jual KOTOR − tera RESMI (yang ditampilkan di kolom Penjualan). */
  penjualan: number;
  /** Tera RESMI (L). Dibawa karena % memakai penyebut KOTOR = penjualan + tera. */
  tera: number;
  /** Awal + Penerimaan − Penjualan. null bila anchor/identitas/mutasi tidak lengkap. */
  teori: number | null;
  fisik: number | null;
  /** G/L kanonik (+ gain, − loss). null bila stok/mutasi tak lengkap. */
  losses: number | null;
  /** Losses ÷ penjualan **KOTOR** × 100. null = tak terdefinisi (lihat lossPct). */
  pct: number | null;
  /** Penutup-nol terdeteksi → angkanya artefak input, BUKAN kerugian. */
  zeroClosing: ZeroFlag | null;
  /** Vonis artefak input baris ini: Losses & % ditahan ("—"), tak ikut TOTAL. */
  artefak: GlSuspect | null;
  /** Fisik − Teori mentah untuk audit, hanya bila `artefak` (bukan kerugian). */
  glMentah: number | null;
}

export interface ArusMinyak {
  rows: ArusRow[];
  total: ArusRow;
  /** Ada baris yang G/L-nya belum final (opname penutup belum ada / ada celah). */
  provisional: boolean;
  /** Σ penutup dengan stok/identitas tidak valid; Stock Fisik produk tak lengkap. */
  excludedTanks: number;
  /** Ada stok/G/L tak terhitung → jangan sajikan subtotal losses sebagai total. */
  incomplete: boolean;
  /** Σ tera hari itu (L). >0 → TOTAL Penjualan sengaja ≠ Σ kolom; catatan kaki wajib. */
  teraTotal: number;
  /** Jumlah baris produk ber-penanda penutup-nol (0 = penanda PADAM). */
  zeroClosingCount: number;
  /** Jumlah baris produk ber-vonis artefak input (G/L ditahan). */
  artefakCount: number;
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
 * Losses sebagai % penjualan **KOTOR** (bukan kolom Penjualan yang tampil).
 *
 * Penyebutnya penjualan, bukan Persediaan — terbukti 4 Agu P. Turbo
 * 7,72/64,69 = 11,93 % dan 6 Agu Pertamina Dex 184,69 % (mustahil bila
 * penyebutnya Persediaan). Bahwa penyebut itu KOTOR baru bisa dibuktikan pada
 * hari ber-tera besar: 21 Nov 2025 Dexlite 162,35/11.142,88 = **1,46** persis
 * oracle, sedangkan penyebut bersih memberi 1,60. Pada 2 Agu 2026 (tera 0,64 L)
 * kedua penyebut sama-sama membulat ke −1,30 — itulah sebabnya jendela Agustus
 * meloloskan rumus yang salah.
 *
 * Penjualan kotor = 0: oracle hanya pernah memperlihatkan kasus ini dengan
 * Losses = 0 juga (baris Premium) dan mencetak 0,00 → itu yang ditiru. Untuk
 * penyebut 0 **dengan** Losses ≠ 0 oracle TIDAK memberi bukti, dan "0,00" di
 * sana menyatakan "tidak ada losses" padahal ada → null ("—").
 */
export function lossPct(lossesL: number | null, penjualanKotor: number): number | null {
  if (lossesL === null) return null;
  if (penjualanKotor === 0) return lossesL === 0 ? 0 : null;
  return (lossesL / penjualanKotor) * 100;
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
export function buildArusMinyak(
  glRows: DailyGlRow[],
  /** Kejadian penutup-nol untuk (unit, tanggal) ini — dari getZeroClosingEvents. */
  zeroClosing: ZeroClosingRow[] = [],
): ArusMinyak {
  // Query output normally contains a trimmed string. Defend the rendering
  // boundary too: legacy/runtime rows can still carry SQL NULL or whitespace.
  const zcByProduk = new Map<string, string[]>();
  let unidentifiedZeroClosing = false;
  for (const z of zeroClosing) {
    const k = normalizeProductIdentity(z.ckdbbm);
    if (!k) {
      // An unassigned tank cannot safely be attributed to any known product.
      unidentifiedZeroClosing = true;
      continue;
    }
    zcByProduk.set(k, [...(zcByProduk.get(k) ?? []), z.ckdtangki]);
  }
  const rows: ArusRow[] = glRows.map((r) => {
    const code = normalizeProductIdentity(r.ckdbbm);
    const penjualan = r.sales_gross - r.tera;
    // Movement sums remain diagnostic when the query rejected any input.
    // An explicit false also prevents an older cached row with no quality
    // metadata from reviving theory. Missing current physical stock alone
    // does not invalidate a complete anchor + movement calculation.
    const teori = code && r.movement_invalid === false
      ? stockTeori(r.fisik_prev, r.pen_do, penjualan) : null;
    // Query juga memeriksa cakupan tangki dan mutasi NULL/garbage. Menghitung
    // ulang hanya dari komponen numerik akan menghidupkan lagi G/L yang ditolak.
    // Artefak input ditahan di sini juga, sama dengan panel Gain/Losses.
    const l = code ? usableGl(r) : null;
    const artefak = code ? glSuspectReason(r) : null;
    // A guard-excluded closing leaves only a partial tank sum, not product Fisik
    // (the query reports null). Never let a structural row total it as complete.
    const fisik = r.excluded_tanks === 0 ? r.fisik : null;
    return {
      ckdbbm: code,
      // A familiar name does not recover a missing identity. Keep the source
      // quantities diagnostic, but never label this as a verified known fuel.
      nama: code ? r.nama?.trim() || code : "Produk tidak diketahui",
      awal: r.fisik_prev,
      penerimaan: r.pen_do,
      penjualan,
      tera: r.tera,
      teori,
      fisik,
      losses: l,
      pct: lossPct(l, r.sales_gross), // penyebut KOTOR
      zeroClosing: flagPenutupNol(code ? zcByProduk.get(code) : undefined, fisik, teori),
      artefak,
      glMentah: artefak ? r.gl_raw ?? r.gl : null,
    };
  });

  // TOTAL — mengikuti EasyMax sel per sel (lihat KONVENSI TERA di atas):
  //   Awal/Penerimaan/Teori/Fisik/Losses = penjumlahan kolom yang tercetak;
  //   Penjualan             = Σ jual KOTOR  (SENGAJA ≠ Σ kolom di hari ber-tera);
  //   %                     = ΣLosses ÷ Σ jual KOTOR.
  // % TOTAL BUKAN rata-rata persen — terbukti 1 Agu: −2.441,70/54.079,83 = −4,51
  // sedangkan rata-rata ketujuh persen = −7,49.
  const nz = (xs: (number | null)[]): number =>
    xs.reduce<number>((acc, x) => acc + (x ?? 0), 0);
  const totalKnown = (f: (r: ArusRow) => number | null): number | null =>
    rows.length === 0 || unidentifiedZeroClosing || rows.some((r) => r.ckdbbm === null || f(r) === null)
      ? null : nz(rows.map(f));
  const totPenjualanKotor = nz(rows.map((r) => r.penjualan + r.tera));
  const totFisik = totalKnown((r) => r.fisik);
  const totTeori = totalKnown((r) => r.teori);
  const totLosses = unidentifiedZeroClosing ? null : totalKnown((r) => r.losses);
  const total: ArusRow = {
    ckdbbm: "",
    nama: "TOTAL",
    zeroClosing: null,
    artefak: null,
    glMentah: null,
    awal: totalKnown((r) => r.awal),
    penerimaan: nz(rows.map((r) => r.penerimaan)),
    penjualan: totPenjualanKotor,
    tera: nz(rows.map((r) => r.tera)),
    teori: totTeori,
    fisik: totFisik,
    losses: totLosses,
    pct: lossPct(totLosses, totPenjualanKotor),
  };

  return {
    rows,
    total,
    provisional: rows.length === 0 || unidentifiedZeroClosing || glRows.some((r) => r.provisional)
      || rows.some((r) => r.teori === null || r.losses === null),
    excludedTanks: glRows.reduce((s, r) => s + r.excluded_tanks, 0),
    incomplete: rows.length === 0 || unidentifiedZeroClosing
      || rows.some((r) => r.awal === null || r.teori === null || r.fisik === null || r.losses === null),
    teraTotal: total.tera,
    zeroClosingCount: rows.filter((r) => r.zeroClosing !== null).length,
    artefakCount: rows.filter((r) => r.artefak !== null).length,
  };
}

/** Label penanda baris (layar & PDF): penutup-nol dulu, lalu artefak lain. */
export function arusTag(r: ArusRow): "opname 0" | "perlu periksa" | null {
  return r.zeroClosing ? "opname 0" : r.artefak ? "perlu periksa" : null;
}

/**
 * Peringatan bersama layar & PDF. Menyebut angka mentah (audit) tanpa pernah
 * menyebutnya losses. Baris ber-peringatan penutup-nol lama yang G/L-nya tak
 * ditahan menampilkan hasil ukur kanonis (sama dengan panel Gain/Losses) —
 * berapa pun besarnya: tangki yang kosong sah lalu diisi bisa memicu peringatan
 * itu dengan surplus tercatat yang besar.
 */
export function arusArtefakNote(a: ArusMinyak, liter: (v: number | null) => string): string | null {
  const tagged = a.rows.filter((r) => arusTag(r) !== null);
  if (tagged.length === 0) return null;
  const held = tagged.filter((r) => r.artefak !== null);
  const shown = tagged.filter((r) => r.artefak === null && r.losses !== null);
  return `PERINGATAN — ${tagged.length} produk bertanda [opname 0]/[perlu periksa]: data sumber perlu diperiksa ` +
    "(penutup opname 0 padahal tangki mestinya berisi, atau stok teori di bawah −1.000 L — ambang heuristik). " +
    (held.length > 0
      ? "Losses & % baris artefak tidak dihitung (“—”) dan tidak masuk TOTAL maupun panel Gain/Losses — BUKAN kerugian. " +
        `Angka mentah Stock Fisik − Stock Teori (audit): ${held.map((r) => `${r.nama} ${liter(r.glMentah)} L`).join("; ")}. `
      : "") +
    (shown.length > 0
      ? "Pada baris [opname 0] yang Losses-nya tetap tampil, angka itu hasil ukur kanonis dan sama dengan panel Gain/Losses; " +
        "peringatan penutup-nol saja tidak membuktikan kerugian maupun saldo yang tidak sah. "
      : "") +
    "Periksa opname dan penerimaan pada hari terkait beserta penutup sebelumnya; ralat di EasyMax bila ditemukan kesalahan, lalu muat ulang.";
}

/** kelas 2 menang atas kelas 1 (detektor tertala lebih informatif). */
function flagPenutupNol(
  tangki: string[] | undefined,
  fisik: number | null,
  teori: number | null,
): ZeroFlag | null {
  if (tangki && tangki.length > 0) return { kelas: 2, tangki };
  if (fisik === 0 && teori !== null && teori > ZERO_CLOSING_TEORI_MIN_L)
    return { kelas: 1, tangki: [] };
  return null;
}
