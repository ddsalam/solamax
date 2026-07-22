/**
 * Konfigurasi bisnis yang BELUM ada di pipeline EasyMax (sumber: workbook
 * "Target SPBU SolaGroup 2026" + keputusan Fase B). Struktur siap 7 SPBU;
 * pilot terisi untuk Imam Bonjol (6478111). Unit lain: tambahkan entri.
 */
// CD smoke (Fase 3, 2026-07-16): komentar no-op untuk memicu pipeline dashboard.

/** Tampilan kode unit: kanonik bertitik + nama (keputusan ambiguitas №7). */
export interface UnitDisplay {
  dotted: string;
  name: string;
  /** Kop dokumen Rincian (№8) — teks sementara sampai data resmi per unit. */
  pt?: string;
  address?: string;
}

export const UNIT_DISPLAY: Record<string, UnitDisplay> = {
  "6478111": {
    dotted: "64.781.11",
    name: "Imam Bonjol",
    pt: "PT Sola Petra Abadi",
    address: "Jl. Imam Bonjol, Pontianak Selatan, Kalimantan Barat",
  },
  "6378301": {
    dotted: "63.783.01",
    name: "Bakau",
    pt: "PT Sola Petra Abadi",
    address:
      "Jl. Raya Sungai Bakau Besar Laut, Kec. Sungai Pinyuh, Kab. Mempawah, 78919",
    // pengawas: Dedek Akramul (spbu6378301sbbl@solagroup.co)
  },
  // Adisucipto (64.781.01) — tenant TERPISAH: PT Sola Adis Raya (Option A).
  "6478101": {
    dotted: "64.781.01",
    name: "Adisucipto",
    pt: "PT Sola Adis Raya",
    address:
      "Jl. Adi Sucipto No 1, Bangka Belitung Laut, Kec. Pontianak Tenggara, 78111",
    // pengawas: Sabandi (sola.adis.raya@solagroup.co)
  },
  // Bundaran Kotabaru (64.781.06) — tenant BARU (ke-3): PT Merita Abadi Sukses
  // (Option A, isolasi lintas-tenant seperti AS — bukan pola same-tenant Bakau).
  // Display code "KB" cosmetic saja (≠ Bakau "BK"; kunci runtime = kode POS di
  // bawah ini). CATATAN (2026-07-22): kode POS TIDAK selalu 7 digit — 28 Oktober
  // memakai `63781002` (DELAPAN digit). Tak ada kode runtime yang mengasumsikan
  // panjang; perlakukan kode sebagai string opaque.
  "6478106": {
    dotted: "64.781.06",
    name: "Bundaran Kotabaru",
    pt: "PT Merita Abadi Sukses",
    address: "Jl. Prof. M. Yamin No 1, Kota Baru, Kec. Pontianak Kota, 78116",
    // pengawas: Eddy Supratman (merita.abadisukses@solagroup.co)
  },
  // Batu Layang (64.782.01) — tenant BARU (ke-4): PT Batu Layang Jaya
  // (Option A, isolasi lintas-tenant seperti AS/KB — bukan pola same-tenant Bakau).
  "6478201": {
    dotted: "64.782.01",
    name: "Batu Layang",
    pt: "PT Batu Layang Jaya",
    address: "Jl. Batu Layang, Kec. Pontianak Utara, 78244",
    // pengawas: Indra Wahyudi (spbu6478201bl@solagroup.co)
  },
  // Korek (64.783.11) — tenant BARU (ke-5): PT Mitra Indah Lestari Oil Pratama
  // (Option A, isolasi lintas-tenant seperti AS/KB/BL — bukan pola same-tenant Bakau).
  // Satu-satunya unit di luar kota (Kab. Kubu Raya).
  "6478311": {
    dotted: "64.783.11",
    name: "Korek",
    pt: "PT Mitra Indah Lestari Oil Pratama",
    address:
      "Jl. Trans Kalimantan, Desa Korek, Kec. Sungai Ambawang, Kab. Kubu Raya, 78393",
    // pengawas: Rio Prasetiawan (spbu6478311milop@solagroup.co)
  },
  // 28 Oktober (63.781.002) — tenant BARU (ke-6): PT Sola Petra Energi.
  // ⚠️ ENTITAS BERBEDA dari "PT Sola Petra Abadi" (pemilik IB + Bakau) — beda
  // SATU kata, dikonfirmasi owner sebagai badan hukum terpisah. Slug tenant
  // `pt-sola-petra-energi` vs `pt-sola-petra-abadi`: JANGAN pernah memilih
  // tenant dgn LIKE/prefix, selalu string eksak (salah pilih = data 28 Oktober
  // terlihat direksi IB/Bakau "sesuai aturan", tanpa scope-rule menyalak).
  // ⚠️ Kode POS DELAPAN digit (satu-satunya di armada) — bukan 7.
  // Unit ke-7 = unit TERAKHIR; armada lengkap 7/7.
  "63781002": {
    dotted: "63.781.002",
    name: "28 Oktober",
    pt: "PT Sola Petra Energi",
    address: "Jl. 28 Oktober, Siantan Hulu, Kec. Pontianak Utara, 78242",
    // pengawas: Rossi Machus (solapetraenergi@gmail.com — Gmail biasa, by design:
    // akses invite-gated lewat membership, bukan lewat domain email)
  },
};

