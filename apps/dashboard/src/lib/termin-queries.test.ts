import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope";

/**
 * Sisi baca termin (rencana 2026-11-13 U4) dengan `qScoped` TIRUAN: bentuk
 * hasil, peta cari, dan bahwa setiap kueri ter-scope unit & hanya membaca baris
 * aktif. SQL-nya sendiri dijalankan di `termin.integration.test.ts`.
 */
const h = vi.hoisted(() => {
  const panggilan: { unit: unknown; sql: string; params: unknown[] }[] = [];
  const state: { rows: unknown[] } = { rows: [] };
  const qScoped = vi.fn(async (unit: unknown, sql: string, params: unknown[] = []) => {
    panggilan.push({ unit, sql, params });
    return state.rows;
  });
  return { panggilan, state, qScoped };
});
vi.mock("./db", () => ({ qScoped: h.qScoped }));

const { getPetaTermin, getPelangganUntukTermin, getTerminPelanggan, getTerminUnit, terminUntuk } = await import(
  "./termin-queries"
);

const U = 6478 as ScopedUnitId;

beforeEach(() => {
  h.panggilan.length = 0;
  h.state.rows = [];
});

describe("kueri baca — ter-scope unit, hanya baris aktif", () => {
  it("🔴 setiap kueri lewat qScoped(unit) dengan unit_id = $1 dan NOT void", async () => {
    await getTerminUnit(U);
    await getTerminPelanggan(U);
    await getPelangganUntukTermin(U);
    await getPetaTermin(U);
    expect(h.panggilan).toHaveLength(4);
    for (const p of h.panggilan) {
      expect(p.unit).toBe(U);
      expect(p.params).toEqual([U]);
      expect(p.sql).toMatch(/unit_id = \$1 AND NOT (t\.)?void/);
    }
  });

  it("getTerminUnit: null bila belum diatur; baris pertama bila ada", async () => {
    expect(await getTerminUnit(U)).toBeNull();
    h.state.rows = [{ terminHari: 30, diaturOleh: "staf@solagroup.co", diaturAt: "2026-11-13 09:00" }];
    expect(await getTerminUnit(U)).toEqual({ terminHari: 30, diaturOleh: "staf@solagroup.co", diaturAt: "2026-11-13 09:00" });
  });

  it("nama pelanggan dari master cermin, dikunci btrim(ckdplg)", async () => {
    await getTerminPelanggan(U);
    await getPelangganUntukTermin(U);
    for (const p of h.panggilan) {
      expect(p.sql).toMatch(/FROM public\.pelanggan_master/);
      expect(p.sql).toMatch(/GROUP BY btrim\(ckdplg\)/);
    }
    expect(h.panggilan[1]!.sql).toMatch(/FULL JOIN/);
  });
});

describe("getPetaTermin + terminUntuk — bentuk cari untuk daftar faktur", () => {
  it("baris tanpa kode = bawaan unit; sisanya peta kode → termin", async () => {
    h.state.rows = [
      { kodePelanggan: null, terminHari: 30 },
      { kodePelanggan: "NOL/02", terminHari: 14 },
      { kodePelanggan: "9.1.2", terminHari: 0 },
    ];
    const peta = await getPetaTermin(U);
    expect(peta.terminUnit).toBe(30);
    expect([...peta.terminPelanggan]).toEqual([
      ["NOL/02", 14],
      ["9.1.2", 0],
    ]);
  });

  it("belum ada apa pun: bawaan null, peta kosong", async () => {
    const peta = await getPetaTermin(U);
    expect(peta).toEqual({ terminUnit: null, terminPelanggan: new Map() });
    expect(terminUntuk(peta, "NOL/02")).toEqual({ terminPelanggan: null, terminUnit: null });
  });

  it("🔴 terminUntuk: pengecualian + bawaan; kode berpengisi spasi cocok; termin 0 tidak jatuh jadi null", () => {
    const peta = { terminUnit: 30, terminPelanggan: new Map([["NOL/02", 14], ["9.1.2", 0]]) };
    expect(terminUntuk(peta, "NOL/02      ")).toEqual({ terminPelanggan: 14, terminUnit: 30 });
    expect(terminUntuk(peta, "9.1.2")).toEqual({ terminPelanggan: 0, terminUnit: 30 });
    expect(terminUntuk(peta, "LAIN")).toEqual({ terminPelanggan: null, terminUnit: 30 });
    expect(terminUntuk(peta, null)).toEqual({ terminPelanggan: null, terminUnit: 30 });
    expect(terminUntuk(peta, "   ")).toEqual({ terminPelanggan: null, terminUnit: 30 });
  });

  it("kode peka huruf besar/kecil — tak ada pelipatan diam-diam", () => {
    const peta = { terminUnit: null, terminPelanggan: new Map([["ABC", 7]]) };
    expect(terminUntuk(peta, "abc").terminPelanggan).toBeNull();
  });
});
