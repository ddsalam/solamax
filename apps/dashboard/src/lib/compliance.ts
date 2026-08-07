/**
 * Logika kepatuhan input — murni & teruji. Inti alat pengawasan:
 * MENYOROT YANG KOSONG, bukan sekadar menampilkan yang ada.
 */

export type Status = "green" | "yellow" | "red";

export const STATUS_ICON: Record<Status, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

/** Penjualan: target 3 shift/hari. 3+ 🟢, 1–2 🟡, 0 🔴. */
export function salesStatus(shifts: number): Status {
  if (shifts >= 3) return "green";
  if (shifts >= 1) return "yellow";
  return "red";
}

/** Opname: target semua tangki. Semua 🟢, sebagian 🟡, nol 🔴. */
export function opnameStatus(tanks: number, totalTanks: number): Status {
  if (tanks <= 0) return "red";
  if (totalTanks > 0 && tanks < totalTanks) return "yellow";
  return "green";
}

// ===========================================================================
// Ketaatan ADMINISTRASI — pengisian Rincian Penjualan oleh pengawas
// (Pendapatan Lain / Pengeluaran / Setoran Bank). Menggantikan indikator
// "modul kas EasyMax dorman", yang dihapus 2026-08-07: ketujuh unit terbukti
// nol nota dalam 30 hari terakhir, jadi ia adalah alarm merah permanen yang
// tak pernah bisa diselesaikan — dan alarm begitu melatih orang mengabaikannya.
// ===========================================================================

/**
 * Toleransi selaras setoran (rupiah). BUKAN angka gaya — ini kuantum slip
 * setoran bank, diturunkan dari data pilot (2026-08-07, n=95 hari ber-setoran):
 *   · 95 dari 95 nilai setoran adalah kelipatan PERSIS Rp 1.000
 *   · 0 dari 95 sama persis dengan H (H selalu berpecahan, mis. …426,50)
 * Kesamaan eksak karenanya mustahil secara aritmetika; membandingkan `i === h`
 * akan memerahkan 100% hari. 82 dari 95 hari jatuh di dalam ±Rp 1.000.
 */
export const SETORAN_TOLERANSI_RP = 1000;

export type AdminKode =
  | "config_hilang" // unit tak terdaftar di ADOPSI_RINCIAN → indikator tak bisa dipercaya
  | "belum_adopsi" // unit terdaftar tapi belum memakai panel Rincian sama sekali
  | "pra_adopsi" // hari mendahului lantai adopsi unit — bukan kelalaian
  | "selaras" // I ≈ H dalam toleransi
  | "lebih_setor" // I − H > toleransi
  | "kurang_setor" // H − I > toleransi
  | "setoran_kosong" // hari ber-atestasi & ada penjualan, tapi setoran nihil
  | "belum_diisi" // lewat jatuh tempo, nol baris di ketiga seksi
  | "tak_terhitung" // penjualan belum ter-ingest → H tak bermakna
  | "belum_tempo_terisi" // belum jatuh tempo, sudah diisi
  | "belum_tempo_kosong"; // belum jatuh tempo, belum diisi

export interface AdminVerdict {
  kode: AdminKode;
  /** "pending" = netral: belum jatuh tempo atau tak bisa dinilai. */
  tone: Status | "pending";
  /** Pengawas sudah menyentuh hari ini (≥1 baris di seksi mana pun). */
  terisi: boolean;
}

export interface AdminHari {
  /**
   * Lantai adopsi unit dari `adopsiRincian(code)`. TIGA nilai yang BERBEDA:
   *   string    → nilai hari sejak tanggal ini
   *   null      → terdaftar, belum pernah memakai panel  → `belum_adopsi`
   *   undefined → TIDAK terdaftar di config              → `config_hilang` (MERAH)
   * Sengaja tanpa default: `undefined` harus gagal nyaring, bukan diam.
   */
  adopsi: string | null | undefined;
  nPendapatanLain: number;
  nPengeluaran: number;
  nSetoran: number;
  /** H dari `uangTunai()` di lib/rekon.ts — JANGAN hitung ulang di sini. */
  h: number;
  /** Σ setoran; null bila tak ada baris setoran. */
  i: number | null;
  /** Jumlah shift penjualan ter-ingest. 0 = data penjualan belum masuk. */
  shifts: number;
}

