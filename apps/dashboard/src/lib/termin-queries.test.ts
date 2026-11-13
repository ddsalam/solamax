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

const {
  getPetaTermin, getPelangganUntukTermin, getTerminPelanggan, getTerminUnit,
  kunciTermin, pelangganBisaPiutang, pelangganTerminBawaan, terminUntuk,
} = await import("./termin-queries");

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

  it("daftar S4 membawa kelas master; kelas piutang (1/5) didahulukan bila kodenya kembar", async () => {
    h.state.rows = [{ kodePelanggan: "UJI/01", namaPelanggan: "PT Contoh", diMaster: true, kelas: 1, terminHari: null, diaturOleh: null, diaturAt: null }];
    expect((await getPelangganUntukTermin(U))[0]).toMatchObject({ kodePelanggan: "UJI/01", kelas: 1 });
    const sql = h.panggilan[0]!.sql;
    expect(sql).toMatch(/m\.kelas\s+AS kelas/);
    expect(sql).toMatch(/COALESCE\(min\(sjenis\) FILTER \(WHERE sjenis IN \(1, 5\)\), max\(sjenis\)\)::int AS kelas/);
  });
});

describe("pelanggan piutang — populasi yang sama dengan 'belum ditagihkan'", () => {
  const p = (kodePelanggan: string, kelas: number | null, terminHari: number | null = null) =>
    ({ kodePelanggan, kelas, terminHari });

  it("kelas 1 atau 5 tanpa titik, atau kode bertitik berapa pun kelasnya", () => {
    expect(pelangganBisaPiutang(p("UJI/01", 1))).toBe(true);
    expect(pelangganBisaPiutang(p("UJI05", 5))).toBe(true);
    expect(pelangganBisaPiutang(p("UJI.02", 3))).toBe(true);
    expect(pelangganBisaPiutang(p("UJI.03", null))).toBe(true);
    expect(pelangganBisaPiutang(p("UJITUNAI", 4))).toBe(false);
    expect(pelangganBisaPiutang(p("UJILAIN", 3))).toBe(false);
    expect(pelangganBisaPiutang(p("UJIYATIM", null))).toBe(false);
  });

  it("🔴 daftar bawaan: pelanggan piutang + SETIAP pengecualian (kelas tunai dan yatim ikut)", () => {
    const rows = [p("UJI/01", 1), p("UJITUNAI", 4), p("UJITUNAI2", 4, 7), p("UJIYATIM", null, 14), p("UJI.02", 3), p("UJILAIN", 2)];
    expect(pelangganTerminBawaan(rows).map((r) => r.kodePelanggan)).toEqual(["UJI/01", "UJITUNAI2", "UJIYATIM", "UJI.02"]);
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

  it("🔴 peta dikunci tanpa beda huruf besar/kecil: pengecualian `nol/02a` berlaku untuk faktur `NOL/02A`", async () => {
    h.state.rows = [{ kodePelanggan: "nol/02a", terminHari: 14 }];
    const peta = await getPetaTermin(U);
    expect(terminUntuk(peta, "NOL/02A  ")).toEqual({ terminPelanggan: 14, terminUnit: null });
    expect(terminUntuk(peta, "Nol/02a")).toEqual({ terminPelanggan: 14, terminUnit: null });
    expect(terminUntuk(peta, "NOL/02")).toEqual({ terminPelanggan: null, terminUnit: null });
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

  it("kunci termin: spasi pinggir dipangkas, huruf besar; isi kode tidak diubah selain itu", () => {
    expect(kunciTermin("  abc/0.1 ")).toBe("ABC/0.1");
    const peta = { terminUnit: null, terminPelanggan: new Map([[kunciTermin("ABC"), 7]]) };
    expect(terminUntuk(peta, "abc").terminPelanggan).toBe(7);
    expect(terminUntuk(peta, "ab c").terminPelanggan).toBeNull();
  });
});