/**
 * Label PT untuk kumpulan unit (kop/nama-file ekspor multi-unit): satu PT unik
 * → nama PT itu; campuran lintas-PT atau tak dikenal → payung "SolaGroup".
 * (Pengganti hardcode "PT Sola Petra Abadi" — multi-tenant sejak unit AS.)
 */
export function ptLabelForUnits(codes: string[]): string {
  const pts = new Set(
    codes.map((c) => UNIT_DISPLAY[c]?.pt).filter((p): p is string => !!p),
  );
  return pts.size === 1 ? [...pts][0]! : "SolaGroup";
}

export function unitLabel(code: string, fallbackName?: string): string {
  const u = UNIT_DISPLAY[code];
  if (u) return `${u.dotted} — ${u.name}`;
  return fallbackName ? `${code} — ${fallbackName}` : code;
}

export function unitDotted(code: string): string {
  return UNIT_DISPLAY[code]?.dotted ?? code;
}

/**
 * Klasifikasi produk (№4, TERKONFIRMASI): PSO = Pertalite + Solar/BioSolar;
 * NPSO = Pertamax, Pertamax Turbo, Dexlite, Pertamina Dex.
 * Jenis: gasoline vs gasoil. Dicocokkan terhadap NAMA produk tm_bbm (uppercase).
 */
export type FuelKind = "gasoline" | "gasoil";
export interface ProductClass {
  kind: FuelKind;
  pso: boolean;
  /** Urutan tampil di tabel laporan. */
  order: number;
}

const CLASS_RULES: Array<{ match: RegExp; cls: ProductClass }> = [
  { match: /PERTAMAX\s*TURBO/, cls: { kind: "gasoline", pso: false, order: 3 } },
  { match: /PERTAMINA\s*DEX/, cls: { kind: "gasoil", pso: false, order: 6 } },
  { match: /PERTAMAX/, cls: { kind: "gasoline", pso: false, order: 2 } },
  { match: /PERTALITE/, cls: { kind: "gasoline", pso: true, order: 1 } },
  { match: /DEXLITE/, cls: { kind: "gasoil", pso: false, order: 5 } },
  { match: /SOLAR/, cls: { kind: "gasoil", pso: true, order: 4 } }, // SOLAR / BIO SOLAR
];

export function classifyProduct(name: string | null): ProductClass | null {
  if (!name) return null;
  const up = name.toUpperCase();
  for (const r of CLASS_RULES) if (r.match.test(up)) return r.cls;
  return null;
}

/**
 * Laporan DO Harian — daftar produk TETAP + urutan (keputusan owner). Premium
 * (BB-01) DISCONTINUE → dibuang. Baris dirender walau 0. Resolver mencocokkan
 * NAMA produk EasyMax (tm_bbm.VCNMBBM) → slot, TANPA mengubah CLASS_RULES global
 * (urutan DO beda dari urutan tabel lain). Negative-lookahead memisahkan
 * "Pertamax" dari "Pertamax Turbo".
 */
export interface DoProduct {
  key: string;
  label: string;
  match: RegExp;
}
export const DO_PRODUCTS: DoProduct[] = [
  { key: "pertamax", label: "Pertamax", match: /PERTAMAX(?!\s*TURBO)/ },
  { key: "solar", label: "Solar", match: /SOLAR/ },
  { key: "dexlite", label: "Dexlite", match: /DEXLITE/ },
  { key: "pertalite", label: "Pertalite", match: /PERTALITE/ },
  { key: "pertamax_turbo", label: "Pertamax Turbo", match: /PERTAMAX\s*TURBO/ },
  { key: "pertamina_dex", label: "Pertamina Dex", match: /PERTAMINA\s*DEX/ },
];

export function resolveDoProduct(name: string | null): DoProduct | null {
  if (!name) return null;
  const up = name.toUpperCase();
  for (const p of DO_PRODUCTS) if (p.match.test(up)) return p;
  return null;
}

/**
 * ⚠️ INERT — TIDAK DIPAKAI lagi (digantikan model per-SO open-balance di
 * `getDoHarian` v2). Disimpan sbg catatan forensik + fallback darurat.
 *
 * Riwayat: cumulative-dari-backfill naive memunculkan δ raksasa per produk (Solar
 * +280k, Pertalite +328k) — terlacak ke GAP record penebusan ~1–13 Jan 2025
 * (penerimaan jalan, tr_dtebus kosong). δ = selisih KONSTAN (PNG − kode) 18–24 Jun
 * 2026 yang dulu mengompensasi gap itu. **Per-SO (F12-equivalent, lewat CNOSO)
 * menyelesaikannya secara STRUKTURAL tanpa seed** (Solar/Pertalite/P.Dex cocok PNG
 * 7/7). Nilai di bawah sengaja DIKOSONGKAN; `getDoHarian` v2 tak memanggil `doSeed`.
 */
export const DO_SEED: Record<string, Partial<Record<string, number>>> = {
  // Kosong — per-SO otoritatif. (Forensik δ lama: solar +280k, pertalite +328k,
  // pertamina_dex +24k, pertamax −44k, pertamax_turbo −20k, dexlite −72k.)
  "6478111": {},
};
export function doSeed(code: string, key: string): number {
  return DO_SEED[code]?.[key] ?? 0;
}

