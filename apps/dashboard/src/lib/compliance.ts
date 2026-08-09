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

/**
 * Target shift per hari bisnis. SATU sumber — dipakai `salesStatus` (apakah
 * penjualan lengkap) DAN `adminStatus` (apakah H sudah layak dibandingkan
 * dengan I). Menyatukannya disengaja: "H sudah dirakit penuh" dan "penjualan
 * lengkap" adalah pertanyaan yang SAMA, jadi tak boleh punya dua ambang.
 */
export const SHIFT_TARGET = 3;

/** Penjualan: target 3 shift/hari. 3+ 🟢, 1–2 🟡, 0 🔴. */
export function salesStatus(shifts: number): Status {
  if (shifts >= SHIFT_TARGET) return "green";
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
  | "setoran_tersalin" // I identik dengan I hari sebelumnya DAN tak selaras dengan H
  | "setoran_kosong" // hari ber-atestasi & ada penjualan, tapi setoran nihil
  | "belum_diisi" // lewat jatuh tempo, nol baris di ketiga seksi
  | "hari_berjalan" // tanggal HARI INI — H masih dirakit, tak dinilai sama sekali
  | "tak_terhitung" // hari LAMPAU yang shift-nya tak pernah masuk (agent gagal)
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
  /**
   * Σ setoran hari SEBELUMNYA (D−1) untuk unit yang SAMA; null bila hari itu
   * tak punya baris setoran ATAU berada di luar jendela yang diambil pemanggil.
   *
   * WAJIB, bukan opsional — pemanggil yang lupa menyediakannya harus gagal
   * type-check, bukan diam-diam mematikan aturan salin-setoran. Preseden yang
   * sama dengan `RincianKonteks`: memberi default akan mengubah bug menjadi
   * "aturannya kok tak pernah menyala" yang tak terlihat siapa pun.
   */
  iSebelumnya: number | null;
  /** Jumlah shift penjualan ter-ingest. 0 = data penjualan belum masuk. */
  shifts: number;
}

/** Selaras bila |I − H| ≤ toleransi; kelebihan setor kuning, kekurangan merah. */
export function setoranStatus(h: number, i: number): AdminKode {
  const delta = i - h;
  if (Math.abs(delta) <= SETORAN_TOLERANSI_RP) return "selaras";
  return delta > 0 ? "lebih_setor" : "kurang_setor";
}

/**
 * Pasangkan tiap hari dengan Σ setoran hari SEBELUMNYA — bahan `iSebelumnya`.
 *
 * ⚠️ PRASYARAT: `menaik` harus RAPAT dan MENAIK untuk SATU unit. Kedua query
 * pemasoknya (`getComplianceMatrix`, `getAdminDays`) memakai `generate_series`,
 * jadi hari tanpa data tetap hadir sebagai baris nol — tanpa itu "sebelumnya"
 * akan berarti "baris sebelumnya", yang bisa saja seminggu lalu.
 *
 * Ada di sini, bukan di dalam halaman, supaya lolosnya tes adalah jaminan atas
 * JALUR PRODUKSI dan bukan atas salinan logika — dan supaya salah-geser satu
 * indeks (`asc[j+1]`) tertangkap tes, bukan tertangkap pengawas.
 *
 * Elemen PERTAMA selalu ber-`iSebelumnya: null`. Pemanggil yang ingin sel
 * terawalnya ikut diperiksa harus mengambil satu hari EKSTRA sebagai benih lalu
 * membuang elemen pertama dari tampilan.
 */
