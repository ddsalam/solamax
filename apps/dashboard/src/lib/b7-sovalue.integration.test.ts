import { describe, expect, it, afterAll } from "vitest";

/**
 * B7 · `SOValue` terhadap 10 TANGGAL EMAS — DB-live, read-only.
 *
 * Menjalankan jalur PRODUKSI (`getDoHarian` + `sisaSoAktif` + `effectiveBuyPrice`),
 * bukan tiruan. Segelnya: `session-notes/2026-08-21-b7-sovalue-segel.md`
 * (commit 6e03bea) — ditulis SEBELUM berkas ini dijalankan.
 *
 * Jalan hanya bila B7_LIVE_DB=1 & DATABASE_URL di-set.
 */
const LIVE = process.env.B7_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const TANGGAL = [
  "2025-01-31", "2025-03-29", "2025-03-31", "2025-06-02", "2025-06-30",
  "2025-08-31", "2025-09-30", "2025-12-01", "2025-12-31", "2026-01-12",
] as const;

/** SisaSO SolaMax PRA-B6, dari tabel pra-registrasi T3 (10 Agu 2026). */
const PRA_B6: Record<string, Record<string, number>> = {
  "2025-12-31": { "BB-03": 56_000, "BB-07": 48_000 },
  "2026-01-12": { "BB-03": 48_000 },
};

d("B7 — SisaSO & SOValue per produk pada 10 tanggal emas", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("mencetak angka hari ini, sesudah B6 terpasang", async () => {
    const { q } = await import("./db");
    const Q = await import("./queries");
    const { sisaSoAktif } = await import("./keuangan-mesin");
    const { effectiveBuyPrice } = await import("./harga-beli");
    const { getHargaBeliRows } = await import("./keuangan-input-queries");
    type SUID = Parameters<typeof Q.getDoHarian>[0];

    const [u] = await q<{ unit_id: number }>(
      `SELECT unit_id FROM public.unit WHERE code = '6378301'`,
    );
    expect(u, "unit Bakau tak ditemukan").toBeDefined();
    const unit = u!.unit_id as unknown as SUID;
    const buyRows = await getHargaBeliRows(unit);

    const baris: Record<string, unknown>[] = [];
    for (const tgl of TANGGAL) {
      const rows = await Q.getDoHarian(unit, tgl);
      let totalNilai = 0;
      for (const r of rows) {
        const aktif = sisaSoAktif(r.sisa, r.sisa_macet);
        if (r.sisa === 0 && aktif === 0) continue;
        const harga = effectiveBuyPrice(buyRows, r.ckdbbm, tgl);
        const nilai = harga === null ? null : aktif * harga;
        if (nilai !== null) totalNilai += nilai;
        baris.push({
          tgl, bbm: r.ckdbbm,
          sisa_mentah: r.sisa, macet: r.sisa_macet, sisa_aktif: aktif,
          pra_b6: PRA_B6[tgl]?.[r.ckdbbm] ?? "",
          harga_beli: harga, nilai: nilai === null ? "TANPA HARGA" : Math.round(nilai),
        });
      }
      baris.push({ tgl, bbm: "── TOTAL", sisa_mentah: "", macet: "", sisa_aktif: "",
                   pra_b6: "", harga_beli: "", nilai: Math.round(totalNilai) });
    }
    console.table(baris);
    expect(baris.length).toBeGreaterThan(10); // penjaga tanpa subjek = gagal
  }, 300_000);
});
