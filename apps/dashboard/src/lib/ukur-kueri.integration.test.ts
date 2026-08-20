import { afterAll, describe, expect, it } from "vitest";

/**
 * PENGUKURAN ONGKOS PAPAN — DB-LIVE, READ-ONLY, DAN DIULANGI KAPAN SAJA.
 *
 * Ini bukan uji lulus/gagal melainkan **sumber angka**. Header
 * `app/(app)/keuangan/page.tsx` mengutip ongkos papan; angka yang dikutip di
 * lebih dari satu tempat butuh sumber yang DIUKUR, dan inilah sumbernya. Ia
 * menjalankan `getBahanLaporan` PRODUKSI (bukan tiruan) untuk tiap unit yang
 * termodelkan, lalu mencetak baris `[ukur]` apa adanya.
 *
 * ⛔ Ini BUKAN uji beban. Ia merender satu papan, sekali — sama seperti satu
 *    orang membuka halamannya. Arahkan ke tier PENGUJIAN (`solamax-pg-rlsstg`);
 *    jangan menembakkan beban sintetis ke `solamax-pg`.
 *
 * Jalan hanya bila UKUR_LIVE_DB=1 & DATABASE_URL di-set (CI default skip).
 */
const LIVE = process.env.UKUR_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const DATE = process.env.UKUR_DATE ?? "2026-07-22";

d("ongkos papan keuangan — terukur di DB nyata", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("mencetak kueri, round-trip, dan wall-clock per unit dan per papan", async (ctx) => {
    const { q } = await import("./db");
    const { ukur, PENULIS } = await import("./ukur-kueri");
    const { getBahanLaporan } = await import("./keuangan-laporan-queries");
    const { getAkunKas } = await import("./keuangan-input-queries");
    type SUID = Parameters<typeof getBahanLaporan>[0];

    const units = await q<{ unit_id: number; code: string }>(
      `SELECT unit_id, code FROM public.unit WHERE active ORDER BY unit_id`,
    );
    if (units.length === 0) ctx.skip();

    const kemarin = new Date(Date.parse(`${DATE}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);

    const baris: string[] = [];
    const simpan = PENULIS.tulis;
    PENULIS.tulis = (b) => baris.push(b);
    try {
      await ukur("papan", () =>
        Promise.all(
          units.map(async (u) => {
            const akun = await getAkunKas(u.unit_id as unknown as SUID);
            if (akun.length === 0) return; // batas ongkos yang sama dengan papan
            await getBahanLaporan(u.unit_id as unknown as SUID, DATE, kemarin);
          }),
        ),
      );
    } finally {
      PENULIS.tulis = simpan;
    }

    // Dicetak apa adanya — inilah keluarannya, bukan efek sampingnya.
    console.log(`\nunit aktif: ${units.length}, tanggal: ${DATE}`);
    for (const b of baris) console.log("  " + b);

    // Daya-beda: papan yang tak mengukur apa pun harus terlihat, bukan lolos.
    const papan = baris.find((b) => b.includes("] papan "))!;
    expect(papan).toBeDefined();
    expect(Number(/kueri=(\d+)/.exec(papan)![1])).toBeGreaterThan(0);
  }, 300_000);
});
