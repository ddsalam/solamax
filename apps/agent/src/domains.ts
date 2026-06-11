import type { Domain, IngestPayload } from "@solamax/shared";
import { businessDate, int, num, str, wibDateTimeToUtcIso } from "./transform.js";

type Raw = Record<string, unknown>;
type Tables = IngestPayload["tables"];

export interface MappedPage {
  tables: Tables;
  /** Watermark tertinggi di page ini (UTC ISO utk datetime, "YYYY-MM-DD" utk cash). */
  watermarkHigh: string | null;
  /** Jumlah baris sumber yang diproses (untuk deteksi page penuh). */
  rowCount: number;
}

/**
 * Domain inkremental berbasis DTGLJAM (datetime). Watermark di-bind sebagai
 * string WIB; query memfilter `DTGLJAM IS NOT NULL` (temuan terkunci #1).
 */
export interface DateTimeDomain {
  domain: Extract<Domain, "sales" | "opname" | "delivery">;
  mode: "datetime";
  /** `?1` = cutoff WIB string, `?2` = LIMIT. */
  sql: string;
  /**
   * `?1` = DTGLJAM persis (WIB string). Melengkapi "grup boundary": baris satu
   * shift ditulis ber-DTGLJAM identik; LIMIT bisa memotong grup di batas
   * halaman → sisa grup wajib diambil query ini (temuan E2E: −466 baris sales).
   */
  sqlBoundary: string;
  map(raw: Raw[], offsetMin: number): MappedPage;
}

/** Domain berbasis DTGL (date) — kas, dorman sejak 2019, re-scan 7 hari. */
export interface DateDomain {
  domain: Extract<Domain, "cash">;
  mode: "date";
  sql: string; // `?1` = cutoff date "YYYY-MM-DD"
  map(raw: Raw[]): MappedPage;
}

/** Domain master — full sync, tanpa watermark. */
export interface MasterDomain {
  domain: Extract<Domain, "masters">;
  mode: "full";
  queries: Array<{ table: keyof Tables; sql: string; map(raw: Raw[]): unknown[] }>;
}

// ---------------------------------------------------------------------------
// SALES (tr_djualbbm ⋈ tr_hjualbbm)
// ---------------------------------------------------------------------------
const SALES: DateTimeDomain = {
  domain: "sales",
  mode: "datetime",
  sql: `
    SELECT d.CKDJUALBBM, d.CKDNOZZLE, d.NURUT, d.NSTANDAWAL, d.NSTANDAKHIR,
           d.NVOLUME, d.NHARGAJUAL, d.NSUBTOTAL, d.CKDBBM, d.CKDTANGKI,
           d.VCOPEATOR, d.DTGLJAM, d.SUBAH, d.SEDIT,
           h.DTGLJUAL, h.NSHIFT, h.VCKET
    FROM tr_djualbbm d
    JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM
    WHERE d.DTGLJAM IS NOT NULL AND d.DTGLJAM > ?
    ORDER BY d.DTGLJAM ASC
    LIMIT ?`,
  sqlBoundary: `
    SELECT d.CKDJUALBBM, d.CKDNOZZLE, d.NURUT, d.NSTANDAWAL, d.NSTANDAKHIR,
           d.NVOLUME, d.NHARGAJUAL, d.NSUBTOTAL, d.CKDBBM, d.CKDTANGKI,
           d.VCOPEATOR, d.DTGLJAM, d.SUBAH, d.SEDIT,
           h.DTGLJUAL, h.NSHIFT, h.VCKET
    FROM tr_djualbbm d
    JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM
    WHERE d.DTGLJAM = ?`,
  map(raw, offsetMin) {
    const headers = new Map<string, NonNullable<Tables["sales_header"]>[number]>();
    const details: NonNullable<Tables["sales_detail"]> = [];
    let maxUtc: string | null = null;

    for (const r of raw) {
      const dtgljam = wibDateTimeToUtcIso(str(r.DTGLJAM), offsetMin);
      if (dtgljam === null) continue; // jaga-jaga; SQL sudah memfilter NULL
      if (maxUtc === null || dtgljam > maxUtc) maxUtc = dtgljam;

      const ckdjualbbm = String(r.CKDJUALBBM);
      if (!headers.has(ckdjualbbm)) {
        headers.set(ckdjualbbm, {
          ckdjualbbm,
          dtgljual: businessDate(str(r.DTGLJUAL)) ?? "1970-01-01",
          nshift: int(r.NSHIFT),
          vcket: str(r.VCKET),
        });
      }
      details.push({
        ckdjualbbm,
        ckdnozzle: String(r.CKDNOZZLE),
        nurut: int(r.NURUT) ?? 0,
        nstandawal: num(r.NSTANDAWAL),
        nstandakhir: num(r.NSTANDAKHIR),
        nvolume: num(r.NVOLUME),
        nhargajual: num(r.NHARGAJUAL),
        nsubtotal: num(r.NSUBTOTAL),
        ckdbbm: str(r.CKDBBM),
        ckdtangki: str(r.CKDTANGKI),
        vcopeator: str(r.VCOPEATOR),
        dtgljam,
        subah: int(r.SUBAH),
        sedit: int(r.SEDIT),
      });
    }
    return {
      tables: { sales_header: [...headers.values()], sales_detail: details },
      watermarkHigh: maxUtc,
      rowCount: raw.length,
    };
  },
};

