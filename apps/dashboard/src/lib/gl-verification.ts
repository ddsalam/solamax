/**
 * G/L "Belum terverifikasi" — SATU model rincian & panduan verifikasi untuk
 * laporan operasional, laporan harian (direksi), board, dan ketiga PDF-nya.
 *
 * Kebijakan owner (disetujui 2026-10-06 17:13 UTC): G/L yang tidak bisa
 * dipastikan dari sumber diberi label persis "Belum terverifikasi"; total,
 * persen, dan alarm yang bergantung padanya ditahan. Hitungan mentah boleh
 * tampil HANYA sebagai audit berlabel belum terverifikasi — bukan fakta
 * keuangan, bukan klaim kerugian, dan juga bukan klaim "bukan kerugian". Model
 * ini tidak menghitung G/L baru: ia hanya menamai baris yang SUDAH ditolak
 * `usableGl` dan membawa angka sumber yang sudah ada di baris itu — ditambah
 * satu kasus tanpa baris: produk dikenal yang terjual pada tanggal yang tak
 * punya baris G/L sama sekali (`collectGlMissing`, R1). Untuk kasus itu yang
 * disebut hanya fakta penjualannya; tak ada stok, tangki, atau hitungan mentah.
 *
 * Yang sengaja TIDAK dilakukan:
 * - menyebut baris yang lolos `usableGl` "terverifikasi" (terhitung ≠ tersertifikasi);
 * - mengisi identitas tangki dari peringatan umum unit — tangki hanya dari
 *   metadata penutup baris itu sendiri; bila tak ada → "tidak tersedia";
 * - menganggap nol fisik sebagai salah input, atau volume REAL / hilangnya
 *   penanda sebagai bukti verifikasi.
 */
import { glSuspectReason, normalizeProductIdentity, usableGl, type DailyGlInput } from "./derive";
import { dateShort, num2 } from "./format";

/** Label tunggal (kebijakan owner) — jangan diparafrasekan di konsumen. */
export const GL_UNVERIFIED = "Belum terverifikasi";
export const GL_UNVERIFIED_TITLE = `G/L ${GL_UNVERIFIED}`;

/** Metadata sumber opsional dari getDailyGlByProduct; tak ada di baris lama/struktural. */
export interface GlSourceDetail {
  d: string;
  /** Rumus G/L sebelum penahanan; null = tak terhitung. */
  gl_raw?: number | null;
  /** Kode tangki penutup produk hari itu (null di dalam = kode tangki kosong). */
  tanks?: (string | null)[] | null;
  /** Tangki penutup yang stok/identitasnya ditolak guard. */
  tanks_invalid?: (string | null)[] | null;
  /** Kode tangki penutup pendahulu (Stock Awal). */
  tanks_prev?: (string | null)[] | null;
  /** Tanggal bisnis penutup pendahulu (Stock Awal). */
  prev_date?: string | null;
  /** Stock Teori penutup pendahulu — hanya ada bila pendahulunya penutup 0 yang dinilai. */
  prior_teori?: number | null;
}

export type GlVerifyInput = DailyGlInput & GlSourceDetail;

export type GlUnverifiedReason =
  | "penutup_nol"
  | "jangkar_nol"
  | "produk_tak_dikenal"
  | "tangki_tak_valid"
  | "mutasi_tak_valid"
  | "penutup_tak_ada"
  | "stok_awal_tak_ada"
  | "tangki_berubah"
  | "tak_terhitung";

/** Komponen hitungan mentah dari baris yang sama (bukan angka baru). */
export interface GlRawAudit {
  awal: number;
  /** Penerimaan = volume DO nominal (NVOLDO). */
  penerimaan: number;
  penjualanKotor: number;
  /** Tera resmi. */
  tera: number;
  teori: number;
  fisik: number;
  /** Fisik − Teori dari query (gl_raw). */
  mentah: number;
}

export interface GlUnverifiedItem {
  unit: { code: string; name: string } | null;
  d: string;
  ckdbbm: string | null;
  produk: string;
  reason: GlUnverifiedReason;
  /** Tangki dari penutup baris itu; null = tidak tersedia di sumber. */
  tangki: string[] | null;
  prevDate: string | null;
  priorTeori: number | null;
  audit: GlRawAudit | null;
  /** Volume terjual produk di tanggal itu — hanya untuk penutup_tak_ada (dari data penjualan). */
  terjual?: number;
}

