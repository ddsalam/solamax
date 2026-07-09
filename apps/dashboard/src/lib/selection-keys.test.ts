import { describe, expect, it } from "vitest";
import {
  DATE_COOKIE,
  deriveTopbarSelection,
  selectionCookieWrites,
  UNIT_COOKIE,
} from "./selection-keys";

/**
 * Mengunci sinkronisasi picker ↔ URL — URL KANONIK. Di SEMUA rute ber-unit-di-
 * URL (laporan/rincian/usulan + denah) picker cermin URL (cegah desync saat
 * layout grup tak re-render & cookie basi — bug denah 2026-07-09). Di rute
 * tanpa unit di URL → seed cookie. Plus aturan write-through cookie.
 */
const SEED_UNIT = "6478111";
const SEED_DATE = "2026-06-18"; // cookie basi
const TODAY = "2026-07-09";
const UNITS = ["6478111", "6378301"]; // IB + Bakau

const derive = (path: string) => deriveTopbarSelection(path, SEED_UNIT, SEED_DATE, TODAY);

describe("deriveTopbarSelection — picker cermin URL di rute ber-unit", () => {
  it("rincian: unit+tanggal dari URL menang atas seed cookie", () => {
    expect(derive("/unit/6478111/rincian/2026-06-14")).toEqual({
      unit: "6478111",
      date: "2026-06-14",
      unitFromUrl: true,
      dateFromUrl: true,
    });
  });

  it("laporan: tanggal dari URL menang (?view diabaikan oleh path)", () => {
    const r = derive("/unit/6478111/laporan/2026-06-15");
    expect(r.date).toBe("2026-06-15");
    expect(r.dateFromUrl).toBe(true);
  });

  it("usulan (termasuk /edit): unit+tanggal dari URL", () => {
    const r = derive("/unit/6378301/usulan/2026-06-20/edit");
    expect(r).toMatchObject({ unit: "6378301", date: "2026-06-20", unitFromUrl: true });
  });

  it("UNIT desync: code dari URL menang atas seed unit", () => {
    const r = derive("/unit/6478333/rincian/2026-06-14");
    expect(r.unit).toBe("6478333");
    expect(r.date).toBe("2026-06-14");
  });

  it("DENAH (bug 2026-07-09): unit dari URL menang atas seed — bukan grup-wide", () => {
    const r = derive("/monitoring/denah/6478111");
    expect(r.unit).toBe("6478111");
    expect(r.unitFromUrl).toBe(true);
  });

  it("DENAH realtime: tanggal tampil = hari ini, TANPA write-through tanggal", () => {
    const r = derive("/monitoring/denah/6378301");
    expect(r.date).toBe(TODAY);
    expect(r.dateFromUrl).toBe(false);
  });

  it("grup-wide (board/ketaatan/beranda/admin): pakai seed cookie", () => {
    for (const p of ["/board", "/monitoring/ketaatan", "/", "/admin", "/monitoring"]) {
      expect(derive(p)).toEqual({
        unit: SEED_UNIT,
        date: SEED_DATE,
        unitFromUrl: false,
        dateFromUrl: false,
      });
    }
  });
});

describe("selectionCookieWrites — write-through mengikuti navigasi", () => {
  it("drill-in denah: tulis unit URL (≠ cookie), tanggal TIDAK ditulis", () => {
    const sel = derive("/monitoring/denah/6378301");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([
      { key: UNIT_COOKIE, value: "6378301" },
    ]);
  });

  it("rute laporan: tulis unit + tanggal saat keduanya berbeda", () => {
    const sel = derive("/unit/6378301/laporan/2026-07-01");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([
      { key: UNIT_COOKIE, value: "6378301" },
      { key: DATE_COOKIE, value: "2026-07-01" },
    ]);
  });

  it("nilai sama = tanpa tulisan (hindari loop efek)", () => {
    const sel = derive("/unit/6478111/laporan/2026-06-15");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: "2026-06-15" })).toEqual([]);
  });

  it("unit di luar scope caller TIDAK pernah ditulis ke cookie", () => {
    const sel = derive("/monitoring/denah/9999999");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6478111", date: SEED_DATE })).toEqual([]);
  });

  it("rute tanpa unit di URL: tanpa tulisan apa pun", () => {
    const sel = derive("/board");
    expect(selectionCookieWrites(sel, UNITS, { unit: "6378301", date: SEED_DATE })).toEqual([]);
  });
});
