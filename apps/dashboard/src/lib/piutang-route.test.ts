import { describe, expect, it } from "vitest";
import { piutangExportHref, piutangViewInput, readinessProps, validPiutangExportInput } from "./piutang-route";

describe("piutang route contract", () => {
  it("keeps the screen filter in the independent export URL and drops pagination", () => {
    expect(piutangExportHref("csv", "6478111", "2026-09-09", {
      search: " NOL/02 ", filter: "nol", sort: "kode",
    })).toBe("/api/keuangan/unit/6478111/piutang/2026-09-09/csv?q=+NOL%2F02+&filter=nol&sort=kode");
  });

  it("rejects invalid export enums", () => {
    expect(validPiutangExportInput(new URLSearchParams("filter=besar"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("sort=saldo"))).toBeNull();
    expect(validPiutangExportInput(new URLSearchParams("filter=semua&sort=nama&q=andi"))).toEqual({
      search: "andi", filter: "semua", sort: "nama",
    });
  });

  it("uses the first repeated screen parameter, matching URLSearchParams.get", () => {
    expect(piutangViewInput({
      q: ["pertama", "kedua"],
      filter: ["nol", "semua"],
      sort: ["kode", "nama"],
      page: ["2", "9"],
    })).toEqual({ search: "pertama", filter: "nol", sort: "kode", page: "2" });
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
