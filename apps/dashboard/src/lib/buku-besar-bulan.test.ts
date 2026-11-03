import { describe, expect, it } from "vitest";
import { MULAI_BUKU_BESAR as dariModel } from "./buku-besar-model";
import { bulanBukuBesar, MULAI_BUKU_BESAR, MULAI_BULAN_BUKU_BESAR } from "./buku-besar-bulan";
import { unitRouteHref } from "./unit-route";

describe("bulan buku besar — tautan tak pernah menunjuk bulan sebelum buku besar dimulai", () => {
  it("satu sumber tanggal mulai", () => {
    expect(dariModel).toBe(MULAI_BUKU_BESAR);
    expect(MULAI_BULAN_BUKU_BESAR).toBe("2026-10");
  });

  it("tanggal/bulan sebelum mulai dijepit ke bulan mulai; sesudahnya apa adanya", () => {
    expect(bulanBukuBesar("2026-09-30")).toBe("2026-10");
    expect(bulanBukuBesar("2026-01")).toBe("2026-10");
    expect(bulanBukuBesar("2026-10-01")).toBe("2026-10");
    expect(bulanBukuBesar("2026-11-03")).toBe("2026-11");
  });

  it("pemilih unit/tanggal: 30 Sep → Oktober (dulu 2026-09 ⇒ 404); 3 Nov → November", () => {
    expect(unitRouteHref({ segment: "keuangan-buku-besar", code: "6378301", date: "2026-09-30" })).toBe("/keuangan/unit/6378301/buku-besar/2026-10");
    expect(unitRouteHref({ segment: "keuangan-buku-besar", code: "6378301", date: "2026-11-03" })).toBe("/keuangan/unit/6378301/buku-besar/2026-11");
  });
});
