import { afterAll, describe, expect, it } from "vitest";
import { adminStatus, pasangkanTetangga, SETORAN_TOLERANSI_RP } from "./compliance";
import { adopsiRincian } from "./config";
import { uangTunai } from "./rekon";
import type { ScopedUnitId } from "./scope-rule";

const LIVE = process.env.SCOPE_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;
const U = (n: number) => n as unknown as ScopedUnitId;
const DARI = "2026-06-01";
const SAMPAI = "2026-08-08";
const HARI_INI = "2026-08-09";

/**
 * ⚠️ Berkas ini LAHIR sebagai perancah pengukuran (2026-08-09) untuk menjawab
 * "berapa yang terlewat aturan satu arah". Jawabannya 1 dari 1 — dan setelah
 * aturannya diperbaiki dua arah, perancah itu diubah jadi PENJAGA: setiap
 * pasangan identik yang salah satu harinya tak cocok dengan H-nya SENDIRI wajib
 * menghasilkan `setoran_tersalin`. Nol terlewat.
 *
 * ⛔ BATASNYA: begitu pengawas memperbaiki entrinya, buktinya lenyap dari data
 * hidup dan tes ini jadi hijau-tanpa-kasus. Karena itu ia mencetak jumlah kasus
 * yang benar-benar diperiksa — hijau dengan 0 kasus BUKAN bukti apa pun, dan
 * fixture di compliance.test.ts tetap yang memikul beban pembuktian.
 */
d("salin-setoran DUA ARAH — penjaga pada data hidup", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it("tiap pasangan identik yang tak cocok H-nya sendiri → setoran_tersalin", async () => {
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
          h: H(r), i: r.setoran, f: r.compF, g: r.compG,
          tetangga: { sebelum: null, sesudah: null }, shifts: r.shifts,
        },
        { businessDate: r.d, today: HARI_INI },
      ).kode;

    /** Vonis PENUH — dengan tetangga, jalur produksi apa adanya. */
    const vonis = (r: (typeof rows)[number], tetangga: Parameters<typeof adminStatus>[0]["tetangga"]) =>
      adminStatus(
        {
          adopsi: adopsiRincian(kode.get(r.unit_id) ?? ""),
          nPendapatanLain: r.nPendapatanLain, nPengeluaran: r.nPengeluaran, nSetoran: r.nSetoran,
          h: H(r), i: r.setoran, f: r.compF, g: r.compG, tetangga, shifts: r.shifts,
        },
        { businessDate: r.d, today: HARI_INI },
      );

    let nPasang = 0, identik = 0, tertangkap = 0, terlewat = 0, keduanya = 0, fgi = 0, diperiksa = 0;
    // Sasaran perbaikan #2: F & G tersalin walau I sudah diperbaiki.
    let fgIdentik = 0, fgIdentikTanpaI = 0;
    const rinci: string[] = [];
    for (const [uid, list] of perUnit) {
      const asc = [...list].sort((a, b) => a.d.localeCompare(b.d));
      for (const { hari: baru, tetangga } of pasangkanTetangga(asc)) {
        const iSebelumnya = tetangga.sebelum?.i ?? null;
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
        // PENJAGA: hari yang tak cocok H-nya sendiri HARUS ditandai tersalin.
        for (const [hari, bisa] of [[baru, bisaBaru], [lama, bisaLama]] as const) {
          if (!bisa) continue;
          const t = pasangkanTetangga(asc).find((x) => x.hari.d === hari.d)!.tetangga;
          diperiksa++;
          expect(vonis(hari, t).kode, `${kode.get(uid)} ${hari.d}`).toBe("setoran_tersalin");
        }
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
    // Label lama ("tertangkap/terlewat") menggambarkan klasifikasi aturan SATU
    // ARAH dan sudah tidak berlaku sejak aturannya dua arah — dibiarkan berarti
    // permukaan yang berbohong. Yang dilaporkan sekarang: sisi mana dari
    // pasangan yang tak cocok dengan H-nya sendiri (itu yang ditandai).
    console.log(`  hari LEBIH BARU tak cocok H-nya : ${tertangkap}`);
    console.log(`  hari LEBIH LAMA tak cocok H-nya : ${terlewat}`);
    console.log(`  kedua hari tak-selaras: ${keduanya}`);
    console.log(`  F & G ikut identik    : ${fgi}`);
    console.log(`F&G identik (non-nol)   : ${fgIdentik}  · di antaranya I SUDAH beda: ${fgIdentikTanpaI}`);
    console.log("rinci:\n  " + (rinci.join("\n  ") || "(tak ada)"));
    // Anti-vakum. Ambang 300 adalah TEBAKAN SAYA dan ia meleset: pasangan
    // menuntut KEDUA hari punya setoran non-null, dan lantai adopsi masih muda,
    // jadi 102 memang jendela penuhnya. Ambang diturunkan ke 50 — tetap jauh di
    // atas nol, tetap menolak jendela yang menciut senyap.
    console.log(`kasus yang BENAR-BENAR diasersikan: ${diperiksa}` +
      (diperiksa === 0 ? "  <-- HIJAU TANPA KASUS: bukan bukti apa pun" : ""));
    expect(nPasang).toBeGreaterThan(50);
  }, 60_000);
});