/**
 * Target BAURAN (№3, dari workbook — angka NYATA, bukan placeholder).
 * Definisi rasio atas volume liter:
 *   gasoline = (Pertamax + Pertamax Turbo) / Pertalite
 *   gasoil   = (Dexlite + Pertamina Dex) / Solar
 * Index bulan 1–12.
 */
export const TARGET_BAURAN: Record<
  string,
  Record<FuelKind, Record<number, number>>
> = {
  "6478111": {
    gasoline: {
      1: 0.1033, 2: 0.107, 3: 0.1107, 4: 0.1143, 5: 0.118, 6: 0.1217,
      7: 0.1253, 8: 0.129, 9: 0.1327, 10: 0.1363, 11: 0.14, 12: 0.1437,
    },
    gasoil: {
      1: 0.3522, 2: 0.3539, 3: 0.3557, 4: 0.3574, 5: 0.3591, 6: 0.3609,
      7: 0.3626, 8: 0.3643, 9: 0.3661, 10: 0.3678, 11: 0.3696, 12: 0.3713,
    },
  },
  // Bakau (63.783.01) — workbook 2026, 12 bulan penuh. Bauran gasoil jauh lebih
  // rendah dari IB (mix gasoil ~15% vs IB ~36%).
  "6378301": {
    gasoline: {
      1: 0.1113, 2: 0.115, 3: 0.1187, 4: 0.1225, 5: 0.1263, 6: 0.13,
      7: 0.1338, 8: 0.1375, 9: 0.1412, 10: 0.145, 11: 0.1487, 12: 0.1525,
    },
    gasoil: {
      1: 0.1235, 2: 0.1276, 3: 0.1318, 4: 0.1359, 5: 0.14, 6: 0.1441,
      7: 0.1482, 8: 0.1524, 9: 0.1565, 10: 0.1606, 11: 0.1647, 12: 0.1688,
    },
  },
  // Adisucipto (64.781.01) — workbook "Target SPBU SolaGroup 2026" baris AS,
  // 12 bulan penuh (angka NYATA, cross-check owner 2026-07-17). Ramp gasoline
  // agresif (Turbo baru mulai Jul); gasoil ~28–32%.
  "6478101": {
    gasoline: {
      1: 0.0375, 2: 0.0438, 3: 0.05, 4: 0.0563, 5: 0.0625, 6: 0.0688,
      7: 0.0775, 8: 0.085, 9: 0.0925, 10: 0.1, 11: 0.1075, 12: 0.115,
    },
    gasoil: {
      1: 0.275, 2: 0.2792, 3: 0.2833, 4: 0.2875, 5: 0.2917, 6: 0.2958,
      7: 0.3, 8: 0.3042, 9: 0.3083, 10: 0.3125, 11: 0.3167, 12: 0.3208,
    },
  },
  // Bundaran Kotabaru (64.781.06) — tenant BARU PT Merita Abadi Sukses. Workbook
  // "Target SPBU SolaGroup 2026" baris KB, 12 bulan penuh (angka NYATA, cross-check
  // owner 2026-07-20). 4dp round-half-up dari raw (mis. gasoline Jan 0.16685714… →
  // 0.1669). Bauran gasoline TERTINGGI dari semua unit; semua produk aktif sejak Jan.
  "6478106": {
    gasoline: {
      1: 0.1669, 2: 0.17, 3: 0.1731, 4: 0.1763, 5: 0.1794, 6: 0.1826,
      7: 0.1857, 8: 0.1889, 9: 0.192, 10: 0.1951, 11: 0.1983, 12: 0.2014,
    },
    gasoil: {
      1: 0.33, 2: 0.333, 3: 0.336, 4: 0.339, 5: 0.342, 6: 0.345,
      7: 0.348, 8: 0.351, 9: 0.354, 10: 0.357, 11: 0.36, 12: 0.363,
    },
  },
  // Batu Layang (64.782.01) — tenant BARU PT Batu Layang Jaya. Workbook
  // "Target SPBU SolaGroup 2026" baris BL, 12 bulan penuh (angka NYATA, cross-check
  // owner 2026-07-21). 4dp round-half-up dari raw (mis. gasoil Jan 0.50588235… →
  // 0.5059). Profil DIESEL-HEAVY: bauran gasoil TERTINGGI semua unit (~0,51) &
  // gasoline TERENDAH — kebalikan KB.
  "6478201": {
    gasoline: {
      1: 0.0425, 2: 0.048, 3: 0.0535, 4: 0.059, 5: 0.0645, 6: 0.07,
      7: 0.0755, 8: 0.081, 9: 0.0865, 10: 0.092, 11: 0.0975, 12: 0.103,
    },
    gasoil: {
      1: 0.5059, 2: 0.5082, 3: 0.5106, 4: 0.5129, 5: 0.5153, 6: 0.5176,
      7: 0.52, 8: 0.5224, 9: 0.5247, 10: 0.5271, 11: 0.5294, 12: 0.5318,
    },
  },
  // Korek (64.783.11) — tenant BARU PT Mitra Indah Lestari Oil Pratama. Workbook
  // "Target SPBU SolaGroup 2026" baris KR, 12 bulan penuh (angka NYATA, cross-check
  // owner 2026-07-21; 96/96 sel eksak + bauran terderivasi dari volume 12/12).
  // 4dp round-half-up dari raw (mis. gasoline Jan 0.05285714… → 0.0529).
  // Profil: bauran gasoil RENDAH (0,255–0,277) — lebih rendah dari IB/KB/AS/BL
  // 12/12, tetapi TETAP DI ATAS Bakau (0,1235–0,1688); Bakau-lah yang terendah.
  // Gasoline lebih rendah dari IB/Bakau/KB 12/12, tetapi menyilang AS & BL di
  // bulan 5 (KR lebih tinggi Jan–Apr, lebih rendah Mei–Des).
  "6478311": {
    gasoline: {
      1: 0.0529, 2: 0.055, 3: 0.0571, 4: 0.0593, 5: 0.0614, 6: 0.0636,
      7: 0.0657, 8: 0.0679, 9: 0.07, 10: 0.0721, 11: 0.0743, 12: 0.0764,
    },
    gasoil: {
      1: 0.255, 2: 0.257, 3: 0.259, 4: 0.261, 5: 0.263, 6: 0.265,
      7: 0.267, 8: 0.269, 9: 0.271, 10: 0.273, 11: 0.275, 12: 0.277,
    },
  },
  // 28 Oktober (63.781.002) — tenant BARU PT Sola Petra Energi. Workbook
  // "Target SPBU SolaGroup 2026" baris 28, 12 bulan penuh (angka NYATA,
  // cross-check owner 2026-07-22; 24/24 sel bauran TERDERIVASI eksak dari tabel
  // volume di bawah, 4dp round-half-up — mis. gasoline Jan 1790/21000 =
  // 0,08523809… → 0,0852; gasoil Jan 6800/17000 = 0,4000 tepat).
  // Profil (matriks 7 unit dihitung, BUKAN diwarisi):
  //   gasoil   = PERINGKAT 2 dari 7, 12/12 bulan — di bawah BL saja
  //              (BL min 0,5059 > 28 max 0,4259; 28 min 0,4000 > IB max 0,3713).
  //   gasoline = PERINGKAT 4 dari 7, 12/12 bulan — di bawah IB/Bakau/KB,
  //              di atas AS/BL/KR.
  // Satu-satunya unit TANPA persilangan sama sekali di kedua sumbu (KR menyilang
  // AS/BL di bulan 5; BL menyilang AS di bulan 7).
  "63781002": {
    gasoline: {
      1: 0.0852, 2: 0.0905, 3: 0.0957, 4: 0.101, 5: 0.1062, 6: 0.1114,
      7: 0.1167, 8: 0.1219, 9: 0.1271, 10: 0.1324, 11: 0.1376, 12: 0.1429,
    },
    gasoil: {
      1: 0.4, 2: 0.4024, 3: 0.4047, 4: 0.4071, 5: 0.4094, 6: 0.4118,
      7: 0.4141, 8: 0.4165, 9: 0.4188, 10: 0.4212, 11: 0.4235, 12: 0.4259,
    },
  },
};

