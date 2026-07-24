import { describe, expect, it } from "vitest";
import { defaultHarianDate, harianParamsToQuery, parseHarianParams } from "./harian-params";
import type { ScopedUnit, ScopedUnitId } from "./scope-rule";

const u = (id: number, code: string): ScopedUnit => ({
  unit_id: id as ScopedUnitId,
  code,
  name: code,
});
const SCOPE = [u(1, "6478111"), u(4, "6478106"), u(7, "63781002")];
// 24 Jul 2026 pukul 14:30 WIB = 07:30 UTC
const NOW = new Date("2026-07-24T07:30:00Z");

describe("parseHarianParams — tanggal", () => {
  it("default = KEMARIN WIB, bukan hari ini", () => {
    expect(defaultHarianDate(NOW)).toBe("2026-07-23");
    expect(parseHarianParams({}, SCOPE, NOW).date).toBe("2026-07-23");
  });

  it("batas tengah malam WIB, bukan UTC", () => {
    // 16.30 UTC = 23.30 WIB tgl 24 → hari ini 24, kemarin 23
    expect(defaultHarianDate(new Date("2026-07-24T16:30:00Z"))).toBe("2026-07-23");
    // 17.30 UTC = 00.30 WIB tgl 25 → hari ini 25, kemarin 24
    expect(defaultHarianDate(new Date("2026-07-24T17:30:00Z"))).toBe("2026-07-24");
  });

  it("d valid dihormati apa adanya", () => {
    expect(parseHarianParams({ d: "2026-03-09" }, SCOPE, NOW).date).toBe("2026-03-09");
  });

  it("d tak valid → kembali ke default (tanpa melempar)", () => {
    for (const bad of ["kemarin", "2026-7-9", "20260709", "", "2026-07-09T00:00:00Z"]) {
      expect(parseHarianParams({ d: bad }, SCOPE, NOW).date).toBe("2026-07-23");
    }
  });
});

describe("parseHarianParams — unit (choke-point keamanan)", () => {
  it("tanpa param → semua unit ber-scope", () => {
    const p = parseHarianParams({}, SCOPE, NOW);
    expect(p.units).toEqual(SCOPE);
    expect(p.allUnits).toBe(true);
  });

  it("subset → hanya yang diminta, urutan mengikuti scope", () => {
    const p = parseHarianParams({ units: "63781002,6478111" }, SCOPE, NOW);
    expect(p.units.map((x) => x.code)).toEqual(["6478111", "63781002"]);
    expect(p.allUnits).toBe(false);
  });

  it("unit di luar scope TIDAK bisa dipilih lewat URL", () => {
    const p = parseHarianParams({ units: "6478201" }, SCOPE, NOW);
    expect(p.units).toEqual(SCOPE); // fallback, bukan bocor
    expect(p.units.some((x) => x.code === "6478201")).toBe(false);
  });

  it("pengawas 1 unit tetap 1 unit apa pun isi URL", () => {
    const one = [u(4, "6478106")];
    expect(parseHarianParams({ units: "6478111,6478106" }, one, NOW).units.map((x) => x.code)).toEqual([
      "6478106",
    ]);
  });
});

describe("harianParamsToQuery — URL kanonik", () => {
  it("d SELALU eksplisit (tak ada default tersembunyi yang bisa desync)", () => {
    expect(harianParamsToQuery({ date: "2026-07-23", unitCodes: [], allUnits: true })).toBe(
      "?d=2026-07-23",
    );
  });

  it("units ditulis hanya bila bukan semua", () => {
    expect(
      harianParamsToQuery({ date: "2026-07-23", unitCodes: ["6478111", "63781002"], allUnits: false }),
    ).toBe("?d=2026-07-23&units=6478111%2C63781002");
  });

  it("round-trip: query → parse → query menghasilkan string yang sama", () => {
    const q1 = harianParamsToQuery({ date: "2026-03-09", unitCodes: ["6478106"], allUnits: false });
    const sp = Object.fromEntries(new URLSearchParams(q1.slice(1)));
    const p = parseHarianParams(sp, SCOPE, NOW);
    const q2 = harianParamsToQuery({
      date: p.date,
      unitCodes: p.units.map((x) => x.code),
      allUnits: p.allUnits,
    });
    expect(q2).toBe(q1);
  });
});
