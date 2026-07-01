import { describe, expect, it } from "vitest";
import {
  CASH_DOMAIN,
  CASH_RESYNC,
  DATETIME_DOMAINS,
  DELIVERY_RESYNC,
  DEPOSIT_DOMAIN,
  EDC_DOMAIN,
  EDC_RESYNC,
  MASTERS_DOMAIN,
  OPNAME_RESYNC,
  PELANGGAN_DOMAIN,
  REALTANK_DOMAIN,
  SALES_RESYNC,
  TEBUS_DOMAIN,
  TEBUS_RESYNC,
  TERA_RESYNC,
  TERRA_RESMI_DOMAIN,
} from "./domains.js";
import { tzOffsetMinutes, wibDateTimeToUtcIso } from "./transform.js";

const WIB = tzOffsetMinutes("Asia/Pontianak");
const SALES = DATETIME_DOMAINS.find((d) => d.domain === "sales")!;

describe("SALES.map", () => {
  it("dedup header per CKDJUALBBM, kumpulkan detail, watermark = max DTGLJAM (UTC)", () => {
    const page = SALES.map(
      [
        {
          CKDJUALBBM: "H1", CKDNOZZLE: "N1", NURUT: 1, NVOLUME: "50",
          NHARGAJUAL: "10000", NSUBTOTAL: "500000", CKDBBM: "P1", CKDTANGKI: "T1",
          NSTANDAWAL: "100", NSTANDAKHIR: "150", VCOPEATOR: "-",
          DTGLJAM: "2026-06-11 14:30:00", SUBAH: "0", SEDIT: "0",
          DTGLJUAL: "2026-06-11 00:00:00", NSHIFT: "2", VCKET: null,
        },
        {
          CKDJUALBBM: "H1", CKDNOZZLE: "N2", NURUT: 1, NVOLUME: "20",
          NHARGAJUAL: "10000", NSUBTOTAL: "200000", CKDBBM: "P1", CKDTANGKI: "T1",
          NSTANDAWAL: "0", NSTANDAKHIR: "20", VCOPEATOR: "-",
          DTGLJAM: "2026-06-11 15:00:00", SUBAH: "0", SEDIT: "0",
          DTGLJUAL: "2026-06-11 00:00:00", NSHIFT: "2", VCKET: null,
        },
      ],
      WIB,
    );
    expect(page.tables.sales_header).toHaveLength(1);
    expect(page.tables.sales_detail).toHaveLength(2);
    expect(page.tables.sales_header![0]!.nshift).toBe(2);
    expect(page.tables.sales_detail![0]!.dtgljam).toBe("2026-06-11T07:30:00.000Z");
    expect(page.watermarkHigh).toBe("2026-06-11T08:00:00.000Z"); // 15:00 WIB
    expect(page.rowCount).toBe(2);
  });
});

describe("CASH.map", () => {
  it("LEFT JOIN: header dedup, detail hanya bila CKDPERK ada, watermark = max DTGL", () => {
    const page = CASH_DOMAIN.map([
      {
        CKDKB: "K1", DTGL: "2019-04-17", VCKET: "beli ATK", SJNSTRANS: "2",
        NTOTAL: "50000", VCREF: null, CTMPKAS: "KAS", SBATAL: "0",
        CKDPERK: "5101", NJUMLAH: "50000",
      },
      {
        CKDKB: "K2", DTGL: "2019-04-10", VCKET: "header tanpa detail",
        SJNSTRANS: "2", NTOTAL: "0", VCREF: null, CTMPKAS: "KAS", SBATAL: "0",
        CKDPERK: null, NJUMLAH: null,
      },
    ]);
    expect(page.tables.cash_header).toHaveLength(2);
    expect(page.tables.cash_detail).toHaveLength(1); // K2 tak punya CKDPERK
    expect(page.watermarkHigh).toBe("2019-04-17");
  });
});

