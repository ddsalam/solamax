/**
 * Konfigurasi bisnis yang BELUM ada di pipeline EasyMax (sumber: workbook
 * "Target SPBU SolaGroup 2026" + keputusan Fase B). Struktur siap 7 SPBU;
 * pilot terisi untuk Imam Bonjol (6478111). Unit lain: tambahkan entri.
 */

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
};

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
};

export function targetBauran(
  code: string,
  kind: FuelKind,
  month: number,
): number | null {
  return TARGET_BAURAN[code]?.[kind]?.[month] ?? null;
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
  "6478111": {
    6: {
      PERTALITE: 30000,
      PERTAMAX: 3500,
      "PERTAMAX TURBO": 150,
      SOLAR: 23000,
      DEXLITE: 3300,
      "PERTAMINA DEX": 5000,
    },
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
