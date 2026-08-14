#!/usr/bin/env node
/**
 * Penjaga SINTAKS SQL untuk seluruh migrasi Prisma.
 *
 *   node scripts/ci/check-sql-syntax.mjs
 *
 * ⛔ MASALAH YANG DITUTUPNYA. Sampai berkas ini ada, TIDAK ADA satu pun
 * pemeriksaan sintaks SQL di repo:
 *   · `prisma validate` memvalidasi `schema.prisma`, BUKAN berkas migrasi;
 *   · penjaga di `keuangan-migrasi.test.ts` memindai TEKS (ada/tidaknya
 *     pernyataan), bukan keabsahannya.
 * Akibatnya salah ketik SQL apa pun lolos `pnpm check`, lolos seluruh gerbang
 * §9, dan baru jatuh saat `migrate deploy` — SESUDAH merge, dengan CD tersumbat.
 *
 * Itu terjadi 13 Agustus 2026: dua baris `///` (doc-comment Prisma schema) di
 * dalam `0030_edc_settlement/migration.sql`. SQL hanya mengenal `--`.
 *
 * Ini BUKAN pemindai teks lagi: ia memakai parser Postgres yang sebenarnya
 * (libpg_query, dikompilasi ke WASM lewat `pg-query-emscripten`). Yang
 * dinyatakannya sah adalah yang Postgres sendiri anggap sah secara gramatika.
 *
 * ⚠️ BATASNYA — sebut apa adanya: ini **parser**, bukan eksekutor.
 *   · TERTANGKAP: gramatika salah — `///`, kurung tak seimbang, kata kunci
 *     salah tempat, dollar-quote tak tertutup.
 *   · TIDAK TERTANGKAP: apa pun yang baru gagal saat DIJALANKAN — kolom/tabel
 *     tak dikenal, tipe tak cocok, urutan seed-vs-RLS (`42501`), pelanggaran
 *     constraint. Urutan seed-vs-RLS sudah dijaga terpisah oleh blok
 *     "KELAS: seed ter-scope unit mendahului RLS" di `keuangan-migrasi.test.ts`.
 *   Yang membuktikan migrasi benar-benar berjalan tetap CD tier testing.
 *
 * Kenapa instance parser DIBUAT ULANG tiap berkas: memakai satu instance untuk
 * banyak `parse()` membuat modul WASM-nya crash di tengah jalan (terbukti saat
 * berkas ini ditulis — 30 migrasi berturut-turut menjatuhkan prosesnya). Biaya
 * membuat ulang ~4 ms/berkas; keandalan lebih murah daripada itu.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * Direktori migrasi. Argumen pertama menimpanya — dipakai
 * `check-sql-syntax.selftest.sh` supaya self-test menjalankan CHECKER INI
 * SENDIRI terhadap kasus tiruan, bukan meniru logikanya. Self-test yang meniru
 * hanya menguji tiruannya.
 */
const MIG_DIR = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(HERE, "../../apps/backend/prisma/migrations");

/** `cursorpos` (1-indexed, byte) → "baris:kolom" + kutipan barisnya. */
function tunjukkan(sql, cursorpos) {
  const pos = Math.max(0, (cursorpos ?? 1) - 1);
  const sebelum = sql.slice(0, pos);
  const baris = sebelum.split("\n").length;
  const kolom = pos - (sebelum.lastIndexOf("\n") + 1) + 1;
  const isi = sql.split("\n")[baris - 1] ?? "";
  return { baris, kolom, isi: isi.trim().slice(0, 120) };
}

async function main() {
  let PgQuery;
  try {
    ({ default: PgQuery } = await import("pg-query-emscripten"));
  } catch {
    console.error(
      "::error::`pg-query-emscripten` tidak terpasang. Jalankan `pnpm install` di root.",
    );
    process.exit(1);
  }

  const berkas = readdirSync(MIG_DIR)
    .filter((d) => /^\d{4}_/.test(d))
    .sort();

  if (berkas.length === 0) {
    // Jangan pernah hijau karena tak ada subjek.
    console.error("::error::Tidak ada migrasi ditemukan — penjaga ini tak punya subjek.");
    process.exit(1);
  }

  const mulai = Date.now();
  const gagal = [];

  for (const d of berkas) {
    const path = join(MIG_DIR, d, "migration.sql");
    const sql = readFileSync(path, "utf8");
    // Instance SEGAR — lihat catatan di kepala berkas.
    const pg = await new PgQuery();
    const hasil = pg.parse(sql);
    if (hasil.error) {
      const { baris, kolom, isi } = tunjukkan(sql, hasil.error.cursorpos);
      gagal.push({ d, pesan: hasil.error.message, baris, kolom, isi });
    }
  }

  if (gagal.length > 0) {
    for (const g of gagal) {
      console.error(
        `::error file=apps/backend/prisma/migrations/${g.d}/migration.sql,line=${g.baris}::` +
          `${g.pesan} (baris ${g.baris}:${g.kolom})`,
      );
      console.error(`    ${g.d}:${g.baris}  ${g.isi}`);
    }
    console.error(
      `\n${gagal.length} dari ${berkas.length} migrasi TIDAK SAH secara sintaks SQL.\n` +
        "Ingat: SQL hanya mengenal komentar `--`; `///` adalah doc-comment Prisma schema.",
    );
    process.exit(1);
  }

  console.log(
    `OK: ${berkas.length} migrasi sah secara sintaks SQL (${Date.now() - mulai} ms). ` +
      "Batas: parser, bukan eksekutor — kesalahan saat DIJALANKAN tetap butuh CD.",
  );
}

await main();
