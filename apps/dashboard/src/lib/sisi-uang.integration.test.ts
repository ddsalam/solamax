import { afterAll, describe, expect, it } from "vitest";

/**
 * INVESTIGASI (read-only): apa yang BERUBAH sesudah harga beli terisi.
 *
 * Dua tanggal dengan sengaja — satu DI DALAM masa berlaku harga (2026-08-22)
 * dan satu DI LUAR (2026-07-15). Tanpa tanggal kedua, "sekarang ada nilainya"
 * tak bisa dibedakan dari "memang selalu ada".
 */
const LIVE = process.env.UANG_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("sisi uang sesudah harga beli terisi", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("membandingkan dua tanggal", async () => {
    const { q } = await import("./db");
    const { getBahanLaporan } = await import("./keuangan-laporan-queries");
    const { panelIncome } = await import("./keuangan-laporan-model");
    type SUID = Parameters<typeof getBahanLaporan>[0];

    const units = await q<{ unit_id: number; code: string; name: string }>(
      `SELECT unit_id, code, name FROM public.unit WHERE active ORDER BY unit_id`,
    );
    for (const DATE of ["2026-08-22", "2026-07-15"]) {
      const kemarin = new Date(Date.parse(`${DATE}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const rows: Record<string, unknown>[] = [];
      for (const u of units) {
        const b = await getBahanLaporan(u.unit_id as unknown as SUID, DATE, kemarin);
        const is = panelIncome({
          totals: b.totals, beban: b.beban, pendapatanLain: b.pendapatanLain, incomeAdjustment: null,
        });
        const gp = is.baris.find((x) => x.label.toLowerCase().includes("gross"))?.nilai ?? null;
        rows.push({
          unit: u.name,
          revenue: Math.round(b.totals.revenue),
          cogs: Math.round(b.totals.cogs),
          grossProfit: gp === null ? "NULL" : Math.round(gp),
          inventory: Math.round(b.totals.inventoryValue),
          soValue: Math.round(b.totals.soValue),
          takLengkap: b.incomplete.length === 0 ? "—" : b.incomplete.join(","),
        });
      }
      console.log(`\n═══ ${DATE}`);
      console.table(rows);
    }
    expect(units.length).toBe(7);
  }, 900_000);
});