/** Selaras bila |I − H| ≤ toleransi; kelebihan setor kuning, kekurangan merah. */
export function setoranStatus(h: number, i: number): AdminKode {
  const delta = i - h;
  if (Math.abs(delta) <= SETORAN_TOLERANSI_RP) return "selaras";
  return delta > 0 ? "lebih_setor" : "kurang_setor";
}

/** Selisih hari kalender antara dua tanggal ISO (b − a). */
function dayGap(a: string, b: string): number {
  const t0 = Date.parse(`${a}T00:00:00Z`);
  const t1 = Date.parse(`${b}T00:00:00Z`);
  return Math.round((t1 - t0) / 86_400_000);
}

/**
 * Status ketaatan administrasi satu unit-hari.
 *
 * JATUH TEMPO = akhir D+1 (keputusan owner 2026-08-07, dari data: median entri
 * masuk +9,3 jam setelah tutup hari; 80 dari 96 sebelum akhir D+1). Konsekuensi
 * yang disengaja: DUA kolom terkanan heatmap tak pernah merah — tapi tetap
 * membedakan "sudah diisi" dari "belum", supaya sinyal real-time tak hilang.
 *
 * ⚠️ BATAS YANG DIKETAHUI — atestasi per-hari. Hari dengan ≥1 baris di seksi
 * mana pun dianggap "pengawas sudah mengisi", sehingga seksi yang kosong di hari
 * itu dibaca NIHIL, bukan terlewat. `app.manual_entry` memang tak bisa
 * membedakan keduanya (dua-duanya nol baris). Ukuran lubangnya pada data pilot
 * (2026-08-07, 97 hari ber-atestasi, hari berjalan dibuang): 5 hari parsial
 * (5,2%), yang satu kehilangan SETORAN sehingga tetap tertangkap merah oleh
 * aturan wajib-setoran di bawah → blind spot sejati = 4 hari = **4,1%** yang
 * akan dinilai patuh padahal seksi F/G-nya mungkin terlewat, bukan nihil.
 * Menutupnya butuh tombol "Nyatakan NIHIL" + migrasi (ditunda, keputusan owner).
 */
