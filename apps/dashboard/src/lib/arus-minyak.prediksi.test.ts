/**
 * PENYEGEL PREDIKSI (di-skip kecuali diminta) — menuliskan tabel Arus Minyak yang
 * DIPREDIKSI SolaMax untuk daftar (unit, tanggal), dari jalur produksi
 * `buildArusMinyak`, SEBELUM oracle-nya dibuka.
 *
 * Alasannya satu: membedakan "kode kita benar" dari "kita menyesuaikan diri
 * dengan gambar". Prediksi yang disegel sesudah melihat data bukan prediksi
 * (pelajaran onboarding 28 Oktober).
 *
 * PRASYARAT yang WAJIB diperiksa lebih dulu — juga pelajaran 28 Oktober: segel
 * hanya sah bila domain yang memberi makan kolomnya sudah selesai backfill.
 * Berkas ini mencetak status `sync_state` per unit di kepala keluarannya supaya
 * prasyarat itu ikut tersegel, bukan diasumsikan.
 *
 *   SCOPE_LIVE_DB=1 ARUS_SEGEL=1 ARUS_TARGET="6478101:2026-08-01,..." \
 *   pnpm --filter @solamax/dashboard test -- prediksi
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildArusMinyak } from "@/lib/arus-minyak";
import { num2 } from "@/lib/format";
import { addDays, monthStart } from "@/lib/periods";

const AKTIF = process.env.SCOPE_LIVE_DB === "1" && process.env.ARUS_SEGEL === "1";
const d = AKTIF ? describe : describe.skip;
const OUT = process.env.ARUS_SEGEL_OUT ?? "/tmp/arus-prediksi.md";

d("segel prediksi Arus Minyak", () => {
  it("menulis prediksi + status backfill", async () => {
    const Q = await import("@/lib/queries");
    const { pool, q } = await import("@/lib/db");
    type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];

    const target = (process.env.ARUS_TARGET ?? "").split(",").filter(Boolean);
    expect(target.length, "ARUS_TARGET kosong").toBeGreaterThan(0);

    const baris: string[] = [];
    // Prasyarat backfill ikut tersegel.
    const sync = await q<{ unit_id: number; code: string; name: string; domain: number; last: string }>(
      `SELECT u.unit_id, u.code, u.name, count(s.domain)::int AS domain,
              to_char(max(s.last_run_at AT TIME ZONE 'Asia/Pontianak'),'YYYY-MM-DD HH24:MI') AS last
         FROM public.unit u LEFT JOIN public.sync_state s ON s.unit_id = u.unit_id
        WHERE u.active GROUP BY 1,2,3 ORDER BY 1`,
    );
    baris.push("## Prasyarat backfill (tersegel bersama prediksi)\n");
    baris.push("| unit | kode | domain ter-sync | sync terakhir |");
    baris.push("|---|---|---:|---|");
    for (const s of sync) baris.push(`| ${s.name} | ${s.code} | ${s.domain}/14 | ${s.last} |`);
    baris.push("");

    const KOL = ["Stock Awal", "Penerimaan", "Penjualan", "Stock Teori", "Stock Fisik", "Losses", "%"];
    for (const t of target) {
      const [code, date] = t.split(":");
      const [u] = await q<{ unit_id: number; name: string }>(
        `SELECT unit_id, name FROM public.unit WHERE code = $1`,
        [code],
      );
      expect(u, `unit ${code} tak ada`).toBeDefined();
      const id = u!.unit_id as SUID;
      const [glRows, zc] = await Promise.all([
        Q.getDailyGlByProduct(id, monthStart(date!), date!),
        Q.getZeroClosingEvents([id], addDays(date!, -1), addDays(date!, 1)),
      ]);
      const a = buildArusMinyak(
        glRows.filter((r) => r.d === date),
        zc.filter((z) => z.d === date),
      );
      baris.push(`### ${u!.name} (${code}) — ${date}`);
      baris.push(
        `tera hari ini **${num2(a.teraTotal)} L** · provisional ${a.provisional} · ` +
          `penutup-nol ${a.zeroClosingCount} · tangki dikecualikan ${a.excludedTanks}`,
      );
      baris.push("");
      baris.push(`| Produk | ${KOL.join(" | ")} |`);
      baris.push(`|---|${KOL.map(() => "---:").join("|")}|`);
      for (const r of [...a.rows, a.total])
        baris.push(
          `| ${r.nama}${r.zeroClosing ? " ⚠" : ""} | ${num2(r.awal)} | ${num2(r.penerimaan)} | ` +
            `${num2(r.penjualan)} | ${num2(r.teori)} | ${num2(r.fisik)} | ${num2(r.losses)} | ${num2(r.pct)} |`,
        );
      baris.push("");
    }
    writeFileSync(OUT, baris.join("\n"));
    console.log(`prediksi tersegel → ${OUT} (${target.length} unit-tanggal)`);
    await pool.end();
  }, 600_000);
});