export function targetBauran(
  code: string,
  kind: FuelKind,
  month: number,
): number | null {
  return TARGET_BAURAN[code]?.[kind]?.[month] ?? null;
}

/**
 * Target bauran untuk RENTANG tanggal = rata-rata TERTIMBANG HARI atas target
 * bulanan (keputusan owner FASE 0 №1, label UI "target rata-rata periode"):
 *   Σ(hari rentang dlm bulan m × target(m)) / total hari rentang.
 * Rasional: aktual KPI adalah Σ volume atas rentang → pembanding apples-to-apples
 * adalah target rata-rata rentang yang sama, bukan target bulan-akhir (ramp naik
 * per bulan; memakai bulan akhir menyesatkan >1 pt utk rentang panjang mis. YTD).
 * null bila ADA bulan dalam rentang tanpa target (jangan parsial diam-diam).
 * CATATAN: TARGET_BAURAN tanpa dimensi tahun (workbook 2026) — pemanggil TIDAK
 * menampilkan target untuk jendela pembanding tahun lalu (keputusan owner).
 */
export function targetBauranRange(
  code: string,
  kind: FuelKind,
  range: { from: string; to: string },
): number | null {
  if (range.from > range.to) return null;
  const table = TARGET_BAURAN[code]?.[kind];
  if (!table) return null;

  let weighted = 0;
  let totalDays = 0;
  // Iterasi per bulan kalender yang beririsan dengan rentang.
  let [y, m] = range.from.split("-").map(Number) as [number, number];
  const [ey, em] = range.to.split("-").map(Number) as [number, number];
  while (y < ey || (y === ey && m <= em)) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    const last = `${first.slice(0, 8)}${String(daysInMonth).padStart(2, "0")}`;
    const oFrom = range.from > first ? range.from : first;
    const oTo = range.to < last ? range.to : last;
    const days = Number(oTo.slice(8, 10)) - Number(oFrom.slice(8, 10)) + 1;
    const t = table[m];
    if (t === undefined) return null;
    weighted += days * t;
    totalDays += days;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return totalDays > 0 ? weighted / totalDays : null;
}

/**
 * Target VOLUME (sheet "Target Volume", L/HARI per produk per bulan).
 * Key produk = nama kanonik (cocokkan via canonicalProductKey()).
 * Pilot: IB Juni 2026 terisi; bulan lain menyusul dari workbook.
 */
export const TARGET_VOLUME_PER_DAY: Record<
  string,
  Record<number, Record<string, number>>
