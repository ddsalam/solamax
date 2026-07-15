import { afterAll, describe, expect, it } from "vitest";

/**
 * VERIFIKASI ANGKA BOARD DB-LIVE (FASE 4 redesign) — FIXTURE-FREE & READ-ONLY.
 * Menjalankan QUERY + MODEL PRODUKSI yang sama dengan halaman terhadap Cloud SQL
 * (role dashboard_app, RLS aktif via qScoped) dan membuktikan:
 *   (1) PARITAS angka board vs Laporan Operasional utk 2 tanggal × 2 unit
 *       (grain harian board == getSalesByProduct/getSalesTotals; baris G/L
 *       hari-D identik apa pun titik awal jendela query — dasar union-span);
 *   (2) EKSAKNYA pecahan jendela cache G/L (prefix+suffix == utuh);
 *   (3) RBAC lapis-data: grain multi-unit tak pernah memuat unit di luar
 *       daftar ScopedUnitId yang diberikan.
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set (CI default skip).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

// Dua tanggal uji FINAL (historis; opname penutup sudah masuk) × dua unit pilot.
const DATES = ["2026-06-20", "2026-07-10"];
const UNITS = [1, 2];

d("board live — paritas angka vs Laporan Operasional (2 tanggal × 2 unit)", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it(
    "grain harian board == getSalesByProduct & getSalesTotals per (unit × tanggal)",
    async () => {
      const Q = await import("./queries");
      type SUID = Parameters<typeof Q.getSalesTotals>[0];
      for (const u of UNITS) {
        const uid = u as unknown as SUID;
        for (const date of DATES) {
          const [grain, byProduct, totals] = await Promise.all([
            Q.getDailySalesByProduct([uid], date, date),
            Q.getSalesByProduct(uid, date, date),
            Q.getSalesTotals(uid, date, date),
          ]);
          // total grain == totals laporan
          const gVol = grain.reduce((s, r) => s + r.vol, 0);
          const gOmzet = grain.reduce((s, r) => s + r.omzet, 0);
          expect(gVol, `vol u${u} ${date}`).toBeCloseTo(totals.vol, 3);
          expect(gOmzet, `omzet u${u} ${date}`).toBeCloseTo(totals.omzet, 1);
          // per produk == getSalesByProduct (sumber tabel Laporan)
          const gMap = new Map(grain.map((r) => [r.ckdbbm, r]));
          expect(grain.length, `jml produk u${u} ${date}`).toBe(byProduct.length);
          for (const p of byProduct) {
            const g = gMap.get(p.ckdbbm);
            expect(g, `produk ${p.ckdbbm} u${u} ${date}`).toBeTruthy();
            expect(g!.vol).toBeCloseTo(p.vol, 3);
            expect(g!.omzet).toBeCloseTo(p.omzet, 1);
          }
        }
      }
    },
    { timeout: 120_000 },
  );

  it(
    "baris G/L hari-D IDENTIK dari jendela [D..D] vs [awal-bulan..D] (pola Laporan)",
    async () => {
      const Q = await import("./queries");
      type SUID = Parameters<typeof Q.getSalesTotals>[0];
      for (const u of UNITS) {
        const uid = u as unknown as SUID;
        for (const date of DATES) {
          const mStart = `${date.slice(0, 7)}-01`;
          const [narrow, wide] = await Promise.all([
            Q.getDailyGlByProduct(uid, date, date),
            Q.getDailyGlByProduct(uid, mStart, date),
          ]);
          const wideDay = wide.filter((r) => r.d === date);
          expect(narrow.length, `baris G/L u${u} ${date}`).toBe(wideDay.length);
          const wMap = new Map(wideDay.map((r) => [r.ckdbbm, r]));
          for (const n of narrow) {
            const w = wMap.get(n.ckdbbm)!;
            expect(w, `produk ${n.ckdbbm}`).toBeTruthy();
            expect(n.gl, `gl ${n.ckdbbm} u${u} ${date}`).toBe(w.gl);
            expect(n.fisik).toBe(w.fisik);
            expect(n.fisik_prev).toBe(w.fisik_prev);
            expect(n.provisional).toBe(w.provisional);
          }
        }
      }
    },
    { timeout: 240_000 },
  );

  it(
    "pecahan jendela cache G/L EKSAK: concat(prefix, suffix) == jendela utuh",
    async () => {
      const Q = await import("./queries");
      type SUID = Parameters<typeof Q.getSalesTotals>[0];
      const uid = 1 as unknown as SUID;
      const from = "2026-06-01";
      const mid = "2026-07-05";
      const midNext = "2026-07-06";
      const to = "2026-07-10";
      const [whole, prefix, suffix] = await Promise.all([
        Q.getDailyGlByProduct(uid, from, to),
        Q.getDailyGlByProduct(uid, from, mid),
        Q.getDailyGlByProduct(uid, midNext, to),
      ]);
      const glued = [...prefix, ...suffix];
      expect(glued.length).toBe(whole.length);
      for (let i = 0; i < whole.length; i++) {
        expect(glued[i], `baris ${i}`).toEqual(whole[i]);
      }
    },
    { timeout: 240_000 },
  );

  it("RBAC lapis-data: grain multi-unit hanya memuat unit dalam daftar scoped", async () => {
    const Q = await import("./queries");
    type SUID = Parameters<typeof Q.getSalesTotals>[0];
    const onlyBakau = await Q.getDailySalesByProduct(
      [2 as unknown as SUID],
      DATES[0]!,
      DATES[1]!,
    );
    expect(onlyBakau.length).toBeGreaterThan(0);
    expect(onlyBakau.every((r) => r.unit_id === 2)).toBe(true);
  });
});