export function adminStatus(
  d: AdminHari,
  opts: { businessDate: string; today: string },
): AdminVerdict {
  const terisi = d.nPendapatanLain + d.nPengeluaran + d.nSetoran > 0;
  const belumTempo = dayGap(opts.businessDate, opts.today) <= 1;

  // --- LANTAI ADOPSI (2026-08-07) -----------------------------------------
  // Didahulukan dari SEMUA cabang lain: sebelum unit memakai panel Rincian,
  // "belum diisi" bukan pernyataan tentang pengawas. Terukur di papan pilot
  // live: 39 dari 47 sel merah mendahului entri manual pertama unitnya.
  //
  // Ketiga cabang di bawah SENGAJA tak ada yang "diam":
  //   · config_hilang → MERAH. Unit tak terdaftar = lantainya tak diketahui =
  //     indikator tak bisa dipercaya untuk unit itu. "Netral" atau "hijau" akan
  //     BERBOHONG, dan bohongnya tak terlihat sampai ada yang curiga.
  //   · belum_adopsi  → KUNING, dan tetap kuning tiap hari sampai unit memakai
  //     panel. Berbeda dari alarm kas lama yang tak bisa diselesaikan: ini
  //     PUNYA jalan keluar (mulai pakai panelnya).
  //   · pra_adopsi    → netral BERNAMA + berpenjelasan, bukan sel kosong diam.
  if (d.adopsi === undefined) {
    return { kode: "config_hilang", tone: "red", terisi };
  }
  if (d.adopsi === null) {
    return { kode: "belum_adopsi", tone: "yellow", terisi };
  }
  // `<` bukan `<=`: HARI ADOPSI ITU SENDIRI SUDAH DINILAI. Itu keputusan yang
  // ditimbang, bukan kebetulan — alasan kedua sisinya ada di ADOPSI_RINCIAN
  // (lib/config.ts). Kasus nyata yang terkena: IB 2026-06-21.
  if (opts.businessDate < d.adopsi) {
    return { kode: "pra_adopsi", tone: "pending", terisi };
  }

  if (!terisi) {
    return belumTempo
      ? { kode: "belum_tempo_kosong", tone: "pending", terisi: false }
      : { kode: "belum_diisi", tone: "red", terisi: false };
  }

  // Penjualan belum ter-ingest → H = F − G, angka yang tak berarti apa-apa.
  // Kasus nyata: Korek 2026-08-07 (shifts=0) menghasilkan I − H = +Rp 355,9 juta
  // yang MURNI artefak, bukan temuan. Jangan pernah dinilai pada sumbu I vs H;
  // ketidakhadiran penjualannya sudah disuarakan `salesStatus` di sel yang sama.
  if (d.shifts <= 0) return { kode: "tak_terhitung", tone: "pending", terisi: true };

  if (d.i === null) {
    return belumTempo
      ? { kode: "belum_tempo_terisi", tone: "pending", terisi: true }
      : { kode: "setoran_kosong", tone: "red", terisi: true };
  }

  const kode = setoranStatus(d.h, d.i);
  const tone: Status = kode === "selaras" ? "green" : kode === "lebih_setor" ? "yellow" : "red";
  return { kode, tone, terisi: true };
}

/**
 * Ambang stale "last input" per modul (jam).
 *
 * ⚠️ Saat ini TIDAK dipakai kode produksi mana pun (hanya compliance.test.ts) —
 * terverifikasi grep 2026-08-07 saat entri `cash` dihapus. Dipertahankan karena
 * `staleness()` masih berguna, tapi jangan anggap ia sedang menjaga sesuatu.
 */
export const STALE_HOURS = {
  sales: 26, // tiap shift; >1 hari = ada yang tak diinput
  opname: 26,
  delivery: 30 * 24, // info: kiriman tak tentu; merah hanya bila lama sekali
} as const;

export interface Staleness {
  stale: boolean;
  ageHours: number | null; // null = belum pernah input
  ageText: string;
}

export function staleness(
  lastIso: string | null,
  thresholdHours: number,
  now: Date = new Date(),
): Staleness {
  if (!lastIso) return { stale: true, ageHours: null, ageText: "belum pernah" };
  const last = new Date(lastIso.length === 10 ? `${lastIso}T23:59:59+07:00` : lastIso);
  const ageHours = (now.getTime() - last.getTime()) / 3_600_000;
  return { stale: ageHours > thresholdHours, ageHours, ageText: ageText(ageHours) };
}

export function ageText(hours: number): string {
  if (hours < 1) return "baru saja";
  if (hours < 48) return `${Math.floor(hours)} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} hari lalu`;
  const years = days / 365;
  if (years >= 1) return `${years.toFixed(1)} TAHUN lalu`;
  return `${Math.floor(days / 30)} bulan lalu`;
}

/**
 * Selisih abnormal (losses / kekurangan kiriman):
 * abnormal bila |selisih| > ABS_LIMIT liter, ATAU > PCT_LIMIT dari basis
 * (stok buku / volume DO) bila basis tersedia.
 */
export const SELISIH_ABS_LIMIT = 100; // liter
export const SELISIH_PCT_LIMIT = 0.005; // 0,5%

export function isSelisihAbnormal(
  selisih: number,
  basis: number | null,
): boolean {
  const abs = Math.abs(selisih);
  if (abs > SELISIH_ABS_LIMIT) return true;
  if (basis !== null && basis > 0 && abs / basis > SELISIH_PCT_LIMIT) return true;
  return false;
}

export const fmtL = (n: number): string =>
  `${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })} L`;

export const fmtRp = (n: number): string =>
  `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
