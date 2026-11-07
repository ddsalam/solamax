#!/usr/bin/env node
/**
 * Tunggu sampai DB sasaran memuat SEMUA migrasi Prisma yang ada di commit ini,
 * sebelum gerbang K1 (sqlcheck) mengeksekusi query dashboard terhadapnya.
 *
 * ⛔ KENAPA ADA (7 Nov 2026, #471): satu push ke `staging` menyentuh backend
 * DAN dashboard. Dua workflow berjalan paralel; `sqlcheck` dashboard menembak
 * `solamax-pg-rlsstg` SEBELUM `migrate-test` backend selesai memasang 0060 →
 * `relation "app.correction_request" does not exist` → merah palsu, hijau
 * sesudah rerun. Tak ada `needs:` lintas-workflow di GitHub Actions, jadi yang
 * ditunggu adalah KEADAAN DB-nya, bukan run backend-nya.
 *
 * Pada push `main` DB rlsstg sudah memuat migrasinya (push staging lebih dulu)
 * → lolos seketika. Push yang tak membawa migrasi baru → lolos seketika.
 *
 * Gagal TERTUTUP: lewat batas waktu, keluar 1 sambil menyebut migrasi yang
 * belum terpasang — biasanya `migrate-test` backend gagal atau tak berjalan.
 *
 * MASUKAN (env): DATABASE_URL (tak pernah dicetak), MIGRASI_DIR (bawaan:
 * apps/backend/prisma/migrations), TUNGGU_BATAS_DETIK (1800), TUNGGU_JEDA_DETIK (20).
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Migrasi `diharapkan` yang belum SELESAI di DB. Baris yang belum selesai
 * (sedang jalan, gagal/P3009) atau di-rollback tidak dihitung terpasang.
 */
export function belumTerpasang(diharapkan, baris) {
  const selesai = new Set(
    baris.filter((r) => r.finished_at != null && r.rolled_back_at == null).map((r) => r.migration_name),
  );
  return diharapkan.filter((m) => !selesai.has(m));
}

export function migrasiDiCommit(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}_/.test(e.name))
    .map((e) => e.name)
    .sort();
}

async function main() {
  const { default: pg } = await import("pg");
  const dir =
    process.env.MIGRASI_DIR ??
    fileURLToPath(new URL("../../backend/prisma/migrations", import.meta.url));
  const batas = Number(process.env.TUNGGU_BATAS_DETIK ?? 1800);
  const jeda = Number(process.env.TUNGGU_JEDA_DETIK ?? 20);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL wajib diisi");

  const diharapkan = migrasiDiCommit(dir);
  if (diharapkan.length === 0) throw new Error(`tak ada migrasi di ${dir} — salah path?`);
  console.log(`commit memuat ${diharapkan.length} migrasi (terakhir ${diharapkan.at(-1)})`);

  const mulai = Date.now();
  for (;;) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    let kurang;
    try {
      await client.connect();
      const { rows } = await client.query(
        "SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations",
      );
      kurang = belumTerpasang(diharapkan, rows);
    } finally {
      await client.end().catch(() => {});
    }
    const lewat = Math.round((Date.now() - mulai) / 1000);
    if (kurang.length === 0) {
      console.log(`✅ DB memuat semua migrasi commit ini (menunggu ${lewat} dtk)`);
      return;
    }
    if (lewat >= batas) {
      console.error(
        `❌ sesudah ${lewat} dtk DB masih belum memuat: ${kurang.join(", ")}\n` +
          "   Periksa run 'Deploy backend' untuk commit ini — job migrate-test gagal atau tak berjalan.",
      );
      process.exit(1);
    }
    console.log(`… ${lewat} dtk: menunggu migrate backend memasang ${kurang.join(", ")}`);
    await new Promise((r) => setTimeout(r, jeda * 1000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
