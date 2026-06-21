import { describe, expect, it } from "vitest";
import {
  CASH_DOMAIN,
  DATETIME_DOMAINS,
  DEPOSIT_DOMAIN,
  EDC_DOMAIN,
  MASTERS_DOMAIN,
  PELANGGAN_DOMAIN,
  REALTANK_DOMAIN,
} from "./domains.js";
import { tzOffsetMinutes } from "./transform.js";

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
