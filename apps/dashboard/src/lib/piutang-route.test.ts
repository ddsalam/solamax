import { describe, expect, it } from "vitest";
import { piutangQueryHref, piutangExportHref, piutangViewInput, readinessProps, validPiutangExportInput } from "./piutang-route";

describe("piutang route contract", () => {
  it("keeps the screen filter in the independent export URL and drops pagination", () => {
    expect(piutangExportHref("csv", "6478111", "2026-09-09", {
      search: " NOL/02 ", filter: "nol", sort: "kode",
    })).toBe("/api/keuangan/unit/6478111/piutang/2026-09-09/csv?q=+NOL%2F02+&filter=nol&sort=kode");
    expect(piutangExportHref("pdf", "6478111", "2026-09-09", {
      search: "", filter: "semua", sort: "default", mutasiDebet: true,
    })).toBe("/api/keuangan/unit/6478111/piutang/2026-09-09/pdf?filter=semua&sort=default&mutasi_debet=1");
  });

  it("rejects invalid export enums", () => {
    expect(validPiutangExportInput(new URLSearchParams("filter=besar"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("sort=saldo"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("mutasi_kredit=ya"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("mutasi_debet=2"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("filter=semua&sort=nama&q=andi"))).toEqual({
      search: "andi", filter: "semua", sort: "nama", mutasiKredit: false, mutasiDebet: false,
    });
    expect(validPiutangExportInput(new URLSearchParams("mutasi_kredit=1&mutasi_debet=0"))).toEqual({
      search: null, filter: null, sort: null, mutasiKredit: true, mutasiDebet: false,
    });
  });

  it("uses the first repeated screen parameter, matching URLSearchParams.get", () => {
    expect(piutangViewInput({
      q: ["pertama", "kedua"],
      filter: ["nol", "semua"],
      sort: ["kode", "nama"],
      page_lokal: ["2", "9"],
      page_hutang: "3",
    })).toEqual({
      search: "pertama", filter: "nol", sort: "kode",
      mutasiKredit: undefined, mutasiDebet: undefined,
      pages: { lokal: "2", hutang: "3", online: undefined, nol: undefined },
    });
    expect(piutangViewInput({ mutasi_kredit: "1", mutasi_debet: ["0", "1"] })).toMatchObject({
      mutasiKredit: "1", mutasiDebet: "0",
    });
  });

  it("does not invent source-cut state when no snapshot attempt is visible", () => {
    const props = readinessProps({
      status: "not_ready",
      asOfDate: "2026-09-09",
      reason: "no_published_snapshot",
    });
    expect(props.reason).toContain("Status pengiriman source cut dan pembangunan belum terlihat");
    expect(props.reason).not.toContain("Belum ada source cut lengkap");
    expect(props.action).toContain("jangan menganggapnya saldo nol");
  });
});


it("retains independent pages on navigation and resets them on filter changes", () => {
  const query = { search: "a / b", filter: "semua" as const, sort: "kode" as const };
  expect(piutangQueryHref(query, { lokal: 2, hutang: 3, nol: 1 }, "lokal"))
    .toBe("?q=a+%2F+b&filter=semua&sort=kode&page_lokal=2&page_hutang=3&page_nol=1#piutang-lokal");
  expect(piutangQueryHref({ ...query, filter: "nol" })).toBe("?q=a+%2F+b&filter=nol&sort=kode");
  expect(piutangQueryHref({ ...query, mutasiKredit: true })).toBe("?q=a+%2F+b&filter=semua&sort=kode&mutasi_kredit=1");
  expect(piutangQueryHref({ ...query, mutasiKredit: true, mutasiDebet: true }, { lokal: 2 }))
    .toBe("?q=a+%2F+b&filter=semua&sort=kode&mutasi_kredit=1&mutasi_debet=1&page_lokal=2");
});