// ---------------------------------------------------------------------------
// OPNAME (tr_dopnamebbm ⋈ tr_hopnamebbm)
// ---------------------------------------------------------------------------
const OPNAME: DateTimeDomain = {
  domain: "opname",
  mode: "datetime",
  sql: `
    SELECT d.CKDOPNBBM, d.CKDTANGKI, d.CKDBBM, d.NSTOCKBK, d.NSTOCKOP,
           d.NVOLSELISIH, d.DTGLJAM, h.DTAGLOPN, h.SBATAL
    FROM tr_dopnamebbm d
    JOIN tr_hopnamebbm h ON h.CKDOPNBBM = d.CKDOPNBBM
    WHERE d.DTGLJAM IS NOT NULL AND d.DTGLJAM > ?
    ORDER BY d.DTGLJAM ASC
    LIMIT ?`,
  sqlBoundary: `
    SELECT d.CKDOPNBBM, d.CKDTANGKI, d.CKDBBM, d.NSTOCKBK, d.NSTOCKOP,
           d.NVOLSELISIH, d.DTGLJAM, h.DTAGLOPN, h.SBATAL
    FROM tr_dopnamebbm d
    JOIN tr_hopnamebbm h ON h.CKDOPNBBM = d.CKDOPNBBM
    WHERE d.DTGLJAM = ?`,
  map(raw, offsetMin) {
    const rows: NonNullable<Tables["opname"]> = [];
    let maxUtc: string | null = null;
    for (const r of raw) {
      const dtgljam = wibDateTimeToUtcIso(str(r.DTGLJAM), offsetMin);
      if (dtgljam === null) continue;
      if (maxUtc === null || dtgljam > maxUtc) maxUtc = dtgljam;
      rows.push({
        ckdopnbbm: String(r.CKDOPNBBM),
        ckdtangki: String(r.CKDTANGKI),
        ckdbbm: str(r.CKDBBM),
        dtaglopn: businessDate(str(r.DTAGLOPN)),
        nstockbk: num(r.NSTOCKBK),
        nstockop: num(r.NSTOCKOP),
        nvolselisih: num(r.NVOLSELISIH),
        dtgljam,
        sbatal: int(r.SBATAL),
      });
    }
    return { tables: { opname: rows }, watermarkHigh: maxUtc, rowCount: raw.length };
  },
};

// ---------------------------------------------------------------------------
// DELIVERY (tr_terimabbm) — PK CKDTRM
// ---------------------------------------------------------------------------
const DELIVERY: DateTimeDomain = {
  domain: "delivery",
  mode: "datetime",
  sql: `
    SELECT CKDTRM, DTGLTRM, DTGLJAM, CNODO, NVOLDO, NVOLREAL, NVOLSELISIH,
           CNOPOL, VCSOPIR, CKDTANGKI, CKDBBM, SBATAL
    FROM tr_terimabbm
    WHERE DTGLJAM IS NOT NULL AND DTGLJAM > ?
    ORDER BY DTGLJAM ASC
    LIMIT ?`,
  sqlBoundary: `
    SELECT CKDTRM, DTGLTRM, DTGLJAM, CNODO, NVOLDO, NVOLREAL, NVOLSELISIH,
           CNOPOL, VCSOPIR, CKDTANGKI, CKDBBM, SBATAL
    FROM tr_terimabbm
    WHERE DTGLJAM = ?`,
  map(raw, offsetMin) {
    const rows: NonNullable<Tables["delivery"]> = [];
    let maxUtc: string | null = null;
    for (const r of raw) {
      const dtgljam = wibDateTimeToUtcIso(str(r.DTGLJAM), offsetMin);
      if (dtgljam === null) continue;
      if (maxUtc === null || dtgljam > maxUtc) maxUtc = dtgljam;
      rows.push({
        ckdtrm: String(r.CKDTRM),
        dtgltrm: businessDate(str(r.DTGLTRM)),
        dtgljam,
        cnodo: str(r.CNODO),
        nvoldo: num(r.NVOLDO),
        nvolreal: num(r.NVOLREAL),
        nvolselisih: num(r.NVOLSELISIH),
        cnopol: str(r.CNOPOL),
        vcsopir: str(r.VCSOPIR),
        ckdtangki: str(r.CKDTANGKI),
        ckdbbm: str(r.CKDBBM),
        sbatal: int(r.SBATAL),
      });
    }
    return { tables: { delivery: rows }, watermarkHigh: maxUtc, rowCount: raw.length };
  },
};

