import { describe, expect, it } from "vitest";
import { CASH_DOMAIN, DATETIME_DOMAINS, MASTERS_DOMAIN } from "./domains.js";
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
