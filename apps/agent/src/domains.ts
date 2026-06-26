import type { Domain, IngestPayload } from "@solamax/shared";
import {
  businessDate,
  ctglToBusinessDate,
  int,
  num,
  str,
  wibDateTimeToUtcIso,
} from "./transform.js";

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

/**
 * Domain berbasis DTGL (date) — kas (dorman sejak 2019) & penebusan DO. Watermark
 * tanggal-only → re-scan window `>=` + UPSERT by PK (idempoten saat re-pull).
 */
export interface DateDomain {
  domain: Extract<Domain, "cash" | "tebus">;
  mode: "date";
  sql: string; // `?1` = cutoff date "YYYY-MM-DD"
  map(raw: Raw[]): MappedPage;
}

/**
 * Domain deposit — FULL SYNC tiap siklus (tr_deposit kecil, ~6k baris). Tanpa
 * watermark: tarik SELURUH baris → nol gap pembatalan (SBATAL flip kapan pun
 * tertangkap; EasyMax flag-batal, bukan hard-delete). UPSERT by (unit_id,ckddepo).
 */
export interface DepositDomain {
  domain: Extract<Domain, "deposit">;
  mode: "full";
  table: "deposit";
  sql: string;
  map(raw: Raw[]): NonNullable<Tables["deposit"]>;
}

/**
 * Domain EDC (vw_edc3) — incremental per `ctgl` (tanggal bisnis EasyMax) +
 * rescan window. Backend REPLACE per (unit_id, business_date) tiap rescan
 * (EDC final per hari; tr_edc tanpa SBATAL → replace yang menangkap koreksi).
 * `?1` = startCtgl "YYYYMMDD".
 */
export interface EdcDomain {
  domain: Extract<Domain, "edc">;
  mode: "ctgl-window";
  table: "edc";
  sql: string;
  map(raw: Raw[], offsetMin: number): {
    rows: NonNullable<Tables["edc"]>;
    businessDateHigh: string | null;
  };
}

/**
 * Domain pelanggan (union dua view) — incremental per `DTGL` (header bersih) +
 * rescan window. `vw_jualplg` (JP) ⊎ `vw_usevouc` (UV); SUM per CKDPLG di
 * dashboard. Nama `VCNMPLG` denormal dari view. Backend REPLACE per business_date.
 * `?1` = startDate "YYYY-MM-DD".
 */
export interface PelangganDomain {
  domain: Extract<Domain, "pelanggan">;
  mode: "dtgl-window";
  saleSql: string;
  voucherSql: string;
  mapSale(raw: Raw[]): {
    rows: NonNullable<Tables["pelanggan_sale"]>;
    dtglHigh: string | null;
  };
  mapVoucher(raw: Raw[]): {
    rows: NonNullable<Tables["voucher_sale"]>;
    dtglHigh: string | null;
  };
}

/** Domain master — full sync, tanpa watermark. */
export interface MasterDomain {
  domain: Extract<Domain, "masters">;
  mode: "full";
  queries: Array<{ table: keyof Tables; sql: string; map(raw: Raw[]): unknown[] }>;
}

/**
 * Domain realtank — snapshot ATG keadaan-kini (full sync tiap siklus, tanpa
 * watermark). `map` butuh offset TZ untuk konversi `dtanggaljam` WIB→UTC.
 */
