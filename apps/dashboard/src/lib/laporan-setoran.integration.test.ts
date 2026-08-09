import { afterAll, describe, expect, it } from "vitest";
import { adminStatus, pasangkanSetoranKemarin } from "./compliance";
import { adopsiRincian } from "./config";
import { setoranCheck } from "./laporan-model";
import { uangTunai } from "./rekon";
import type { ScopedUnitId } from "./scope-rule";

/**
 * DUA JALUR, SATU ANGKA — uji DB-live untuk cek "Setoran Bank Sesuai" (U1).
 *
 * Yang diuji: **dua jalur query yang berbeda menghasilkan H yang sama.**
 *
 *   jalur A (per-domain) : getSalesByProduct + getTerraResmiForDate +
 *                          getPelangganForDate + getEdcForDate + manual
 *   jalur B (agregat SQL): getAdminDays — satu query
 *
 * Itu invarian yang memang harus benar: **uang tunai yang sama di papan Ketaatan
 * dan di lembar Laporan.** Perubahan semantik di salah satu jalur (filter
 * `sbatal`, kunci tanggal, definisi B) memerahkannya.
 *
 * ⛔ YANG TES INI **TIDAK** BUKTIKAN: bahwa HALAMAN Laporan menyambungkan query
 * yang benar ke `terra`. Halaman itu Server Component — daftar query-nya sebaris
 * dan tak bisa di-import, jadi jalur A di bawah adalah **salinan** pilihan
 * halaman, bukan pembacanya. Baris terra & pelanggan sama-sama punya
 * `{liter, rp}`, jadi tertukar pun lolos type-check. Yang menjaga ITU adalah
 * penjaga sumber di laporan-model.test.ts — bukan berkas ini.
 *
 * Jalan hanya bila SCOPE_LIVE_DB=1 & DATABASE_URL di-set (CI default skip).
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;
const U = (n: number) => n as unknown as ScopedUnitId;

/** "Hari ini" TETAP — supaya vonis tak berubah arti saat kalender bergerak. */
const HARI_INI = "2026-08-09";

/**
 * Kasus dipilih dari pengukuran jendela 2026-07-27…08-08 supaya KETIGA nada
 * terwakili. Kalau semuanya `ok`, tes ini tak akan pernah membedakan apa pun.
 */
const KASUS = [
  { kode: "6478111", tanggal: "2026-08-03", vonis: "kurang_setor", state: "fail" },
  { kode: "6478111", tanggal: "2026-07-29", vonis: "lebih_setor", state: "fail" },
  { kode: "6478111", tanggal: "2026-08-01", vonis: "selaras", state: "ok" },
] as const;

d("Setoran Bank Sesuai — dua jalur query, satu H", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  const unitId = async (kode: string): Promise<number> => {
    const { q } = await import("./db");
    const rows = await q<{ unit_id: number }>("SELECT unit_id FROM unit WHERE code = $1", [kode]);
    const id = rows[0]?.unit_id;
    if (id === undefined) throw new Error(`unit ${kode} tak ada`);
    return id;
  };

  for (const k of KASUS) {
    it(`${k.kode} ${k.tanggal} → ${k.vonis} (${k.state})`, async () => {
      const Q = await import("./queries");
      const { addDays } = await import("./periods");
      const u = U(await unitId(k.kode));

      // ── jalur A: query per-domain, persis yang dipakai halaman Laporan ──
      const [prod, terra, pelanggan, edc, fRows, gRows, iRows, iKemarinRows, shift] =
        await Promise.all([
          Q.getSalesByProduct(u, k.tanggal, k.tanggal),
          Q.getTerraResmiForDate(u, k.tanggal),
          Q.getPelangganForDate(u, k.tanggal),
          Q.getEdcForDate(u, k.tanggal),
          Q.getManualEntries(u, k.tanggal, "pendapatan_lain"),
          Q.getManualEntries(u, k.tanggal, "pengeluaran"),
          Q.getManualEntries(u, k.tanggal, "setoran_tunai"),
          Q.getManualEntries(u, addDays(k.tanggal, -1), "setoran_tunai"),
          Q.getShiftInfo(u, k.tanggal),
        ]);
      const hA = uangTunai({
        A: prod.reduce((t, p) => t + p.omzet, 0),
        B: terra.reduce((t, r) => t + r.rp, 0),
        C: pelanggan.reduce((t, r) => t + r.rp, 0),
        D: edc.reduce((t, r) => t + r.rp, 0),
        F: fRows.reduce((t, r) => t + r.amount, 0),
        G: gRows.reduce((t, r) => t + r.amount, 0),
      });

      // ── jalur B: getAdminDays (agregat di SQL), jalur papan Ketaatan ──
      const rows = await Q.getAdminDays([u], addDays(k.tanggal, -1), k.tanggal);
      const pasangan = pasangkanSetoranKemarin(rows).find((x) => x.hari.d === k.tanggal);
      const r = pasangan?.hari;
      if (!r) throw new Error(`tak ada baris getAdminDays untuk ${k.kode} ${k.tanggal}`);
      const hB = uangTunai({
        A: r.compA, B: r.compB, C: r.compC, D: r.compD, F: r.compF, G: r.compG,
      });

      // KONTROL ANTI-VAKUM: H nol di kedua jalur akan "cocok" tanpa arti.
      expect(Math.abs(hA)).toBeGreaterThan(1_000_000);
      // Inti tes: dua jalur, satu angka (toleransi 1 rupiah = pembulatan float8).
      expect(Math.abs(hA - hB)).toBeLessThanOrEqual(1);

      const iA = iRows.length > 0 ? iRows.reduce((t, x) => t + x.amount, 0) : null;
      expect(iA).toBe(r.setoran);

      const v = adminStatus(
        {
          adopsi: adopsiRincian(k.kode),
          nPendapatanLain: fRows.length,
          nPengeluaran: gRows.length,
          nSetoran: iRows.length,
          h: hA,
          i: iA,
          iSebelumnya:
            iKemarinRows.length > 0 ? iKemarinRows.reduce((t, x) => t + x.amount, 0) : null,
          shifts: shift.shifts,
        },
        { businessDate: k.tanggal, today: HARI_INI },
      );
      expect(v.kode).toBe(k.vonis);
      expect(setoranCheck(v, hA, iA).state).toBe(k.state);
    }, 60_000);
  }
});