> = {
  // Imam Bonjol (64.781.11) — workbook 2026 baris IB, 12 bulan penuh (L/HARI).
  // Sebelumnya HANYA bulan 6 (sisa era pilot), sehingga target-vs-aktual kosong 11
  // bulan setahun; dilengkapi 2026-07-22 dari workbook kanonik yang sama.
  // Bulan 6 TIDAK berubah — byte-identical dgn entri pilot lama (guard: 8/8 nilai
  // cocok sebelum penulisan). PERTALITE 30k & SOLAR 23k flat; sisanya ramp.
  // Volume harian IB ~64k L = TERTINGGI semua unit.
  "6478111": {
    1: { PERTALITE: 30000, PERTAMAX: 3000, "PERTAMAX TURBO": 100, SOLAR: 23000, DEXLITE: 3200, "PERTAMINA DEX": 4900 },
    2: { PERTALITE: 30000, PERTAMAX: 3100, "PERTAMAX TURBO": 110, SOLAR: 23000, DEXLITE: 3220, "PERTAMINA DEX": 4920 },
    3: { PERTALITE: 30000, PERTAMAX: 3200, "PERTAMAX TURBO": 120, SOLAR: 23000, DEXLITE: 3240, "PERTAMINA DEX": 4940 },
    4: { PERTALITE: 30000, PERTAMAX: 3300, "PERTAMAX TURBO": 130, SOLAR: 23000, DEXLITE: 3260, "PERTAMINA DEX": 4960 },
    5: { PERTALITE: 30000, PERTAMAX: 3400, "PERTAMAX TURBO": 140, SOLAR: 23000, DEXLITE: 3280, "PERTAMINA DEX": 4980 },
    6: { PERTALITE: 30000, PERTAMAX: 3500, "PERTAMAX TURBO": 150, SOLAR: 23000, DEXLITE: 3300, "PERTAMINA DEX": 5000 },
    7: { PERTALITE: 30000, PERTAMAX: 3600, "PERTAMAX TURBO": 160, SOLAR: 23000, DEXLITE: 3320, "PERTAMINA DEX": 5020 },
    8: { PERTALITE: 30000, PERTAMAX: 3700, "PERTAMAX TURBO": 170, SOLAR: 23000, DEXLITE: 3340, "PERTAMINA DEX": 5040 },
    9: { PERTALITE: 30000, PERTAMAX: 3800, "PERTAMAX TURBO": 180, SOLAR: 23000, DEXLITE: 3360, "PERTAMINA DEX": 5060 },
    10: { PERTALITE: 30000, PERTAMAX: 3900, "PERTAMAX TURBO": 190, SOLAR: 23000, DEXLITE: 3380, "PERTAMINA DEX": 5080 },
    11: { PERTALITE: 30000, PERTAMAX: 4000, "PERTAMAX TURBO": 200, SOLAR: 23000, DEXLITE: 3400, "PERTAMINA DEX": 5100 },
    12: { PERTALITE: 30000, PERTAMAX: 4100, "PERTAMAX TURBO": 210, SOLAR: 23000, DEXLITE: 3420, "PERTAMINA DEX": 5120 },
  },
  // Bakau (63.783.01) — workbook 2026, 12 bulan penuh (L/HARI). Volume harian
  // ~37,7k L vs IB ~64k; PERTALITE & SOLAR flat, sisanya naik per bulan.
  "6378301": {
    1: { PERTALITE: 16000, PERTAMAX: 1700, "PERTAMAX TURBO": 80, SOLAR: 17000, DEXLITE: 1800, "PERTAMINA DEX": 300 },
    2: { PERTALITE: 16000, PERTAMAX: 1750, "PERTAMAX TURBO": 90, SOLAR: 17000, DEXLITE: 1850, "PERTAMINA DEX": 320 },
    3: { PERTALITE: 16000, PERTAMAX: 1800, "PERTAMAX TURBO": 100, SOLAR: 17000, DEXLITE: 1900, "PERTAMINA DEX": 340 },
    4: { PERTALITE: 16000, PERTAMAX: 1850, "PERTAMAX TURBO": 110, SOLAR: 17000, DEXLITE: 1950, "PERTAMINA DEX": 360 },
    5: { PERTALITE: 16000, PERTAMAX: 1900, "PERTAMAX TURBO": 120, SOLAR: 17000, DEXLITE: 2000, "PERTAMINA DEX": 380 },
    6: { PERTALITE: 16000, PERTAMAX: 1950, "PERTAMAX TURBO": 130, SOLAR: 17000, DEXLITE: 2050, "PERTAMINA DEX": 400 },
    7: { PERTALITE: 16000, PERTAMAX: 2000, "PERTAMAX TURBO": 140, SOLAR: 17000, DEXLITE: 2100, "PERTAMINA DEX": 420 },
    8: { PERTALITE: 16000, PERTAMAX: 2050, "PERTAMAX TURBO": 150, SOLAR: 17000, DEXLITE: 2150, "PERTAMINA DEX": 440 },
    9: { PERTALITE: 16000, PERTAMAX: 2100, "PERTAMAX TURBO": 160, SOLAR: 17000, DEXLITE: 2200, "PERTAMINA DEX": 460 },
    10: { PERTALITE: 16000, PERTAMAX: 2150, "PERTAMAX TURBO": 170, SOLAR: 17000, DEXLITE: 2250, "PERTAMINA DEX": 480 },
    11: { PERTALITE: 16000, PERTAMAX: 2200, "PERTAMAX TURBO": 180, SOLAR: 17000, DEXLITE: 2300, "PERTAMINA DEX": 500 },
    12: { PERTALITE: 16000, PERTAMAX: 2250, "PERTAMAX TURBO": 190, SOLAR: 17000, DEXLITE: 2350, "PERTAMINA DEX": 520 },
  },
  // Adisucipto (64.781.01) — workbook 2026 baris AS, 12 bulan penuh (L/HARI).
  // PERTALITE & SOLAR flat; PERTAMAX TURBO 0 s/d Jun (mulai dijual Jul).
  "6478101": {
    1: { PERTALITE: 8000, PERTAMAX: 300, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3000, "PERTAMINA DEX": 300 },
    2: { PERTALITE: 8000, PERTAMAX: 350, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3020, "PERTAMINA DEX": 330 },
    3: { PERTALITE: 8000, PERTAMAX: 400, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3040, "PERTAMINA DEX": 360 },
    4: { PERTALITE: 8000, PERTAMAX: 450, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3060, "PERTAMINA DEX": 390 },
    5: { PERTALITE: 8000, PERTAMAX: 500, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3080, "PERTAMINA DEX": 420 },
    6: { PERTALITE: 8000, PERTAMAX: 550, "PERTAMAX TURBO": 0, SOLAR: 12000, DEXLITE: 3100, "PERTAMINA DEX": 450 },
    7: { PERTALITE: 8000, PERTAMAX: 600, "PERTAMAX TURBO": 20, SOLAR: 12000, DEXLITE: 3120, "PERTAMINA DEX": 480 },
    8: { PERTALITE: 8000, PERTAMAX: 650, "PERTAMAX TURBO": 30, SOLAR: 12000, DEXLITE: 3140, "PERTAMINA DEX": 510 },
    9: { PERTALITE: 8000, PERTAMAX: 700, "PERTAMAX TURBO": 40, SOLAR: 12000, DEXLITE: 3160, "PERTAMINA DEX": 540 },
    10: { PERTALITE: 8000, PERTAMAX: 750, "PERTAMAX TURBO": 50, SOLAR: 12000, DEXLITE: 3180, "PERTAMINA DEX": 570 },
    11: { PERTALITE: 8000, PERTAMAX: 800, "PERTAMAX TURBO": 60, SOLAR: 12000, DEXLITE: 3200, "PERTAMINA DEX": 600 },
    12: { PERTALITE: 8000, PERTAMAX: 850, "PERTAMAX TURBO": 70, SOLAR: 12000, DEXLITE: 3220, "PERTAMINA DEX": 630 },
  },
  // Bundaran Kotabaru (64.781.06) — tenant BARU PT Merita Abadi Sukses. Workbook
  // 2026 baris KB, 12 bulan penuh (L/HARI). PERTALITE 35k (tertinggi semua unit) &
  // SOLAR 10k (terendah) flat; semua produk termasuk TURBO aktif sejak Jan (≠ AS).
  "6478106": {
    1: { PERTALITE: 35000, PERTAMAX: 5600, "PERTAMAX TURBO": 240, SOLAR: 10000, DEXLITE: 2500, "PERTAMINA DEX": 800 },
    2: { PERTALITE: 35000, PERTAMAX: 5700, "PERTAMAX TURBO": 250, SOLAR: 10000, DEXLITE: 2510, "PERTAMINA DEX": 820 },
    3: { PERTALITE: 35000, PERTAMAX: 5800, "PERTAMAX TURBO": 260, SOLAR: 10000, DEXLITE: 2520, "PERTAMINA DEX": 840 },
    4: { PERTALITE: 35000, PERTAMAX: 5900, "PERTAMAX TURBO": 270, SOLAR: 10000, DEXLITE: 2530, "PERTAMINA DEX": 860 },
    5: { PERTALITE: 35000, PERTAMAX: 6000, "PERTAMAX TURBO": 280, SOLAR: 10000, DEXLITE: 2540, "PERTAMINA DEX": 880 },
    6: { PERTALITE: 35000, PERTAMAX: 6100, "PERTAMAX TURBO": 290, SOLAR: 10000, DEXLITE: 2550, "PERTAMINA DEX": 900 },
    7: { PERTALITE: 35000, PERTAMAX: 6200, "PERTAMAX TURBO": 300, SOLAR: 10000, DEXLITE: 2560, "PERTAMINA DEX": 920 },
    8: { PERTALITE: 35000, PERTAMAX: 6300, "PERTAMAX TURBO": 310, SOLAR: 10000, DEXLITE: 2570, "PERTAMINA DEX": 940 },
    9: { PERTALITE: 35000, PERTAMAX: 6400, "PERTAMAX TURBO": 320, SOLAR: 10000, DEXLITE: 2580, "PERTAMINA DEX": 960 },
    10: { PERTALITE: 35000, PERTAMAX: 6500, "PERTAMAX TURBO": 330, SOLAR: 10000, DEXLITE: 2590, "PERTAMINA DEX": 980 },
    11: { PERTALITE: 35000, PERTAMAX: 6600, "PERTAMAX TURBO": 340, SOLAR: 10000, DEXLITE: 2600, "PERTAMINA DEX": 1000 },
    12: { PERTALITE: 35000, PERTAMAX: 6700, "PERTAMAX TURBO": 350, SOLAR: 10000, DEXLITE: 2610, "PERTAMINA DEX": 1020 },
  },
  // Batu Layang (64.782.01) — tenant BARU PT Batu Layang Jaya. Workbook 2026
  // baris BL, 12 bulan penuh (L/HARI). PERTALITE 20k & SOLAR 17k flat; semua
  // produk termasuk TURBO aktif sejak Jan (≠ AS). PERTAMINA DEX 5,6k = TERTINGGI
  // semua unit (unit diesel-heavy).
  "6478201": {
    1: { PERTALITE: 20000, PERTAMAX: 800, "PERTAMAX TURBO": 50, SOLAR: 17000, DEXLITE: 3000, "PERTAMINA DEX": 5600 },
    2: { PERTALITE: 20000, PERTAMAX: 900, "PERTAMAX TURBO": 60, SOLAR: 17000, DEXLITE: 3020, "PERTAMINA DEX": 5620 },
    3: { PERTALITE: 20000, PERTAMAX: 1000, "PERTAMAX TURBO": 70, SOLAR: 17000, DEXLITE: 3040, "PERTAMINA DEX": 5640 },
    4: { PERTALITE: 20000, PERTAMAX: 1100, "PERTAMAX TURBO": 80, SOLAR: 17000, DEXLITE: 3060, "PERTAMINA DEX": 5660 },
    5: { PERTALITE: 20000, PERTAMAX: 1200, "PERTAMAX TURBO": 90, SOLAR: 17000, DEXLITE: 3080, "PERTAMINA DEX": 5680 },
    6: { PERTALITE: 20000, PERTAMAX: 1300, "PERTAMAX TURBO": 100, SOLAR: 17000, DEXLITE: 3100, "PERTAMINA DEX": 5700 },
    7: { PERTALITE: 20000, PERTAMAX: 1400, "PERTAMAX TURBO": 110, SOLAR: 17000, DEXLITE: 3120, "PERTAMINA DEX": 5720 },
    8: { PERTALITE: 20000, PERTAMAX: 1500, "PERTAMAX TURBO": 120, SOLAR: 17000, DEXLITE: 3140, "PERTAMINA DEX": 5740 },
    9: { PERTALITE: 20000, PERTAMAX: 1600, "PERTAMAX TURBO": 130, SOLAR: 17000, DEXLITE: 3160, "PERTAMINA DEX": 5760 },
    10: { PERTALITE: 20000, PERTAMAX: 1700, "PERTAMAX TURBO": 140, SOLAR: 17000, DEXLITE: 3180, "PERTAMINA DEX": 5780 },
    11: { PERTALITE: 20000, PERTAMAX: 1800, "PERTAMAX TURBO": 150, SOLAR: 17000, DEXLITE: 3200, "PERTAMINA DEX": 5800 },
    12: { PERTALITE: 20000, PERTAMAX: 1900, "PERTAMAX TURBO": 160, SOLAR: 17000, DEXLITE: 3220, "PERTAMINA DEX": 5820 },
  },
  // Korek (64.783.11) — tenant BARU PT Mitra Indah Lestari Oil Pratama. Workbook
  // 2026 baris KR, 12 bulan penuh (L/HARI). PERTALITE 28k & SOLAR 10k flat (SOLAR
  // seri terendah, seri KB); semua produk termasuk TURBO aktif sejak Jan (≠ AS).
  // DEXLITE 1.750 FLAT 12 bulan — satu-satunya unit tanpa ramp Dexlite.
  "6478311": {
    1: { PERTALITE: 28000, PERTAMAX: 1400, "PERTAMAX TURBO": 80, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 800 },
    2: { PERTALITE: 28000, PERTAMAX: 1450, "PERTAMAX TURBO": 90, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 820 },
    3: { PERTALITE: 28000, PERTAMAX: 1500, "PERTAMAX TURBO": 100, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 840 },
    4: { PERTALITE: 28000, PERTAMAX: 1550, "PERTAMAX TURBO": 110, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 860 },
    5: { PERTALITE: 28000, PERTAMAX: 1600, "PERTAMAX TURBO": 120, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 880 },
    6: { PERTALITE: 28000, PERTAMAX: 1650, "PERTAMAX TURBO": 130, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 900 },
    7: { PERTALITE: 28000, PERTAMAX: 1700, "PERTAMAX TURBO": 140, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 920 },
    8: { PERTALITE: 28000, PERTAMAX: 1750, "PERTAMAX TURBO": 150, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 940 },
    9: { PERTALITE: 28000, PERTAMAX: 1800, "PERTAMAX TURBO": 160, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 960 },
    10: { PERTALITE: 28000, PERTAMAX: 1850, "PERTAMAX TURBO": 170, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 980 },
    11: { PERTALITE: 28000, PERTAMAX: 1900, "PERTAMAX TURBO": 180, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 1000 },
    12: { PERTALITE: 28000, PERTAMAX: 1950, "PERTAMAX TURBO": 190, SOLAR: 10000, DEXLITE: 1750, "PERTAMINA DEX": 1020 },
  },
  // 28 Oktober (63.781.002) — tenant BARU PT Sola Petra Energi. Workbook 2026
  // baris 28, 12 bulan penuh (L/HARI). PERTALITE 21k & SOLAR 17k flat (SOLAR
  // sama dgn Bakau/BL); semua produk termasuk TURBO aktif sejak Jan (≠ AS).
  // DEXLITE & PERTAMINA DEX sama-sama ramp +20/bulan (pola BL) tapi dari basis
  // lebih rendah. Total harian ~46,6k→48,2k L — tetap di bawah IB (~64,2k→65,9k).
  "63781002": {
    1: { PERTALITE: 21000, PERTAMAX: 1700, "PERTAMAX TURBO": 90, SOLAR: 17000, DEXLITE: 2900, "PERTAMINA DEX": 3900 },
    2: { PERTALITE: 21000, PERTAMAX: 1800, "PERTAMAX TURBO": 100, SOLAR: 17000, DEXLITE: 2920, "PERTAMINA DEX": 3920 },
    3: { PERTALITE: 21000, PERTAMAX: 1900, "PERTAMAX TURBO": 110, SOLAR: 17000, DEXLITE: 2940, "PERTAMINA DEX": 3940 },
    4: { PERTALITE: 21000, PERTAMAX: 2000, "PERTAMAX TURBO": 120, SOLAR: 17000, DEXLITE: 2960, "PERTAMINA DEX": 3960 },
    5: { PERTALITE: 21000, PERTAMAX: 2100, "PERTAMAX TURBO": 130, SOLAR: 17000, DEXLITE: 2980, "PERTAMINA DEX": 3980 },
    6: { PERTALITE: 21000, PERTAMAX: 2200, "PERTAMAX TURBO": 140, SOLAR: 17000, DEXLITE: 3000, "PERTAMINA DEX": 4000 },
    7: { PERTALITE: 21000, PERTAMAX: 2300, "PERTAMAX TURBO": 150, SOLAR: 17000, DEXLITE: 3020, "PERTAMINA DEX": 4020 },
    8: { PERTALITE: 21000, PERTAMAX: 2400, "PERTAMAX TURBO": 160, SOLAR: 17000, DEXLITE: 3040, "PERTAMINA DEX": 4040 },
    9: { PERTALITE: 21000, PERTAMAX: 2500, "PERTAMAX TURBO": 170, SOLAR: 17000, DEXLITE: 3060, "PERTAMINA DEX": 4060 },
    10: { PERTALITE: 21000, PERTAMAX: 2600, "PERTAMAX TURBO": 180, SOLAR: 17000, DEXLITE: 3080, "PERTAMINA DEX": 4080 },
    11: { PERTALITE: 21000, PERTAMAX: 2700, "PERTAMAX TURBO": 190, SOLAR: 17000, DEXLITE: 3100, "PERTAMINA DEX": 4100 },
    12: { PERTALITE: 21000, PERTAMAX: 2800, "PERTAMAX TURBO": 200, SOLAR: 17000, DEXLITE: 3120, "PERTAMINA DEX": 4120 },
  },
};