const sameTanks = (a: readonly (string | null)[], b: readonly (string | null)[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Sebab G/L baris ditahan; null = G/L baris ini terhitung (BUKAN berarti
 * terverifikasi). Urutan = sebab paling hulu lebih dulu; vonis pola nol hanya
 * pernah dijatuhkan pada saldo yang terhitung, jadi tak bertabrakan.
 */
export function glUnverifiedReason(r: GlVerifyInput): GlUnverifiedReason | null {
  if (usableGl(r) !== null) return null;
  if (normalizeProductIdentity(r.ckdbbm) === null) return "produk_tak_dikenal";
  if (r.excluded_tanks > 0) return "tangki_tak_valid";
  if (r.movement_invalid === true) return "mutasi_tak_valid";
  const suspect = glSuspectReason(r);
  if (suspect) return suspect;
  // Explicit null only: a row without the field says nothing about Stock Awal.
  if (r.fisik_prev === null) return "stok_awal_tak_ada";
  if (r.tanks && r.tanks_prev && !sameTanks(r.tanks, r.tanks_prev)) return "tangki_berubah";
  return "tak_terhitung";
}

function tankCodes(xs: readonly (string | null)[] | null | undefined): string[] | null {
  if (!xs || xs.length === 0) return null;
  return [...new Set(xs.map((x) => x?.trim() || "tanpa kode tangki"))];
}

function rawAudit(r: GlVerifyInput): GlRawAudit | null {
  const mentah = r.gl_raw !== undefined ? r.gl_raw : r.gl;
  if (mentah == null || !Number.isFinite(mentah) || r.fisik == null || r.fisik_prev == null
    || r.pen_do === undefined || r.sales_gross === undefined
    || r.movement_invalid === true || r.excluded_tanks !== 0) return null;
  return {
    awal: r.fisik_prev,
    penerimaan: r.pen_do,
    penjualanKotor: r.sales_gross,
    tera: r.tera,
    teori: r.fisik_prev + r.pen_do - (r.sales_gross - r.tera),
    fisik: r.fisik,
    mentah,
  };
}

/** Satu baris → item rincian; null bila G/L baris itu terhitung. */
export function glUnverifiedItem(
  r: GlVerifyInput,
  unit: { code: string; name: string } | null = null,
): GlUnverifiedItem | null {
  const reason = glUnverifiedReason(r);
  if (reason === null) return null;
  const code = normalizeProductIdentity(r.ckdbbm);
  const tangki = reason === "tangki_tak_valid" ? tankCodes(r.tanks_invalid) : tankCodes(r.tanks);
  return {
    unit,
    d: r.d,
    ckdbbm: code,
    produk: code === null ? "Produk tidak diketahui" : r.nama?.trim() || code,
    reason,
    tangki,
    prevDate: r.prev_date ?? null,
    priorTeori: r.prior_teori ?? null,
    audit: reason === "penutup_nol" || reason === "jangkar_nol" ? rawAudit(r) : null,
  };
}

/** Semua baris yang G/L-nya ditahan, dalam urutan masukan. */
export function collectGlUnverified(
  rows: readonly GlVerifyInput[],
  unit: { code: string; name: string } | null = null,
): GlUnverifiedItem[] {
  return rows.flatMap((r) => {
    const it = glUnverifiedItem(r, unit);
    return it ? [it] : [];
  });
}

/** Baris penjualan per tanggal/produk yang sudah dimuat pemanggil. */
export interface GlSalesInput {
  d: string;
  ckdbbm: string | null;
  nama?: string | null;
  vol: number;
}

/**
 * R1 — produk DIKENAL yang terjual (vol ≠ 0) pada tanggal yang tidak punya
 * baris G/L sama sekali untuk produk itu (tak ada penutup opname berkode produk
 * itu). Itu persis kondisi yang membuat sel/total G/L pemanggil "—". Tak ada
 * penutup → tangki, stok, dan hitungan mentah tidak diisi. Penjualan tanpa kode
 * produk tidak diturunkan menjadi produk apa pun (sudah "Produk tidak diketahui").
 */
export function collectGlMissing(
  glRows: readonly { d: string; ckdbbm: string | null }[],
  sales: readonly GlSalesInput[],
  unit: { code: string; name: string } | null = null,
): GlUnverifiedItem[] {
  const hasRow = new Set(glRows.flatMap((r) => {
    const code = normalizeProductIdentity(r.ckdbbm);
    return code === null ? [] : [`${r.d}|${code}`];
  }));
  const sold = new Map<string, { d: string; code: string; nama: string | null; vol: number; moved: boolean }>();
  for (const s of sales) {
    const code = normalizeProductIdentity(s.ckdbbm);
    if (code === null || hasRow.has(`${s.d}|${code}`)) continue;
    const k = `${s.d}|${code}`;
    const cur = sold.get(k) ?? { d: s.d, code, nama: s.nama?.trim() || null, vol: 0, moved: false };
    cur.vol += s.vol;
    cur.moved ||= s.vol !== 0;
    sold.set(k, cur);
  }
  return [...sold.values()].filter((s) => s.moved).map((s) => ({
    unit,
    d: s.d,
    ckdbbm: s.code,
    produk: s.nama ?? s.code,
    reason: "penutup_tak_ada" as const,
    tangki: null,
    prevDate: null,
    priorTeori: null,
    audit: null,
    terjual: s.vol,
  }));
}

/** Terbaru dulu, lalu unit & produk — urutan sama di layar dan PDF. */
export function sortGlUnverified(items: GlUnverifiedItem[]): GlUnverifiedItem[] {
  return [...items].sort((a, b) =>
    a.d !== b.d ? (a.d < b.d ? 1 : -1)
      : (a.unit?.name ?? "").localeCompare(b.unit?.name ?? "") || a.produk.localeCompare(b.produk));
}

/** Teks tangki untuk sel tabel. */
export function glTankText(it: GlUnverifiedItem): string {
  return it.tangki ? it.tangki.join(", ") : "tidak tersedia di sumber";
}

/** Sebab spesifik baris, dari angka sumber baris itu saja. */
export function glReasonText(it: GlUnverifiedItem): string {
  const prev = it.prevDate ? dateShort(it.prevDate) : "sebelumnya";
  switch (it.reason) {
    case "penutup_nol":
      return `Penutup opname seluruh tangki produk tercatat 0 L, padahal Stock Teori ${
        it.audit ? `${num2(it.audit.teori)} L` : "di atas 1.000 L"}.`;
    case "jangkar_nol":
      return `Stock Awal 0 L berasal dari penutup ${prev} yang tercatat 0 L, padahal Stock Teori penutup itu ${
        it.priorTeori !== null ? `${num2(it.priorTeori)} L` : "di atas 1.000 L"}.`;
    case "produk_tak_dikenal":
      return "Kode produk kosong pada data opname atau mutasi (DO/penjualan/tera) hari ini.";
    case "tangki_tak_valid":
      return "Stok penutup tangki kosong/di luar batas wajar, atau kode tangki/produknya kosong — Stock Fisik produk tidak lengkap.";
    case "mutasi_tak_valid":
      return `Ada penerimaan DO, penjualan, atau tera sejak penutup ${prev} yang kode produk atau volumenya kosong.`;
    case "penutup_tak_ada":
      return `Terjual ${num2(it.terjual ?? null)} L, tetapi belum ada penutup opname produk ini untuk tanggal itu di data sumber — G/L hari itu tidak dapat dihitung.`;
    case "stok_awal_tak_ada":
      return "Penutup opname sebelumnya (Stock Awal) tidak ada atau tidak valid.";
    case "tangki_berubah":
      return `Susunan tangki penutup berbeda dari penutup ${prev}.`;
    case "tak_terhitung":
      return "Komponen hitungan G/L tidak lengkap.";
  }
}

/** Hitungan mentah berlabel; null bila komponennya tidak tersedia. */
export function glAuditText(a: GlRawAudit | null): string | null {
  if (a === null) return null;
  return `Fisik ${num2(a.fisik)} − Teori ${num2(a.teori)} = ${num2(a.mentah)} L ` +
    `(Teori = Awal ${num2(a.awal)} + DO nominal ${num2(a.penerimaan)} − (jual kotor ${num2(a.penjualanKotor)} − tera resmi ${num2(a.tera)}))`;
}

export const GL_AUDIT_HEADING = `Hitungan mentah — ${GL_UNVERIFIED}`;
export const GL_AUDIT_MISSING = "tidak tersedia (komponen tidak lengkap)";

const RECHECK =
  "Bila bukti menunjukkan salah input, ralat data di EasyMax SPBU, tunggu sinkron ulang, lalu periksa kembali laporan ini.";

/** Langkah verifikasi berbasis bukti per sebab (urutan = urutan kerja). */
export const GL_VERIFY_STEPS: Record<GlUnverifiedReason, { judul: string; langkah: string[] }> = {
  penutup_nol: {
    judul: "Penutup opname 0 L",
    langkah: [
      "Cocokkan penutup opname tangki pada tabel dengan catatan fisik SPBU (dipping/ATG): tangki memang kosong, atau angka belum/salah diinput.",
      "Cocokkan penutup sebelumnya yang menjadi Stock Awal.",
      "Cocokkan penerimaan DO nominal dengan dokumen pengiriman (DO/surat jalan) di hari bisnis yang sama.",
      "Cocokkan penjualan kotor dan tera resmi di hari bisnis yang sama dengan rekap totalisator/shift.",
      RECHECK,
    ],
  },
  jangkar_nol: {
    judul: "Stock Awal dari penutup 0 L",
    langkah: [
      "Cocokkan penutup opname 0 L di tanggal Stock Awal dengan catatan fisik SPBU (dipping/ATG).",
      "Untuk tanggal itu, cocokkan juga penutup sebelumnya, DO nominal beserta dokumen pengirimannya, serta penjualan kotor dan tera resmi.",
      "Cocokkan penutup, DO nominal, penjualan kotor, dan tera resmi di tanggal pada tabel.",
      RECHECK,
    ],
  },
  produk_tak_dikenal: {
    judul: "Kode produk kosong",
    langkah: [
      "Telusuri data opname, penerimaan DO, penjualan, atau tera tanpa kode produk di tanggal itu, lalu tentukan produk yang benar dari dokumen SPBU.",
      RECHECK,
    ],
  },
  tangki_tak_valid: {
    judul: "Stok/identitas tangki tidak valid",
    langkah: [
      "Periksa penutup opname tangki pada tabel: nilai stok kosong, di luar batas wajar, atau kode tangki/produknya kosong. Cocokkan dengan catatan fisik (dipping/ATG).",
      RECHECK,
    ],
  },
  mutasi_tak_valid: {
    judul: "Mutasi tidak lengkap",
    langkah: [
      "Periksa penerimaan DO (dengan dokumen pengiriman), penjualan (totalisator/shift), dan tera resmi sejak penutup sebelumnya: lengkapi kode produk atau volume yang kosong.",
      RECHECK,
    ],
  },
  penutup_tak_ada: {
    judul: "Penutup opname belum ada",
    langkah: [
      "Bila tanggal itu hari bisnis yang masih berjalan, penutup opname memang belum ada: periksa kembali setelah opname penutup tercatat dan tersinkron.",
      "Bila hari bisnis itu sudah ditutup, periksa apakah opname penutup semua tangki produk ini sudah diinput di EasyMax dengan kode produk dan kode tangki yang benar; cocokkan dengan catatan fisik SPBU (dipping/ATG).",
      RECHECK,
    ],
  },
  stok_awal_tak_ada: {
    judul: "Stock Awal tidak tersedia",
    langkah: [
      "Periksa apakah penutup opname hari bisnis sebelumnya untuk produk ini sudah tercatat dan valid; cocokkan dengan catatan fisik.",
      RECHECK,
    ],
  },
  tangki_berubah: {
    judul: "Susunan tangki berubah",
    langkah: [
      "Periksa apakah semua tangki produk ini diopname pada penutup sebelumnya dan penutup di tabel; lengkapi tangki yang belum tercatat.",
      RECHECK,
    ],
  },
  tak_terhitung: {
    judul: "Komponen tidak lengkap",
    langkah: [
      "Periksa kelengkapan penutup opname, penerimaan DO, penjualan, dan tera resmi di hari bisnis itu.",
      RECHECK,
    ],
  },
};

/** Batas klaim — tampil bersama panel di semua tampilan. */
export const GL_VERIFY_CAVEATS =
  `Nilai “${GL_UNVERIFIED}” tampil “—” dan tidak masuk total, persen, maupun alarm. Hitungan mentah hanya untuk audit — ` +
  "bukan hasil G/L final, dan belum menunjukkan rugi maupun untung. Volume REAL penerimaan saja tidak cukup sebagai verifikasi; " +
  "ralat sumber atau hilangnya penanda saja tidak membuat angka tersertifikasi. Stok fisik 0 yang memang benar (tangki kosong) bukan otomatis salah input.";

/** Batas baris yang dirender; sisanya disebut jumlahnya. */
export const GL_UNVERIFIED_LIMIT = 12;

export interface GlUnverifiedPanel {
  shown: GlUnverifiedItem[];
  hidden: number;
  total: number;
  /** Sebab yang hadir (semua item, bukan hanya yang dirender), urutan tetap. */
  reasons: GlUnverifiedReason[];
}

const REASON_ORDER = Object.keys(GL_VERIFY_STEPS) as GlUnverifiedReason[];

export function glUnverifiedPanel(items: GlUnverifiedItem[], limit = GL_UNVERIFIED_LIMIT): GlUnverifiedPanel {
  const sorted = sortGlUnverified(items);
  const present = new Set(sorted.map((i) => i.reason));
  return {
    shown: sorted.slice(0, limit),
    hidden: Math.max(0, sorted.length - limit),
    total: sorted.length,
    reasons: REASON_ORDER.filter((r) => present.has(r)),
  };
}