export interface RealtankDomain {
  domain: Extract<Domain, "realtank">;
  mode: "full";
  table: "real_tank";
  sql: string;
  map(raw: Raw[], offsetMin: number): NonNullable<Tables["real_tank"]>;
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
// SALES RE-SYNC (anti-stale) — berbasis BUSINESS-DATE h.DTGLJUAL, BUKAN DTGLJAM
// ---------------------------------------------------------------------------
/**
 * Re-sync & rescan SALES per business-date. **KRITIS: TANPA predikat
 * `DTGLJAM IS NOT NULL`.** Temuan probe9 (FASE 1): baris shift-3 yang di-key esok
 * pagi punya `DTGLJAM = NULL` (mis. 15-Jun shift-3 = 130.247.852) — sync incremental
 * `DTGLJAM > ?` membuangnya SELAMANYA (filter NULL + di bawah watermark). Filter
 * berbasis `h.DTGLJUAL` menangkapnya. Kolom Postgres `sales_detail.dtgljam` NOT NULL
 * → untuk baris NULL kita **sintesis = DTGLJUAL tengah-malam WIB** (Omset di-group per
 * `header.dtgljual`, bukan detail `dtgljam`, jadi sintesis tak mengubah angka & tetap
 * jatuh di tanggal-bisnis yang sama). CAVEAT konsumen `dtgljam`: query "terjual sejak
 * opname" (dashboard `getLiveTankReconciliation`, `sd.dtgljam > opname.dtgljam`) bisa
 * sedikit under-count baris eks-NULL bila opname diambil TENGAH hari (midnight sintetis
 * < jam opname). Dampak kecil (opname umumnya awal hari); didokumentasikan di GO-LIVE.
 * Idempoten via UPSERT
 * (unit_id, ckdjualbbm, ckdnozzle, nurut) + header (unit_id, ckdjualbbm); TAK memajukan
 * watermark DTGLJAM. `?1`=DTGLJUAL ≥ (inklusif), `?2`=DTGLJUAL < (eksklusif).
 */
export const SALES_RESYNC = {
  sql: `
    SELECT d.CKDJUALBBM, d.CKDNOZZLE, d.NURUT, d.NSTANDAWAL, d.NSTANDAKHIR,
           d.NVOLUME, d.NHARGAJUAL, d.NSUBTOTAL, d.CKDBBM, d.CKDTANGKI,
           d.VCOPEATOR, d.DTGLJAM, d.SUBAH, d.SEDIT,
           h.DTGLJUAL, h.NSHIFT, h.VCKET
    FROM tr_hjualbbm h
    JOIN tr_djualbbm d ON d.CKDJUALBBM = h.CKDJUALBBM
    WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?
    ORDER BY h.DTGLJUAL ASC`,
  map(raw: Raw[], offsetMin: number): {
    tables: {
      sales_header: NonNullable<Tables["sales_header"]>;
      sales_detail: NonNullable<Tables["sales_detail"]>;
    };
  } {
    const headers = new Map<string, NonNullable<Tables["sales_header"]>[number]>();
    const details: NonNullable<Tables["sales_detail"]> = [];
    for (const r of raw) {
      const bd = businessDate(str(r.DTGLJUAL));
      if (bd === null) continue; // tanpa business-date tak bisa ditempatkan
      // DTGLJAM asli bila ada & valid; jika NULL/kosong → SINTESIS tengah-malam WIB
      // dari DTGLJUAL (jaga dtgljam NOT NULL tanpa mengubah tanggal-bisnis).
      const rawTs = str(r.DTGLJAM);
      const dtgljam =
        (rawTs ? wibDateTimeToUtcIso(rawTs, offsetMin) : null) ??
        wibDateTimeToUtcIso(`${bd} 00:00:00`, offsetMin)!;

      const ckdjualbbm = String(r.CKDJUALBBM);
      if (!headers.has(ckdjualbbm)) {
        headers.set(ckdjualbbm, {
          ckdjualbbm,
          dtgljual: bd,
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
    return { tables: { sales_header: [...headers.values()], sales_detail: details } };
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
    SELECT CKDTRM, DTGLTRM, DTGLJAM, CNODO, CNOSO, NVOLDO, NVOLREAL, NVOLSELISIH,
           CNOPOL, VCSOPIR, CKDTANGKI, CKDBBM, SBATAL
    FROM tr_terimabbm
    WHERE DTGLJAM IS NOT NULL AND DTGLJAM > ?
    ORDER BY DTGLJAM ASC
    LIMIT ?`,
  sqlBoundary: `
    SELECT CKDTRM, DTGLTRM, DTGLJAM, CNODO, CNOSO, NVOLDO, NVOLREAL, NVOLSELISIH,
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
        cnoso: str(r.CNOSO),
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
// DEPOSIT (tr_deposit) — prabayar pelanggan; FULL SYNC (tabel kecil ~6k).
// PK CKDDEPO. Rekon terbukti eksak 5 hari (FASE 0.5d): 15/6 131.084.492·7,
// 16/6 4.000.000·2, 17/6 47.000.000·6, 18/6 76.601.236·3 (non-batal).
// ---------------------------------------------------------------------------
const DEPOSIT: DepositDomain = {
  domain: "deposit",
  mode: "full",
  table: "deposit",
  sql: `
    SELECT CKDDEPO, DTGL, CKDPLG, NTOTAL, NSALDO, SBATAL, VCKET
    FROM tr_deposit
    ORDER BY DTGL ASC, CKDDEPO ASC`,
  map(raw) {
    const rows: NonNullable<Tables["deposit"]> = [];
    for (const r of raw) {
      rows.push({
        ckddepo: String(r.CKDDEPO),
        dtgl: businessDate(str(r.DTGL)) ?? "1970-01-01",
        ckdplg: str(r.CKDPLG),
        ntotal: num(r.NTOTAL),
        nsaldo: num(r.NSALDO),
        sbatal: int(r.SBATAL),
        vcket: str(r.VCKET),
      });
    }
    return rows;
  },
};

// ---------------------------------------------------------------------------
// EDC (vw_edc3) — incremental per ctgl; channel via tm_card (CKDKARTU→CKDCARD).
// Rekon terbukti (FASE 0.5d): ctgl 20260614 channel-sum 90.974.097 (blank 3.132.398),
// 20260617 116.565.499 (blank 3.695.046). business_date dari ctgl.
// ---------------------------------------------------------------------------
const EDC: EdcDomain = {
  domain: "edc",
  mode: "ctgl-window",
  table: "edc",
  sql: `
    SELECT TanggalJam, ctgl, cshift, CKDKARTU, TotalHarga, Liter, Jenis,
           CNOTRACE, NoNozle, JrnKey
    FROM vw_edc3
    WHERE ctgl >= ?
    ORDER BY ctgl ASC, TanggalJam ASC`,
  map(raw, offsetMin) {
    const rows: NonNullable<Tables["edc"]> = [];
    let bdHigh: string | null = null;
    for (const r of raw) {
      const bd = ctglToBusinessDate(str(r.ctgl));
      if (bd === null) continue; // ctgl wajib (tanggal bisnis)
      if (bdHigh === null || bd > bdHigh) bdHigh = bd;
      const tj = wibDateTimeToUtcIso(str(r.TanggalJam), offsetMin);
      if (tj === null) continue; // butuh waktu rekam valid
      rows.push({
        business_date: bd,
        cshift: str(r.cshift),
        tanggaljam: tj,
        ckdkartu: str(r.CKDKARTU), // null = blank-card
        total: num(r.TotalHarga),
        liter: num(r.Liter),
        jenis: int(r.Jenis),
        cnotrace: str(r.CNOTRACE),
        nonozle: str(r.NoNozle),
        jrnkey: int(r.JrnKey),
      });
    }
    return { rows, businessDateHigh: bdHigh };
  },
};

// ---------------------------------------------------------------------------
// PELANGGAN (vw_jualplg ⊎ vw_usevouc) — penjualan tempo per pelanggan.
// business_date = DTGL (header bersih). vcnmplg denormal dari view.
// Rekon terbukti (FASE 0.5): 14/6 111.502.580/7.583,30L/18; 17/6 155.113.552/48.
// ---------------------------------------------------------------------------
const PELANGGAN: PelangganDomain = {
  domain: "pelanggan",
  mode: "dtgl-window",
  // Sumber view `vw_jualplg` — path TERVALIDASI PENUH (dry-run rekon eksak 14–18 Jun).
  // Base-table sempat dicoba (probe FASE05f) tapi DI-REVERT: hanya ~15% lebih cepat,
  // TAK menyelesaikan lock (bottleneck = join `tr_djualplg` tanpa index `CKDJUALPLG`,
  // tak bisa diubah di EasyMax read-only) & divergen dari path tervalidasi. Mitigasi
  // latensi/lock = window 3-hari + poll 15 mnt; lock-gate dijawab oleh probe FASE05g
  // (concurrent_insert + Data_free) yang dijalankan Dion di mesin SPBU.
  // `?1`=batas bawah inklusif, `?2`=batas atas EKSKLUSIF. Backfill memecah rentang
  // jadi window (mis. 7 hari) → tiap query vw_jualplg ter-bound (filter DTGL pushdown,
  // ringan) alih-alih materialisasi 288k sekaligus (stall di mesin SPBU 21 Jun).
  // Window inkremental/dry-run pakai `?2`=sentinel jauh ('9999-12-31') = tanpa batas atas.
  saleSql: `
    SELECT DTGL, CKDPLG, VCNMPLG, Liter, TotalHarga, CKDJUALPLG, NSHIFT, SBATAL, CKDBBM
    FROM vw_jualplg
    WHERE DTGL >= ? AND DTGL < ?
    ORDER BY DTGL ASC`,
  voucherSql: `
    SELECT DTGL, CKDPLG, VCNMPLG, liter, NJUMLAHUSE, CKDUSEVOUC, NSHIFT, SBATAL, CKDBBM
    FROM vw_usevouc
    WHERE DTGL >= ? AND DTGL < ?
    ORDER BY DTGL ASC`,
  mapSale(raw) {
    const rows: NonNullable<Tables["pelanggan_sale"]> = [];
    let dtglHigh: string | null = null;
    for (const r of raw) {
      const bd = businessDate(str(r.DTGL));
      if (bd === null) continue; // DTGL header wajib
      if (dtglHigh === null || bd > dtglHigh) dtglHigh = bd;
      rows.push({
        business_date: bd,
        ckdplg: str(r.CKDPLG),
        vcnmplg: str(r.VCNMPLG),
        ckdjualplg: str(r.CKDJUALPLG),
        ckdbbm: str(r.CKDBBM),
        nshift: int(r.NSHIFT),
        liter: num(r.Liter),
        total: num(r.TotalHarga),
        sbatal: int(r.SBATAL),
      });
    }
    return { rows, dtglHigh };
  },
  mapVoucher(raw) {
    const rows: NonNullable<Tables["voucher_sale"]> = [];
    let dtglHigh: string | null = null;
    for (const r of raw) {
      const bd = businessDate(str(r.DTGL));
      if (bd === null) continue;
      if (dtglHigh === null || bd > dtglHigh) dtglHigh = bd;
      rows.push({
        business_date: bd,
        ckdplg: str(r.CKDPLG),
        vcnmplg: str(r.VCNMPLG),
        ckdusevouc: str(r.CKDUSEVOUC),
        ckdbbm: str(r.CKDBBM),
        nshift: int(r.NSHIFT),
        liter: num(r.liter),
        total: num(r.NJUMLAHUSE),
        sbatal: int(r.SBATAL),
      });
    }
    return { rows, dtglHigh };
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
    {
      // Master kartu/channel EDC (nama channel di laporan). PK CKDCARD.
      table: "card",
      sql: "SELECT CKDCARD, VCNMCARD, CKDBANK, CGL FROM tm_card",
      map: (raw) =>
        raw.map((r) => ({
          ckdcard: String(r.CKDCARD),
          vcnmcard: str(r.VCNMCARD),
          ckdbank: str(r.CKDBANK),
          cgl: str(r.CGL),
        })),
    },
  ],
};

// ---------------------------------------------------------------------------
// REALTANK (vw_realtm) — snapshot ATG keadaan-kini, 1 baris per tangki.
// vw_realtm = view EasyMax yg dibaca layar ATG: gabung tb_realtank + tm_tangki,
// membawa CKDTANGKI (kunci natural, tanpa tebak id) + NKAPASITAS otoritatif.
// ---------------------------------------------------------------------------
const REALTANK: RealtankDomain = {
  domain: "realtank",
  mode: "full",
  table: "real_tank",
  sql: `
    SELECT CKDTANGKI, NKAPASITAS, NTINGGI, NVOLUME, NSUHU,
           NTINGGIAIR, NVOLUMEAIR, NSTATUS, dtanggaljam
    FROM vw_realtm`,
  map(raw, offsetMin) {
    const rows: NonNullable<Tables["real_tank"]> = [];
    for (const r0 of raw) {
      // vw_realtm mengembalikan nama kolom CASE CAMPURAN: `CKDTANGKI` huruf besar
      // tapi `nkapasitas`/`ntinggi`/… huruf kecil (case definisi VIEW, bukan case
      // query). Normalkan semua key ke lowercase agar akses deterministik.
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r0)) r[k.toLowerCase()] = v;

      const ckdtangki = str(r.ckdtangki);
      if (ckdtangki === null || ckdtangki.trim() === "") continue; // butuh kode tangki
      const dt = wibDateTimeToUtcIso(str(r.dtanggaljam), offsetMin);
      if (dt === null) continue; // butuh waktu pembacaan valid
      rows.push({
        ckdtangki: ckdtangki.trim(),
        nkapasitas: num(r.nkapasitas),
        ntinggi: num(r.ntinggi),
        nvolume: num(r.nvolume),
        nsuhu: num(r.nsuhu),
        ntinggiair: num(r.ntinggiair),
        nvolumeair: num(r.nvolumeair),
        nstatus: int(r.nstatus),
        dtanggaljam: dt,
      });
    }
    return rows;
  },
};

// ---------------------------------------------------------------------------
// TEBUS (tr_htebus ⋈ tr_dtebus) — Penebusan DO; watermark DTGLTBS (date),
// re-scan 7 hari. Sumber kolom "Penebusan DO" + basis running-balance DO Awal/
// Sisa. CATATAN: tr_dtebus.NSISA = KOLOM MATI (selalu = NVOLUME; EasyMax hitung
// sisa live) → tarik NVOLUME saja. SBATAL ditarik apa adanya (difilter di query
// dashboard). Pola identik CASH (header⋈detail, dedupe header by CKDTBS).
// ---------------------------------------------------------------------------
const TEBUS: DateDomain = {
  domain: "tebus",
  mode: "date",
  sql: `
    SELECT h.CKDTBS, h.DTGLTBS, h.CNOSO, h.SBATAL, d.CKDBBM, d.NVOLUME
    FROM tr_htebus h
    LEFT JOIN tr_dtebus d ON d.CKDTBS = h.CKDTBS
    WHERE h.DTGLTBS >= ?
    ORDER BY h.DTGLTBS ASC, h.CKDTBS ASC`,
  map(raw) {
    const headers = new Map<string, NonNullable<Tables["tebus_header"]>[number]>();
    // Detail di-AGREGAT per (ckdtbs, ckdbbm): satu DO bisa punya BANYAK baris
    // tr_dtebus untuk produk yang sama (per kompartemen) → tanpa agregasi, satu
    // batch UPSERT memuat dua baris ber-conflict-key sama → Postgres 21000
    // ("ON CONFLICT … cannot affect row a second time"). Laporan hanya butuh Σ
    // NVOLUME per produk → menjumlah duplikat = benar.
    const details = new Map<string, NonNullable<Tables["tebus_detail"]>[number]>();
    let maxDate: string | null = null;
    for (const r of raw) {
      const ckdtbs = String(r.CKDTBS);
      const dtgltbs = businessDate(str(r.DTGLTBS)) ?? "1970-01-01";
      if (maxDate === null || dtgltbs > maxDate) maxDate = dtgltbs;
      if (!headers.has(ckdtbs)) {
        headers.set(ckdtbs, { ckdtbs, dtgltbs, cnoso: str(r.CNOSO), sbatal: int(r.SBATAL) });
      }
      if (r.CKDBBM !== null && r.CKDBBM !== undefined) {
        const ckdbbm = str(r.CKDBBM);
        const key = `${ckdtbs} ${ckdbbm ?? ""}`;
        const vol = num(r.NVOLUME);
        const ex = details.get(key);
        if (ex) {
          ex.nvolume = (ex.nvolume ?? 0) + (vol ?? 0);
        } else {
          details.set(key, { ckdtbs, ckdbbm, nvolume: vol });
        }
      }
    }
    return {
      tables: { tebus_header: [...headers.values()], tebus_detail: [...details.values()] },
      watermarkHigh: maxDate,
      rowCount: raw.length,
    };
  },
};

// ---------------------------------------------------------------------------
// TERA (tabel `tera`) — kalibrasi/test-dispense nozzle. Watermark TanggalJam
// (datetime), incremental + safety window. Sumber kolom "Tera (L)" + komponen
// Penjualan_BERSIH (jual KOTOR − tera) di Gain/Losses harian (selaras RESUME).
// Tabel kecil (~3.8k baris); satu query per siklus, batch dispatch by batchSize.
// ---------------------------------------------------------------------------
/**
 * Domain tera — single-table, watermark TanggalJam (datetime). `?1` = cutoff WIB
 * string. Floor `TanggalJam >= 2020-01-01` membuang baris 1980 yang akan
 * meracuni MAX(watermark). Produk DI-RESOLVE di MySQL lewat tangki → `tm_bbm`
 * (dashboard memetakan ckdbbm→nama by VCNMBBM, sama seperti domain lain).
 */
export interface TeraDomain {
  domain: Extract<Domain, "tera">;
  mode: "datetime-single";
  sql: string;
  map(raw: Raw[], offsetMin: number): {
    rows: NonNullable<Tables["tera"]>;
    watermarkHigh: string | null;
  };
}

const TERA: TeraDomain = {
  domain: "tera",
  mode: "datetime-single",
  // Kunci join TERKONFIRMASI via PROBE mesin SPBU (SHOW COLUMNS, 2026-06-26):
  // nama kolom EasyMax = `NoNozle` (satu 'z') & `SalTangki` (ber-'l') — wiki keliru
  // di KEDUA nama. `tera.SalTangki` (tinyint(4) unsigned NOT NULL, indeks tangki
  // 1–7) = `tm_tangki.CKDTANGKI2` (1–7, terkonfirmasi P3) → `tm_tangki.CKDBBM`.
  // LEFT JOIN: kalau suatu baris ber-SalTangki tak terpetakan, ckdbbm = NULL tapi
  // baris tetap tersync (idempoten by surrogate). CAST utk toleransi tipe.
  // Identifier mentah (NoNozle/IDPompa/SalTangki) disimpan utk audit. Resolve
  // produk BY NAME via master (dashboard memetakan ckdbbm→VCNMBBM). Validasi
  // ANGKA vs PNG (24/25 Jun) lewat dry-run/probe P4' sebelum produksi.
  sql: `
    SELECT t.TanggalJam AS TanggalJam, t.NoNozle AS NoNozle, t.IDPompa AS IDPompa,
           t.SalTangki AS SalTangki, t.Jenis AS Jenis, t.Liter AS Liter,
           t.TotalHarga AS TotalHarga, tg.CKDBBM AS CKDBBM
    FROM tera t
    LEFT JOIN tm_tangki tg ON CAST(tg.CKDTANGKI2 AS UNSIGNED) = t.SalTangki
    WHERE t.TanggalJam IS NOT NULL
      AND t.TanggalJam >= '2020-01-01 00:00:00'
      AND t.TanggalJam > ?
    ORDER BY t.TanggalJam ASC`,
  map(raw, offsetMin) {
    const rows: NonNullable<Tables["tera"]> = [];
    let maxUtc: string | null = null;
    for (const r of raw) {
      const wib = str(r.TanggalJam);
      const tanggaljam = wibDateTimeToUtcIso(wib, offsetMin);
      if (tanggaljam === null) continue; // butuh waktu rekam valid
      if (maxUtc === null || tanggaljam > maxUtc) maxUtc = tanggaljam;
      rows.push({
        business_date: businessDate(wib) ?? "1970-01-01",
        tanggaljam,
        no_nozzle: str(r.NoNozle),
        id_pompa: int(r.IDPompa),
        sa_tangki: int(r.SalTangki),
        jenis: int(r.Jenis),
        ckdbbm: str(r.CKDBBM),
        liter: num(r.Liter),
        total: num(r.TotalHarga),
      });
    }
    return { rows, watermarkHigh: maxUtc };
  },
};

export const DATETIME_DOMAINS: DateTimeDomain[] = [SALES, OPNAME, DELIVERY];
export const CASH_DOMAIN = CASH;
export const TEBUS_DOMAIN = TEBUS;
export const TERA_DOMAIN = TERA;
export const DEPOSIT_DOMAIN = DEPOSIT;
export const EDC_DOMAIN = EDC;
export const PELANGGAN_DOMAIN = PELANGGAN;
export const MASTERS_DOMAIN = MASTERS;
export const REALTANK_DOMAIN = REALTANK;