/** Nama produk DB → key target kanonik. */
export function canonicalProductKey(name: string | null): string | null {
  const cls = classifyProduct(name);
  if (!cls || !name) return null;
  const up = name.toUpperCase();
  if (/PERTAMAX\s*TURBO/.test(up)) return "PERTAMAX TURBO";
  if (/PERTAMINA\s*DEX/.test(up)) return "PERTAMINA DEX";
  if (/PERTAMAX/.test(up)) return "PERTAMAX";
  if (/PERTALITE/.test(up)) return "PERTALITE";
  if (/DEXLITE/.test(up)) return "DEXLITE";
  if (/SOLAR/.test(up)) return "SOLAR";
  return null;
}

export function targetVolumePerDay(
  code: string,
  month: number,
  productName: string | null,
): number | null {
  const key = canonicalProductKey(productName);
  if (!key) return null;
  return TARGET_VOLUME_PER_DAY[code]?.[month]?.[key] ?? null;
}

/**
 * Kapasitas tangki & deteksi anomali kini DARI DATA, bukan config: di-sync dari
 * view EasyMax `vw_realtm.NKAPASITAS` (kapasitas otoritatif yang ditampilkan
 * layar ATG, mis. DEX 9.000 L) ke `real_tank.nkapasitas`. Anomali = volume >
 * kapasitas. `kalibrasi MAX(Volume)`/strapping DITINGGALKAN (salah utk T-05:
 * 5.379 vs 9.000; tak ada entri 9.000) — lihat ARCHITECTURE/wiki.
 */

/**
 * Warna kolom cairan gauge per produk (pilihan tampilan, bukan data EasyMax).
 * Dicocokkan via classifyProduct + nama; fallback abu-abu netral bila tak cocok.
 * Token mengacu CSS var SolaGroup DS (lihat app.css :root).
 */
const PRODUCT_FILL_RULES: Array<{ match: RegExp; varName: string }> = [
  { match: /PERTAMAX\s*TURBO/, varName: "--tank-turbo" },
  { match: /PERTAMINA\s*DEX/, varName: "--tank-dex" },
  { match: /PERTAMAX/, varName: "--tank-pertamax" },
  { match: /PERTALITE/, varName: "--tank-pertalite" },
  { match: /DEXLITE/, varName: "--tank-dexlite" },
  { match: /SOLAR/, varName: "--tank-solar" },
];

/** Nama CSS var warna isi tangki utk produk; null → default netral. */
export function tankFillVar(name: string | null): string | null {
  if (!name) return null;
  const up = name.toUpperCase();
  for (const r of PRODUCT_FILL_RULES) if (r.match.test(up)) return r.varName;
  return null;
}
