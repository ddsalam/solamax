import { describe, expect, it } from "vitest";
import { unitRouteHref } from "./unit-route";

/**
 * Mengunci perilaku navigasi filter halaman per-unit — SAMA dengan yang dulu
 * dilakukan TopbarPicker (regex per-rute), kini eksplisit & teruji.
 */
describe("unitRouteHref", () => {
  it("rincian: unit + tanggal di path", () => {
    expect(unitRouteHref({ segment: "rincian", code: "6478111", date: "2026-07-27" })).toBe(
      "/unit/6478111/rincian/2026-07-27",
    );
  });

  it("laporan: query dipertahankan (mis. mode ringkas)", () => {
    expect(
      unitRouteHref({ segment: "laporan", code: "6478111", date: "2026-07-27", query: "view=ringkas" }),
    ).toBe("/unit/6478111/laporan/2026-07-27?view=ringkas");
  });

  it("rincian: query kosong tidak meninggalkan tanda tanya menggantung", () => {
    expect(unitRouteHref({ segment: "rincian", code: "6478111", date: "2026-07-27", query: "" })).toBe(
      "/unit/6478111/rincian/2026-07-27",
    );
  });

  it("usulan daftar vs form: sub-rute /edit dipertahankan saat ganti unit/tanggal", () => {
    expect(unitRouteHref({ segment: "usulan", code: "6378301", date: "2026-07-20" })).toBe(
      "/unit/6378301/usulan/2026-07-20",
    );
    expect(unitRouteHref({ segment: "usulan", code: "6378301", date: "2026-07-20", edit: true })).toBe(
      "/unit/6378301/usulan/2026-07-20/edit",
    );
  });

  it("edit hanya berlaku untuk usulan — rute lain tak punya sub-rute form", () => {
    expect(unitRouteHref({ segment: "laporan", code: "6478111", date: "2026-07-27", edit: true })).toBe(
      "/unit/6478111/laporan/2026-07-27",
    );
  });

  it("denah realtime: TANPA tanggal di URL walau tanggal ikut diberikan", () => {
    expect(unitRouteHref({ segment: "denah", code: "6478106", date: "2026-07-27" })).toBe(
      "/monitoring/denah/6478106",
    );
  });
});
