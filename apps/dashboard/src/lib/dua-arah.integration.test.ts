import { afterAll, describe, expect, it } from "vitest";
import { adminStatus, pasangkanSetoranKemarin, SETORAN_TOLERANSI_RP } from "./compliance";
import { adopsiRincian } from "./config";
import { uangTunai } from "./rekon";
import type { ScopedUnitId } from "./scope-rule";

const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;
const U = (n: number) => n as unknown as ScopedUnitId;
const DARI = "2026-06-01";
const SAMPAI = "2026-08-08";
const HARI_INI = "2026-08-09";

d("pemindaian salin-setoran TANPA ARAH", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("pasangan identik, dipilah: tertangkap vs terlewat", async () => {
    const { getAdminDays } = await import("./queries");
    const { q } = await import("./db");
    const kode = new Map(
      (await q<{ unit_id: number; code: string }>("SELECT unit_id, code FROM unit")).map((u) => [
        u.unit_id, u.code,
      ]),
    );
    const rows = await getAdminDays([...kode.keys()].map(U), DARI, SAMPAI);
    const perUnit = new Map<number, (typeof rows)[number][]>();
    for (const r of rows) perUnit.set(r.unit_id, [...(perUnit.get(r.unit_id) ?? []), r]);

    const H = (r: (typeof rows)[number]) =>
      uangTunai({ A: r.compA, B: r.compB, C: r.compC, D: r.compD, F: r.compF, G: r.compG });
    const dinilai = (r: (typeof rows)[number]) =>
      adminStatus(
        {
          adopsi: adopsiRincian(kode.get(r.unit_id) ?? ""),
          nPendapatanLain: r.nPendapatanLain, nPengeluaran: r.nPengeluaran, nSetoran: r.nSetoran,
          h: H(r), i: r.setoran, iSebelumnya: null, shifts: r.shifts,
        },
        { businessDate: r.d, today: HARI_INI },
      ).kode;

    let nPasang = 0, identik = 0, tertangkap = 0, terlewat = 0, keduanya = 0, fgi = 0;
    // Sasaran perbaikan #2: F & G tersalin walau I sudah diperbaiki.
    let fgIdentik = 0, fgIdentikTanpaI = 0;
    const rinci: string[] = [];
    for (const [uid, list] of perUnit) {
      const asc = [...list].sort((a, b) => a.d.localeCompare(b.d));
      for (const { hari: baru, iSebelumnya } of pasangkanSetoranKemarin(asc)) {
        const lamaFG = asc[asc.indexOf(baru) - 1];
        if (lamaFG && baru.compF === lamaFG.compF && baru.compG === lamaFG.compG
            && (baru.compF !== 0 || baru.compG !== 0)) {
          fgIdentik++;
          if (baru.setoran !== lamaFG.setoran) fgIdentikTanpaI++;
        }
        if (iSebelumnya === null || baru.setoran === null) continue;
        nPasang++;
        if (baru.setoran !== iSebelumnya) continue;
        identik++;
        const lama = asc[asc.indexOf(baru) - 1]!;
        const bedaBaru = Math.abs(baru.setoran - H(baru)) > SETORAN_TOLERANSI_RP;
        const bedaLama = Math.abs((lama.setoran ?? 0) - H(lama)) > SETORAN_TOLERANSI_RP;
        // Hanya hari yang MEMANG dinilai (bukan pending) yang bisa jadi alarm.
        const nilaiBaru = dinilai(baru), nilaiLama = dinilai(lama);
        const bisaBaru = bedaBaru && !["pra_adopsi", "hari_berjalan", "tak_terhitung"].includes(nilaiBaru);
        const bisaLama = bedaLama && !["pra_adopsi", "hari_berjalan", "tak_terhitung"].includes(nilaiLama);
        if (bisaBaru && bisaLama) keduanya++;
        else if (bisaBaru) tertangkap++;
        else if (bisaLama) terlewat++;
        const sama = baru.compF === lama.compF && baru.compG === lama.compG;
        if (sama) fgi++;
        rinci.push(
          `${kode.get(uid)} ${lama.d}→${baru.d} I=${baru.setoran} ` +
            `ΔlamaR=${Math.round((lama.setoran ?? 0) - H(lama))} ΔbaruR=${Math.round(baru.setoran - H(baru))} ` +
            `F&G-ikut-identik=${sama ? "YA" : "tidak"} [${bisaLama ? "TERLEWAT" : ""}${bisaBaru ? "TERTANGKAP" : ""}${!bisaBaru && !bisaLama ? "sunyi-sah" : ""}]`,
        );
      }
    }
    console.log(`\nJENDELA ${DARI} … ${SAMPAI} · ${perUnit.size} unit`);
    console.log(`pasangan diperiksa      : ${nPasang}`);
    console.log(`I identik               : ${identik}`);
    console.log(`  tertangkap aturan kini: ${tertangkap}`);
    console.log(`  TERLEWAT (arah mundur): ${terlewat}`);
    console.log(`  kedua hari tak-selaras: ${keduanya}`);
    console.log(`  F & G ikut identik    : ${fgi}`);
    console.log(`F&G identik (non-nol)   : ${fgIdentik}  · di antaranya I SUDAH beda: ${fgIdentikTanpaI}`);
    console.log("rinci:\n  " + (rinci.join("\n  ") || "(tak ada)"));
    // Anti-vakum. Ambang 300 adalah TEBAKAN SAYA dan ia meleset: pasangan
    // menuntut KEDUA hari punya setoran non-null, dan lantai adopsi masih muda,
    // jadi 102 memang jendela penuhnya. Ambang diturunkan ke 50 — tetap jauh di
    // atas nol, tetap menolak jendela yang menciut senyap.
    expect(nPasang).toBeGreaterThan(50);
  }, 60_000);
});