describe("TEBUS.map (tr_htebus ⋈ tr_dtebus — header dedup, detail agregat per produk)", () => {
  it("AGREGAT detail per (CKDTBS,CKDBBM): cegah dup conflict-key (Postgres 21000)", () => {
    const page = TEBUS_DOMAIN.map([
      // T1: dua baris produk SAMA (BB-03) → harus dijumlah jadi 1 detail 40000.
      { CKDTBS: "T1", DTGLTBS: "2026-06-24", SBATAL: "0", CKDBBM: "BB-03", NVOLUME: "32000" },
      { CKDTBS: "T1", DTGLTBS: "2026-06-24", SBATAL: "0", CKDBBM: "BB-03", NVOLUME: "8000" },
      // T1: produk lain (BB-08) → detail terpisah.
      { CKDTBS: "T1", DTGLTBS: "2026-06-24", SBATAL: "0", CKDBBM: "BB-08", NVOLUME: "8000" },
      // T2: header lain.
      { CKDTBS: "T2", DTGLTBS: "2026-06-18", SBATAL: "0", CKDBBM: "BB-07", NVOLUME: "16000" },
    ]);
    expect(page.tables.tebus_header).toHaveLength(2); // T1, T2
    const det = page.tables.tebus_detail!;
    // T1/BB-03 ter-agregat → satu baris, nvolume = 32000+8000.
    const t1bb03 = det.filter((d) => d.ckdtbs === "T1" && d.ckdbbm === "BB-03");
    expect(t1bb03).toHaveLength(1);
    expect(t1bb03[0]!.nvolume).toBe(40000);
    // Tak ada dua baris dengan (ckdtbs,ckdbbm) sama (invarian anti-21000).
    const keys = det.map((d) => `${d.ckdtbs}|${d.ckdbbm}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(det).toHaveLength(3); // T1/BB-03, T1/BB-08, T2/BB-07
    expect(page.watermarkHigh).toBe("2026-06-24");
  });
});

describe("TERRA_RESMI.map (ledger tr_hterra ⋈ tr_dterra — business_date=DTGLTERRA, DTGLJAM→UTC)", () => {
  it("business_date dari DTGLTERRA (bukan jam pour); dtgljam WIB→UTC; field & sbatal ter-capture", () => {
    const rows = TERRA_RESMI_DOMAIN.map(
      [
        // 17/6 sesi resmi — DEXLITE (BB-06) nozzle NZ-31.
        { CKDTERRA: "NT202600036", DTGLTERRA: "2026-06-17", NSHIFT: "2", CKDJUALBBM: "JB202600503",
          SBATAL: "0", CKDNOZZLE: "NZ-31", CKDTANGKI: "T-01", CKDBBM: "BB-06",
          NVOLUME: "20", NHARGA: "23500", NTOTAL: "470000", DTGLJAM: "2026-06-17 15:46:25" },
        // PERTALITE (BB-07) nozzle NZ-18 (konsolidasi 41 L).
        { CKDTERRA: "NT202600036", DTGLTERRA: "2026-06-17", NSHIFT: "2", CKDJUALBBM: "JB202600503",
          SBATAL: "0", CKDNOZZLE: "NZ-18", CKDTANGKI: "T-06", CKDBBM: "BB-07",
          NVOLUME: "41", NHARGA: "10000", NTOTAL: "410000", DTGLJAM: "2026-06-17 17:00:23" },
      ],
      WIB,
    );
    expect(rows).toHaveLength(2);
    const r0 = rows[0]!;
    expect(r0.business_date).toBe("2026-06-17"); // = DTGLTERRA, bukan tanggal DTGLJAM
    expect(r0.ckdterra).toBe("NT202600036");
    expect(r0.ckdnozzle).toBe("NZ-31");
    expect(r0.ckdbbm).toBe("BB-06");
    expect(r0.nvolume).toBe(20);
    expect(r0.ntotal).toBe(470000);
    expect(r0.sbatal).toBe(0);
    expect(r0.ckdjualbbm).toBe("JB202600503");
    expect(r0.dtgljam).toBe(wibDateTimeToUtcIso("2026-06-17 15:46:25", WIB));
    // Σ ntotal ledger 17/6 (DEXLITE+PERTALITE parsial) — basis B Rincian (oracle 1.106.200 penuh).
    expect(rows.reduce((s, r) => s + (r.ntotal ?? 0), 0)).toBe(880000);
  });
});

describe("DEPOSIT.map (tr_deposit — full-sync, PK CKDDEPO)", () => {
  it("map baris (array), sbatal int ter-capture, ckdplg trim", () => {
    const rows = DEPOSIT_DOMAIN.map([
      {
        CKDDEPO: "DP202600522", DTGL: "2026-06-17", CKDPLG: "PLG2287",
        NTOTAL: "20000000", NSALDO: "0", SBATAL: "0",
        VCKET: "DEPOSIT SAKTI LANGGENG PER 17 JUNI 2026",
      },
      {
        CKDDEPO: "DP202600400", DTGL: "2026-06-10", CKDPLG: "PLG0001",
        NTOTAL: "1000000", NSALDO: "500000", SBATAL: "1", VCKET: "batal",
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ckddepo: "DP202600522", dtgl: "2026-06-17", ckdplg: "PLG2287",
      ntotal: 20000000, nsaldo: 0, sbatal: 0,
    });
    expect(rows[1]!.sbatal).toBe(1); // pembatalan ter-capture (full-sync = nol gap)
  });
});

describe("EDC.map (vw_edc3 — business_date dari ctgl, blank-card = ckdkartu null)", () => {
  it("map ctgl→business_date, TanggalJam WIB→UTC, blank CKDKARTU → null", () => {
    const { rows, businessDateHigh } = EDC_DOMAIN.map(
      [
        {
          TanggalJam: "2026-06-14 15:00:00", ctgl: "20260614", cshift: "2",
          CKDKARTU: "QR01", TotalHarga: "42124934", Liter: "0", Jenis: "5",
          CNOTRACE: "ABC123", NoNozle: "3", JrnKey: "202606141",
        },
        {
          TanggalJam: "2026-06-15 02:00:00", ctgl: "20260614", cshift: "3",
          CKDKARTU: "", TotalHarga: "100000", Liter: "0", Jenis: "5",
          CNOTRACE: "", NoNozle: "5", JrnKey: "202606142",
        },
      ],
      WIB,
    );
    expect(rows).toHaveLength(2);
    expect(businessDateHigh).toBe("2026-06-14");
    expect(rows[0]).toMatchObject({
      business_date: "2026-06-14", ckdkartu: "QR01", total: 42124934, cshift: "2",
    });
    expect(rows[0]!.tanggaljam).toBe("2026-06-14T08:00:00.000Z"); // 15:00 WIB→UTC
    // baris shift-3 lewat tengah malam (15/6 02:00) tetap business_date 14/6 (ctgl)
    expect(rows[1]!.business_date).toBe("2026-06-14");
    expect(rows[1]!.ckdkartu).toBeNull(); // blank-card
  });
});

describe("PELANGGAN map (vw_jualplg & vw_usevouc — DTGL header, vcnmplg denormal)", () => {
  it("mapSale: business_date dari DTGL, total=TotalHarga, dtglHigh", () => {
    const { rows, dtglHigh } = PELANGGAN_DOMAIN.mapSale([
      {
        DTGL: "2026-06-14", CKDPLG: "PLG2952", VCNMPLG: "PT INDOMARCO P.",
        Liter: "3960.34", TotalHarga: "73890378", CKDJUALPLG: "JP1",
        NSHIFT: "2", SBATAL: "0", CKDBBM: "BB-07",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(dtglHigh).toBe("2026-06-14");
    expect(rows[0]).toMatchObject({
      business_date: "2026-06-14", ckdplg: "PLG2952", vcnmplg: "PT INDOMARCO P.",
      liter: 3960.34, total: 73890378, sbatal: 0,
    });
  });

  it("saleSql = view vw_jualplg, ter-bound DTGL [lo,hi) utk window backfill", () => {
    const sql = PELANGGAN_DOMAIN.saleSql.replace(/\s+/g, " ");
    expect(sql).toContain("FROM vw_jualplg");
    expect(sql).toContain("WHERE DTGL >= ? AND DTGL < ?"); // batas atas eksklusif (chunk)
  });

  it("mapVoucher: total=NJUMLAHUSE, liter dari kolom liter (huruf kecil)", () => {
    const { rows } = PELANGGAN_DOMAIN.mapVoucher([
      {
        DTGL: "2026-06-14", CKDPLG: "PLG2959", VCNMPLG: "REHOBOT",
        liter: "670.95", NJUMLAHUSE: "4818688", CKDUSEVOUC: "UV1",
        NSHIFT: "1", SBATAL: "0", CKDBBM: "BB-07",
      },
    ]);
    expect(rows[0]).toMatchObject({
      ckdplg: "PLG2959", vcnmplg: "REHOBOT", liter: 670.95, total: 4818688,
    });
  });
});

describe("SALES_RESYNC map (anti-stale; by DTGLJUAL; NULL-DTGLJAM disintesis)", () => {
  const base = {
    CKDJUALBBM: "H1", CKDNOZZLE: "N1", NURUT: "1", NVOLUME: "50", NHARGAJUAL: "10000",
    NSUBTOTAL: "500000", CKDBBM: "P1", CKDTANGKI: "T1", NSTANDAWAL: "100",
    NSTANDAKHIR: "150", VCOPEATOR: "-", SUBAH: "0", SEDIT: "0", VCKET: null,
  };

  it("DTGLJAM asli dipakai apa adanya; header dtgljual dari DTGLJUAL", () => {
    const { tables } = SALES_RESYNC.map(
      [{ ...base, DTGLJAM: "2026-06-15 20:30:00", DTGLJUAL: "2026-06-15", NSHIFT: "3" }],
      WIB,
    );
    expect(tables.sales_detail).toHaveLength(1);
    expect(tables.sales_detail![0]!.dtgljam).toBe(
      wibDateTimeToUtcIso("2026-06-15 20:30:00", WIB),
    );
    expect(tables.sales_header![0]!.dtgljual).toBe("2026-06-15");
  });

  it("DTGLJAM NULL (shift-3 di-key esok) → TETAP ikut; dtgljam disintesis tengah-malam WIB", () => {
    const { tables } = SALES_RESYNC.map(
      [{
        ...base, CKDJUALBBM: "H9", CKDNOZZLE: "N3", NSUBTOTAL: "130247852",
        DTGLJAM: null, DTGLJUAL: "2026-06-15", NSHIFT: "3",
      }],
      WIB,
    );
    expect(tables.sales_detail).toHaveLength(1); // BUKAN dibuang (kontras sync incremental)
    expect(tables.sales_detail![0]!.nsubtotal).toBe(130247852);
    // dtgljam non-null (kolom NOT NULL) = DTGLJUAL 00:00 WIB → tanggal-bisnis tetap 15 Jun
    expect(tables.sales_detail![0]!.dtgljam).toBe(
      wibDateTimeToUtcIso("2026-06-15 00:00:00", WIB),
    );
    expect(tables.sales_header![0]!.dtgljual).toBe("2026-06-15");
  });

  it("sql filter h.DTGLJUAL [lo,hi); TANPA predikat DTGLJAM IS NOT NULL", () => {
    const sql = SALES_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE h.DTGLJUAL >= ? AND h.DTGLJUAL < ?");
    expect(sql).not.toMatch(/DTGLJAM\s+IS\s+NOT\s+NULL/i); // kritis: jangan buang NULL
  });
});

describe("Track 2 (2026-07-02) — *_RESYNC: sapuan lebar bounded [lo,hi) generik", () => {
  it("EDC_RESYNC: sql bounded ctgl [lo,hi); map = reuse EDC.map (kolom identik)", () => {
    const sql = EDC_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE ctgl >= ? AND ctgl < ?");
    expect(EDC_RESYNC.map).toBe(EDC_DOMAIN.map);
  });

  it("CASH_RESYNC: sql bounded DTGL [lo,hi); map = reuse CASH.map", () => {
    const sql = CASH_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE h.DTGL >= ? AND h.DTGL < ?");
    expect(CASH_RESYNC.map).toBe(CASH_DOMAIN.map);
  });

  it("TEBUS_RESYNC: sql bounded DTGLTBS [lo,hi); map = reuse TEBUS.map", () => {
    const sql = TEBUS_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE h.DTGLTBS >= ? AND h.DTGLTBS < ?");
    expect(TEBUS_RESYNC.map).toBe(TEBUS_DOMAIN.map);
  });

  it("TERA_RESYNC: sql bounded TanggalJam [lo,hi), floor 2020 dipertahankan; map = reuse TERA.map", () => {
    const sql = TERA_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("t.TanggalJam >= ? AND t.TanggalJam < ?");
    expect(sql).toContain("2020-01-01 00:00:00");
  });

  it("OPNAME_RESYNC: filter by h.DTAGLOPN (header), TANPA predikat DTGLJAM IS NOT NULL", () => {
    const sql = OPNAME_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE h.DTAGLOPN >= ? AND h.DTAGLOPN < ?");
    expect(sql).not.toMatch(/DTGLJAM\s+IS\s+NOT\s+NULL/i);
  });

  it("OPNAME_RESYNC.map: DTGLJAM NULL → TETAP ikut, disintesis tengah-malam WIB dari DTAGLOPN", () => {
    const { tables } = OPNAME_RESYNC.map(
      [
        {
          CKDOPNBBM: "O1", CKDTANGKI: "T1", CKDBBM: "P1", NSTOCKBK: "1000",
          NSTOCKOP: "990", NVOLSELISIH: "-10", DTGLJAM: null,
          DTAGLOPN: "2026-06-15", SBATAL: "0",
        },
      ],
      WIB,
    );
    expect(tables.opname).toHaveLength(1); // BUKAN dibuang (kontras sync incremental)
    expect(tables.opname[0]!.dtaglopn).toBe("2026-06-15");
    expect(tables.opname[0]!.dtgljam).toBe(wibDateTimeToUtcIso("2026-06-15 00:00:00", WIB));
  });

  it("DELIVERY_RESYNC: filter by DTGLTRM (flat table), TANPA predikat DTGLJAM IS NOT NULL", () => {
    const sql = DELIVERY_RESYNC.sql.replace(/\s+/g, " ");
    expect(sql).toContain("WHERE DTGLTRM >= ? AND DTGLTRM < ?");
    expect(sql).not.toMatch(/DTGLJAM\s+IS\s+NOT\s+NULL/i);
  });

  it("DELIVERY_RESYNC.map: DTGLJAM NULL → TETAP ikut, disintesis tengah-malam WIB dari DTGLTRM", () => {
    const { tables } = DELIVERY_RESYNC.map(
      [
        {
          CKDTRM: "D1", DTGLTRM: "2026-06-15", DTGLJAM: null, CNODO: "DO1",
          CNOSO: "SO1", NVOLDO: "8000", NVOLREAL: "7990", NVOLSELISIH: "-10",
          CNOPOL: "B1", VCSOPIR: "Budi", CKDTANGKI: "T1", CKDBBM: "P1", SBATAL: "0",
        },
      ],
      WIB,
    );
    expect(tables.delivery).toHaveLength(1);
    expect(tables.delivery[0]!.dtgltrm).toBe("2026-06-15");
    expect(tables.delivery[0]!.dtgljam).toBe(wibDateTimeToUtcIso("2026-06-15 00:00:00", WIB));
  });
});

describe("MASTERS account.map (defensif — temuan smoke-test: bukan CKDINDUK)", () => {
  const accountMap = MASTERS_DOMAIN.queries.find((q) => q.table === "account")!.map;

  it("mendeteksi kolom induk apa pun namanya (mengandung INDUK)", () => {
    const rows = accountMap([
      { CKDPERK: "5101", VCNMPERK: "ATK", CKDPERKINDUK: "5100" },
    ]) as Array<{ ckdperk: string; vcnmperk: string | null; ckdinduk: string | null }>;
    expect(rows[0]).toEqual({ ckdperk: "5101", vcnmperk: "ATK", ckdinduk: "5100" });
  });

  it("tetap jalan tanpa kolom induk / nama beda (VCNM*)", () => {
    const rows = accountMap([
      { CKDPERK: "5101", VCNMPERKIRAAN: "Biaya ATK" },
    ]) as Array<{ ckdperk: string; vcnmperk: string | null; ckdinduk: string | null }>;
    expect(rows[0]).toEqual({ ckdperk: "5101", vcnmperk: "Biaya ATK", ckdinduk: null });
  });
});

describe("REALTANK.map (vw_realtm — case-insensitive kolom)", () => {
  it("baca kolom view huruf-kecil (nkapasitas/ntinggi/…) di samping CKDTANGKI besar", () => {
    // vw_realtm: CKDTANGKI huruf besar, sisanya huruf kecil (case definisi view).
    const out = REALTANK_DOMAIN.map(
      [
        {
          CKDTANGKI: "T-05", nkapasitas: 9000, ntinggi: 595, nvolume: 2250,
          nsuhu: 28, ntinggiair: 0, nvolumeair: 0, nstatus: 1,
          dtanggaljam: "2026-06-17 00:31:00",
        },
      ],
      WIB,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      ckdtangki: "T-05", nkapasitas: 9000, nvolume: 2250, ntinggi: 595, nsuhu: 28,
    });
    expect(out[0]!.dtanggaljam).toBe("2026-06-16T17:31:00.000Z"); // WIB→UTC
  });

  it("lewati baris tanpa CKDTANGKI", () => {
    const out = REALTANK_DOMAIN.map(
      [{ nkapasitas: 9000, dtanggaljam: "2026-06-17 00:31:00" }],
      WIB,
    );
    expect(out).toHaveLength(0);
  });
});
