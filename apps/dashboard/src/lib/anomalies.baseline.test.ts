import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * BUKTI NETRALITAS-PERILAKU untuk perbaikan konkurensi `buildAnomalies`
 * (keputusan owner D3 + koreksi K2, 2026-07-24). BUKAN test regresi harian.
 *
 * Prosedur (dijalankan DUA KALI dalam satu sesi, terhadap Cloud SQL yang sama):
 *   1. Pada commit SEBELUM perubahan:  ANOMALIES_BASELINE=write  → tulis fixture.
 *   2. Pada commit SESUDAH perubahan:  ANOMALIES_BASELINE=write  → tulis ulang.
 *      `git diff` atas fixture WAJIB KOSONG. Itulah buktinya — bukan "test hijau".
 *   (mode `ANOMALIES_BASELINE=check` membandingkan tanpa menulis.)
 *
 * Sengaja TIDAK jalan di CI: fixture memotret data LIVE pada 2026-07-24 dan akan
 * basi besok. Ia artefak pembuktian satu kali, bukan ekspektasi yang dipelihara.
 *
 * Field turunan JAM-DINDING di-mask (`<ago>`): `ago()` bergranularitas MENIT di
 * bawah 90 menit, jadi dua run berjarak beberapa menit pasti berbeda karena
 * alasan yang tak ada hubungannya dengan perubahan konkurensi. Mask-nya sempit &
 * bisa diaudit (hanya string ber-bentuk ago), dan `dateIso`/`sev`/`desc` — yang
 * benar-benar membawa angka — TIDAK di-mask.
 */
const MODE = process.env.ANOMALIES_BASELINE; // "write" | "check" | undefined
const LIVE = !!MODE && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const FIXTURE = join(__dirname, "__fixtures__", "anomalies-baseline-2026-07-24.json");
const AGO_RE = /^(baru saja|\d+ mnt lalu|\d+ jam lalu|\d+ hari lalu|[\d.,]+ TAHUN lalu)$/;

function maskAgo(s: string): string {
  if (AGO_RE.test(s)) return "<ago>";
  // Judul kas-dorman menyisipkan ago() dalam kurung: "… (1,9 TAHUN lalu)".
  return s.replace(/\(([^()]*(?:lalu|baru saja))\)/g, (_m, inner: string) =>
    AGO_RE.test(inner) ? "(<ago>)" : `(${inner})`,
  );
}

d("buildAnomalies — kontrak keluaran (bukti netralitas konkurensi)", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it(
    "keluaran ketujuh unit identik dengan fixture",
    async () => {
      const { buildAnomalies } = await import("./anomalies");
      type SU = Parameters<typeof buildAnomalies>[0][number];
      const UNITS = [
        { unit_id: 1, code: "6478111", name: "Imam Bonjol" },
        { unit_id: 2, code: "6378301", name: "Bakau" },
        { unit_id: 3, code: "6478101", name: "Adisucipto" },
        { unit_id: 4, code: "6478106", name: "Bundaran Kotabaru" },
        { unit_id: 5, code: "6478201", name: "Batu Layang" },
        { unit_id: 6, code: "6478311", name: "Korek" },
        { unit_id: 7, code: "63781002", name: "28 Oktober" },
      ] as unknown as SU[];

      const items = await buildAnomalies(UNITS);
      // URUTAN keluaran ikut dibandingkan (sort JS stabil → urutan sisip ikut terkunci).
      const shaped = items.map((a) => ({
        tone: a.tone,
        tier: a.tier,
        sev: a.sev,
        dateIso: a.dateIso,
        title: maskAgo(a.title),
        unit: a.unit,
        desc: a.desc,
        time: maskAgo(a.time),
        href: a.href ?? null,
        standing: a.standing ?? false,
      }));
      const json = `${JSON.stringify({ count: shaped.length, items: shaped }, null, 2)}\n`;

      if (MODE === "write") {
        writeFileSync(FIXTURE, json);
        console.log(`fixture ditulis: ${shaped.length} item`);
        return;
      }
      expect(json).toBe(readFileSync(FIXTURE, "utf8"));
    },
    { timeout: 900_000 },
  );
});