export function pasangkanSetoranKemarin<T extends { setoran: number | null }>(
  menaik: T[],
): { hari: T; iSebelumnya: number | null }[] {
  return menaik.map((hari, j) => ({
    hari,
    iSebelumnya: j === 0 ? null : (menaik[j - 1]?.setoran ?? null),
  }));
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

  // ── HARI BERJALAN: JANGAN NILAI I-vs-H SAMA SEKALI (owner, 2026-08-08) ──
  //
  // Owner MENINJAU ULANG keputusannya sendiri dari 2026-08-07. Waktu itu ia
  // memilih gerbang `shifts >= SHIFT_TARGET` dan MENOLAK "jangan nilai hari ini"
  // — tanpa tahu C/D masih tumbuh SETELAH shift tutup. Sekarang ada buktinya,
  // dari DUA pengamat terpisah pada jendela berbeda:
  //
  //   Korek 2026-08-07, 3 dari 3 shift, A TIDAK bergerak sama sekali:
  //     09:55  H = 355.569.871,50
  //     10:13  H = 332.052.949,50     ← turun 23.516.922 dalam 18 MENIT
  //   Seluruhnya dari pertumbuhan C+D (pelanggan_sale/voucher_sale/edc punya
  //   watermark sendiri, tak menunggu shift tutup).
  //
  // Biayanya nyaris nol: jatuh tempo memang akhir H+1, jadi hari kemarin dan
  // sebelumnya TETAP dinilai seketika — dan itu kasus yang berguna.
  if (dayGap(opts.businessDate, opts.today) === 0) {
    return { kode: "hari_berjalan", tone: "pending", terisi };
  }

  // H MASIH DIRAKIT → sumbu I-vs-H belum bermakna.
  //
  // ⚠️ APA YANG GERBANG INI JAGA SEKARANG (didokumentasikan ulang 2026-08-08).
  // Sejak gerbang HARI BERJALAN di atas dipasang, gerbang ini TIDAK lagi menjaga
  // "hari ini yang datanya belum lengkap" — itu sudah ditangani lebih awal.
  // Yang ia jaga kini adalah kasus BERBEDA dan tetap nyata:
  //
  //   HARI LAMPAU yang shift-nya TAK PERNAH MASUK — agent mati, sync gagal,
  //   atau ingest tersendat. H hari itu dirakit dari data yang tak akan pernah
  //   lengkap, dan membandingkannya dengan setoran akan menuduh pengawas atas
  //   kegagalan PIPELINE.
  //
  // JANGAN HAPUS sebagai peninggalan. Gerbang yang dipertahankan tanpa alasan
  // tertulis akan dihapus orang berikutnya — itu sebabnya alasannya ditulis di
  // sini, bukan di catatan sesi.
  //
  // Riwayat: diperluas 2026-08-07 dari `shifts <= 0` menjadi `shifts < SHIFT_TARGET`.
  // Versi pertama hanya menutup KASUS (nol shift), bukan KELASNYA ("H masih
  // dirakit"). Buktinya muncul di papan HIDUP beberapa jam kemudian: Korek
  // 2026-08-07 pukul 22:15 dengan 2 dari 3 shift menampilkan
  // "⚠ Setoran MELEBIHI uang tunai Rp 89.189.622" — penyebabnya IDENTIK dengan
  // artefak Rp 355,9 juta pukul 13:46, hanya lebih kecil karena lebih banyak
  // data sudah masuk. Begitu shift pertama tutup, hari itu dinilai seolah lengkap.
  //
  // Ini BUKAN pengecualian terhadap "hari yang sudah diisi dinilai SEKETIKA" —
  // itu tetap utuh untuk hari yang datanya memang lengkap. Ini PRASYARAT agar
  // aturan itu bisa bermakna: membandingkan setoran dengan H yang belum selesai
  // dirakit adalah membandingkan dengan angka yang belum ada.
  //
  // Sinyal "penjualan belum lengkap" TIDAK hilang: `salesStatus` tetap kuning
  // untuk 1–2 shift dan sel agregatnya tetap memperlihatkannya.
  if (d.shifts < SHIFT_TARGET) return { kode: "tak_terhitung", tone: "pending", terisi: true };

  if (d.i === null) {
    return belumTempo
      ? { kode: "belum_tempo_terisi", tone: "pending", terisi: true }
      : { kode: "setoran_kosong", tone: "red", terisi: true };
  }

  const kode = setoranStatus(d.h, d.i);

  // ── SALIN-SETORAN: angka kemarin diketik ulang untuk hari ini ────────────
  //
  // Menyala hanya bila TIGA hal benar bersamaan:
  //   (a) I(D) == I(D−1) PERSIS      ← di sini
  //   (b) D bukan hari ini            ← dijamin gerbang `hari_berjalan` di ATAS
  //   (c) |I − H| > toleransi         ← yaitu `kode !== "selaras"`
  //
  // ⚠️ (b) DIPIKUL OLEH URUTAN, bukan oleh kondisi di baris ini. Memindahkan
  // blok ini ke atas gerbang `hari_berjalan` akan menyalakannya pada hari yang
  // H-nya masih dirakit — persis artefak yang gerbang itu ada untuk mencegah.
  // Kalau blok ini pindah, syarat (b) harus ditulis eksplisit.
  //
  // Kenapa (c): dua hari yang setorannya kebetulan sama TAPI dua-duanya selaras
  // dengan H-nya masing-masing bukan kesalahan — itu kebetulan yang sah, dan
  // menandainya akan melatih orang mengabaikan aturannya. Kesalahannya adalah
  // angka yang sama DAN tak cocok dengan uang tunai hari itu.
  //
  // KASUS ASAL (Korek 2026-08-07, ditemukan owner): setoran Rp 359.447.000
  // diketik untuk 08-07, dan angka yang sama untuk 08-06. Yang 08-07 meleset
  // Rp 3.877.128,50 dari H. Pengawas mengoreksinya sendiri 08-08 pukul 10:11.
  //
  // MERAH, bukan kuning — bahkan ketika arah selisihnya "lebih setor" (yang
  // sendirian hanya kuning). Kelebihan setor bisa punya sebab sah; angka yang
  // identik dengan kemarin DAN tak cocok dengan H adalah kekeliruan ENTRI, dan
  // yang ditandai di sini adalah SEBABNYA, bukan arah selisihnya.
  //
  // 🔴 BUTA SATU ARAH — DIKETAHUI 2026-08-09, PERBAIKAN MENUNGGU GERBANG OWNER.
  //
  // Aturan ini hanya membandingkan `I(D)` dengan `I(D−1)`. Pada kejadian nyata
  // (Batu Layang 08-07/08-08) yang tersalin adalah nilai hari BERIKUTNYA, dan
  // aturan ini TIDAK MELIHATNYA. Pemindaian ulang tanpa arah, 2026-06-01…08-08,
  // 7 unit, 102 pasangan: 1 pasangan identik, **0 tertangkap aturan ini**,
  // 1 terlewat. Nol dari satu.
  //
  // Klaim "SUNYI · 10,19 jam-alarm · 0 dari 14 pasangan" yang sempat ada di sini
  // DICABUT: angkanya benar, pertanyaannya yang lebih sempit dari fenomenanya.
  //
  // ⚠️ JANGAN membaca papan yang tenang sebagai bukti tak ada salinan, dan
  // jangan memperluas aturan ini sepotong-sepotong — perbaikannya tiga hal
  // sekaligus (dua arah · F & G ikut · kapan vonis dihitung), rinci di
  // KETAATAN-ADMINISTRASI.md §3b.
  if (kode !== "selaras" && d.i === d.iSebelumnya) {
    return { kode: "setoran_tersalin", tone: "red", terisi: true };
  }

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
