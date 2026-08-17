import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga NAMA TABEL — silang-periksa setiap tabel yang disebut kueri mentah
 * terhadap `schema.prisma`.
 *
 * 🔴 **KELAS YANG DITUTUPNYA, dan ia baru saja menggigit saya sendiri.** Saat
 * menulis Layar 5 saya memakai `FROM so_header` — tabel yang **TIDAK ADA**
 * (data SO hidup di `tebus_header`/`tebus_detail`). Itu akan jatuh `42P01`
 * **saat dijalankan**, dan tak satu pun penjaga yang ada bisa menangkapnya:
 *
 *   · `check-sql-syntax` adalah **parser**, bukan eksekutor — `FROM so_header`
 *     gramatikanya sempurna;
 *   · `tsc` tak tahu apa pun tentang isi string SQL;
 *   · uji unit tak menyentuh DB;
 *   · `queries.sqlcheck.integration.test.ts` butuh DB dan di-skip tanpa
 *     `SCOPE_LIVE_DB`.
 *
 * Jadi kelas ini punya lubang selebar arc ini, dan yang menemukannya kebetulan:
 * saya memeriksa nama tabel sebelum commit. Penjaga ini menggantikan kebetulan
 * itu.
 *
 * ⚠️ BATASNYA: ia memeriksa NAMA, bukan kolom, dan hanya pada `FROM`/`JOIN`
 * ber-nama-literal. Kolom yang salah tetap butuh CD.
 */

const LIB = __dirname;
const APP = resolve(LIB, "../app");

/** Nama tabel yang dikenal Prisma, ditambah alias schema-qualified `app.*`. */
function tabelDikenal(): Set<string> {
  const schema = readFileSync(
    resolve(LIB, "../../../backend/prisma/schema.prisma"),
    "utf8",
  );
  const nama = [...schema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]!);
  const out = new Set<string>();
  for (const n of nama) {
    out.add(n);
    out.add(`app.${n}`);
    out.add(`public.${n}`);
  }
  // Tabel milik Prisma sendiri, tak ber-@@map.
  out.add("_prisma_migrations");
  return out;
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasTs(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("nama tabel di kueri mentah harus ada di schema.prisma", () => {
  const dikenal = tabelDikenal();

  it("penjaga ini punya SUBJEK — schema terbaca & tabelnya banyak", () => {
    expect(dikenal.size).toBeGreaterThan(30);
    expect(dikenal.has("sales_header")).toBe(true);
    expect(dikenal.has("app.manual_entry")).toBe(true);
  });

  it("🔴 DAYA-BEDA: tabel yang tak ada memang ditolak", () => {
    // Tanpa baris ini, penjaga di bawah bisa hijau karena `dikenal` kebetulan
    // memuat segalanya. Inilah nama yang menggigit saya di Layar 5.
    expect(dikenal.has("so_header")).toBe(false);
  });

  it("setiap FROM/JOIN ber-nama-literal menunjuk tabel yang ada", () => {
    const pelanggaran: string[] = [];
    for (const f of [...berkasTs(LIB), ...berkasTs(APP)]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+((?:app|public)\.)?([a-z_][a-z0-9_]*)/g)) {
        const nama = `${m[1] ?? ""}${m[2]}`;
        // Lewati kata kunci SQL & CTE yang jelas bukan tabel.
        if (["unnest", "generate_series", "pg_constraint", "pg_roles", "pg_type", "pg_namespace",
             "information_schema", "bounds", "biz"].includes(m[2]!)) continue;
        if (!dikenal.has(nama) && !src.includes(`${m[2]} AS (`) && !src.includes(`WITH ${m[2]}`)) {
          pelanggaran.push(`${f.replace(LIB, "lib").replace(APP, "app")}: ${nama}`);
        }
      }
    }
    expect(pelanggaran, `tabel tak dikenal:\n${pelanggaran.join("\n")}`).toEqual([]);
  });
});
