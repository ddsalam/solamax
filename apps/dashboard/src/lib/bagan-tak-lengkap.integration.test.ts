import { afterAll, describe, expect, it } from "vitest";

/**
 * INVESTIGASI (read-only): apa yang papan tampilkan untuk unit yang bagan
 * akunnya TAK LENGKAP — satu rekening bank, tanpa `kas`, tanpa
 * `edc_penampungan`.
 *
 * ⚠️ Glue-nya MENIRU `barisUntukUnit` di `app/(app)/keuangan/page.tsx` (fungsi
 * itu tidak diekspor). Yang dipanggil adalah fungsi PRODUKSI yang sama —
 * `getAkunKas`, `getBahanLaporan`, `panelIncome`, `panelBalance`, `barisUnit` —
 * tetapi urutan pemanggilannya disalin, jadi ini pengukuran yang SANGAT DEKAT,
 * bukan pengukuran halaman itu sendiri. Disebut supaya tak dikira lebih.
 *
 * Jalan hanya bila BAGAN_LIVE_DB=1 & DATABASE_URL di-set.
 */
const LIVE = process.env.BAGAN_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;
const DATE = process.env.BAGAN_DATE ?? "2026-08-22";

d("bagan akun tak lengkap — apa yang dilihat direksi", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("mengukur status, cashOnHand, dan langkahHarian per unit", async () => {
    const { q } = await import("./db");
    const { getAkunKas, getDayClose } = await import("./keuangan-input-queries");
    const { getBahanLaporan } = await import("./keuangan-laporan-queries");
    const { panelBalance, panelIncome } = await import("./keuangan-laporan-model");
    const { barisUnit, ringkasPapan } = await import("./keuangan-papan-model");
    type SUID = Parameters<typeof getBahanLaporan>[0];

    const units = await q<{ unit_id: number; code: string; name: string }>(
      `SELECT unit_id, code, name FROM public.unit WHERE active ORDER BY unit_id`,
    );
    const kemarin = new Date(Date.parse(`${DATE}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);

    const tabel: Record<string, unknown>[] = [];
    const baris = [];
    for (const u of units) {
      const id = u.unit_id as unknown as SUID;
      const [akun, dayClose] = await Promise.all([getAkunKas(id), getDayClose(id, DATE)]);
      if (akun.length === 0) {
        const b = barisUnit({
          unitId: u.unit_id, code: u.code, nama: u.name, adaAkunKas: false,
          labaBersih: null, kasAkhir: null, langkahHarian: null,
          dayClose: dayClose === null ? null : { status: dayClose.status, differenceRp: dayClose.differenceRp },
        });
        baris.push(b);
        tabel.push({ unit: u.name, akun: 0, kas: 0, status: b.status, kasAkhir: "—", langkah: "—" });
        continue;
      }
      const bahan = await getBahanLaporan(id, DATE, kemarin);
      const is = panelIncome({
        totals: bahan.totals, beban: bahan.beban,
        pendapatanLain: bahan.pendapatanLain, incomeAdjustment: null,
      });
      const net = is.baris.find((x) => x.label === "Net profit")!.nilai;
      const bs = panelBalance({
        cashOnHand: bahan.kasAkhir,
        inventoryValue: bahan.totals.inventoryValue,
        soValue: bahan.totals.soValue,
        piutangEasymax: bahan.piutangEasymax,
        hutangPiutangNonEasymax: bahan.hutangPiutangNonEasymax,
        openedRetainedEarnings: null,
        netIncome: net ?? 0,
        incomeAdjustment: null,
        totalAssetKemarin: bahan.totalAssetKemarin,
        deltaKontribusi: null,
      });
      const b = barisUnit({
        unitId: u.unit_id, code: u.code, nama: u.name, adaAkunKas: true,
        labaBersih: net, kasAkhir: bahan.kasAkhir, langkahHarian: bs.langkahHarian,
        dayClose: dayClose === null ? null : { status: dayClose.status, differenceRp: dayClose.differenceRp },
      });
      baris.push(b);
      tabel.push({
        unit: u.name,
        akun: akun.length,
        kas: akun.filter((a) => a.kind === "kas").length,
        status: b.status,
        // ⛔ Bedakan null dari 0 secara EKSPLISIT — inilah pertanyaannya.
        kasAkhir: bahan.kasAkhir === null ? "NULL" : String(bahan.kasAkhir),
        langkah: bs.langkahHarian === null ? "NULL" : String(bs.langkahHarian),
        laba: net === null ? "NULL" : String(Math.round(net)),
      });
    }
    console.table(tabel);
    console.log("ringkasPapan:", ringkasPapan(baris));
    expect(tabel.length).toBe(units.length);
  }, 600_000);
});