// ---------------------------------------------------------------------------
// CASH (tr_hkasbank ⋈ tr_dkasbank) — watermark DTGL (date), re-scan 7 hari
// ---------------------------------------------------------------------------
const CASH: DateDomain = {
  domain: "cash",
  mode: "date",
  sql: `
    SELECT h.CKDKB, h.DTGL, h.VCKET, h.SJNSTRANS, h.NTOTAL, h.VCREF, h.CTMPKAS,
           h.SBATAL, d.CKDPERK, d.NJUMLAH
    FROM tr_hkasbank h
    LEFT JOIN tr_dkasbank d ON d.CKDKB = h.CKDKB
    WHERE h.DTGL >= ?
    ORDER BY h.DTGL ASC, h.CKDKB ASC`,
  map(raw) {
    const headers = new Map<string, NonNullable<Tables["cash_header"]>[number]>();
    const details: NonNullable<Tables["cash_detail"]> = [];
    let maxDate: string | null = null;
    for (const r of raw) {
      const ckdkb = String(r.CKDKB);
      const dtgl = businessDate(str(r.DTGL)) ?? "1970-01-01";
      if (maxDate === null || dtgl > maxDate) maxDate = dtgl;
      if (!headers.has(ckdkb)) {
        headers.set(ckdkb, {
          ckdkb,
          dtgl,
          vcket: str(r.VCKET),
          sjnstrans: int(r.SJNSTRANS),
          ntotal: num(r.NTOTAL),
          vcref: str(r.VCREF),
          ctmpkas: str(r.CTMPKAS),
          sbatal: int(r.SBATAL),
        });
      }
      if (r.CKDPERK !== null && r.CKDPERK !== undefined) {
        details.push({
          ckdkb,
          ckdperk: str(r.CKDPERK),
          njumlah: num(r.NJUMLAH),
        });
      }
    }
    return {
      tables: { cash_header: [...headers.values()], cash_detail: details },
      watermarkHigh: maxDate,
      rowCount: raw.length,
    };
  },
};

// ---------------------------------------------------------------------------
// MASTERS — full sync
// ---------------------------------------------------------------------------
const MASTERS: MasterDomain = {
  domain: "masters",
  mode: "full",
  queries: [
    {
      table: "product",
      sql: "SELECT * FROM tm_bbm",
      map: (raw) =>
        raw.map((r) => {
          const perk: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            if (k.toUpperCase().startsWith("CKDPERK")) perk[k] = v;
          }
          return {
            ckdbbm: String(r.CKDBBM),
            vcnmbbm: str(r.VCNMBBM),
            nhrgjual: num(r.NHRGJUAL),
            perk_map: Object.keys(perk).length ? perk : null,
          };
        }),
    },
    {
      table: "nozzle",
      sql: "SELECT CKDNOZZLE, CKDPOMPA, CKDTANGKI FROM tm_nozzle",
      map: (raw) =>
        raw.map((r) => ({
          ckdnozzle: String(r.CKDNOZZLE),
          ckdpompa: str(r.CKDPOMPA),
          ckdtangki: str(r.CKDTANGKI),
        })),
    },
    {
      table: "tangki",
      sql: "SELECT CKDTANGKI, CKDBBM, VCNMTANGKI FROM tm_tangki",
      map: (raw) =>
        raw.map((r) => ({
          ckdtangki: String(r.CKDTANGKI),
          ckdbbm: str(r.CKDBBM),
          vcnmtangki: str(r.VCNMTANGKI),
        })),
    },
    {
      // Smoke-test 2026-06-11: kolom induk BUKAN `CKDINDUK` → SELECT * + deteksi
      // kolom defensif (nama persis tm_perk belum di-DESCRIBE; jangan tebak lagi).
      table: "account",
      sql: "SELECT * FROM tm_perk",
      map: (raw) =>
        raw.map((r) => {
          const keys = Object.keys(r);
          const indukKey = keys.find((k) => k.toUpperCase().includes("INDUK"));
          const nameKey =
            keys.find((k) => k.toUpperCase() === "VCNMPERK") ??
            keys.find((k) => k.toUpperCase().startsWith("VCNM"));
          return {
            ckdperk: String(r.CKDPERK),
            vcnmperk: nameKey ? str(r[nameKey]) : null,
            ckdinduk: indukKey ? str(r[indukKey]) : null,
          };
        }),
    },
  ],
};

export const DATETIME_DOMAINS: DateTimeDomain[] = [SALES, OPNAME, DELIVERY];
export const CASH_DOMAIN = CASH;
export const MASTERS_DOMAIN = MASTERS;
