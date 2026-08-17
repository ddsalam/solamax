import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga NAMA TABEL — silang-periksa setiap tabel yang disebut kueri mentah
 * terhadap `schema.prisma`, di **dashboard DAN backend**.
 *
 * 🔴 **KELAS YANG DITUTUPNYA.** Saat menulis Layar 5 saya memakai
 * `FROM so_header` — tabel yang TIDAK ADA. Itu jatuh `42P01` **saat
 * dijalankan**, dan empat lapis penjaga melewatinya: `check-sql-syntax` adalah
 * parser (gramatikanya sempurna), `tsc` tak tahu isi string, uji unit tak
 * menyentuh DB, dan uji integrasi di-skip tanpa DB.
 *
 * 🔴 **DAN VERSI PERTAMA PENJAGA INI SENDIRI PUNYA TIGA LUBANG** — ditemukan
 * saat diminta memperluasnya ke backend:
 *
 * 1. **Ia hanya memindai dashboard.** Jalur `/ingest` — yang berjalan terhadap
 *    `solamax-pg` tiap beberapa menit tanpa ada yang membuka layar — tak
 *    dipindai sama sekali. `42P01` di dashboard = satu layar merah untuk satu
 *    orang yang lalu melapor; `42P01` di ingest = sinkronisasi berhenti, dan
 *    repo ini punya sejarahnya (Bakau 34 jam).
 * 2. **Nama ber-TANDA-KUTIP tak terlihat.** Pola lamanya menuntut huruf sesudah
 *    `FROM`, jadi `FROM "delivery"` lolos — dan justru itulah bentuk yang
 *    dipakai jalur ingest (`sql.ts`: `FROM "delivery"`, `USING "tebus_header"`).
 *    Penjaga yang buta pada bentuk yang dipakai kode paling berbahaya tak
 *    menjaga apa pun di sana.
 * 3. **Pintu darurat CTE bercakupan BERKAS.** `src.includes(`${n} AS (`)`
 *    memaafkan nama apa pun yang kebetulan sama dengan CTE di mana pun dalam
 *    berkas yang sama, jadi salah tulis yang bernasib baik lolos. Ditambah
 *    daftar-lewat yang dipatok tangan (`bounds`, `biz`) yang akan tumbuh
 *    diam-diam tiap ada CTE baru. Kini CTE dikumpulkan **per-kueri**, dan
 *    daftar tangan itu dihapus.
 *
 * ⚠️ **BATAS YANG TETAP ADA, dan ditulis alih-alih didiamkan:**
 *
 *   · **Nama yang disusun DINAMIS tak terlihat** — `FROM public."${table}"`
 *     (uji idempotensi backend) dan `INSERT INTO "${cfg.table}"` (`sql.ts`).
 *     Untuk yang kedua, sumbernya dijaga terpisah di bawah: seluruh `table:`
 *     di `table-config.ts` ikut disilang-periksa, jadi jalur ingest tetap
 *     tertutup lewat pintu lain.
 *   · Ia memeriksa **NAMA**, bukan **KOLOM**. Kolom yang salah tetap butuh CD.
 */

const DASH = resolve(__dirname, "..");
const BACKEND = resolve(__dirname, "../../../backend/src");
const TABLE_CONFIG = resolve(BACKEND, "ingest/table-config.ts");

function tabelDikenal(): Set<string> {
  const schema = readFileSync(
    resolve(__dirname, "../../../backend/prisma/schema.prisma"),
    "utf8",
  );
  const nama = [...schema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]!);
  const out = new Set<string>();
  for (const n of nama) {
    out.add(n);
    out.add(`app.${n}`);
    out.add(`public.${n}`);
  }
  out.add("_prisma_migrations");
  return out;
}

/**
 * Berkas yang MENJALANKAN kueri — berkas tes DIKECUALIKAN.
 *
 * ⚠️ Batas yang disengaja, dan alasannya bukan kenyamanan: berkas tes memuat
 * regex SQL, prosa, dan kutipan `GRANT … TO role` / `REVOKE … FROM role`, yang
 * semuanya cocok dengan pola tabel tanpa pernah dijalankan. Memasukkannya
 * menghasilkan puluhan positif-palsu, dan penjaga yang berbunyi palsu akan
 * dimatikan dalam sebulan.
 *
 * Yang hilang karena batas ini: `ingest.idempotency.test.ts` memang menjalankan
 * kueri — tetapi ia uji integrasi ber-DB yang gagal LANTANG bila nama tabelnya
 * salah, jadi ia tak butuh penjaga statis.
 */
function berkasTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasTs(p);
    if (!/\.tsx?$/.test(e.name)) return [];
    return /\.(test|spec)\.tsx?$/.test(e.name) ? [] : [p];
  });
}

/** Nama tabel + CTE yang dikenal DALAM SATU kueri (satu template literal). */
const RE_TABEL = /\b(?:FROM|JOIN|INTO|USING)\s+(?:"?(app|public)"?\.)?"?([a-z_][a-z0-9_]*)"?/g;
/**
 * Nama CTE (dan alias subkueri) dalam SATU kueri.
 *
 * Sengaja longgar: bentuk `WITH x AS (` / `, y AS (` gagal begitu ada komentar
 * SQL di antara koma dan namanya — dan itu benar-benar terjadi di `queries.ts`.
 * Yang dipakai karena itu bentuk CTE apa adanya, `<nama> AS (`.
 *
 * ⚠️ Ongkosnya disebut: nama tabel yang salah tulis TAPI kebetulan juga muncul
 * sebagai `<nama> AS (` **di kueri yang sama** akan dimaafkan. Itu jauh lebih
 * sempit daripada bentuk lama (yang memaafkan kecocokan di mana pun dalam
 * BERKAS yang sama), dan tak butuh daftar-lewat yang dipatok tangan.
 */
const RE_CTE = /\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi;

/** Potong sumber jadi kueri-kueri: isi setiap template literal & string. */
function kueriDalam(src: string): string[] {
  return [
    ...[...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]!),
    ...[...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]!),
    ...[...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]!),
  ].filter((q) => /\b(FROM|JOIN|INTO|USING)\s/i.test(q));
}

/** Nama yang bukan tabel: fungsi set-returning & katalog sistem. */
const BUKAN_TABEL = new Set([
  "unnest", "generate_series", "jsonb_to_recordset", "json_to_recordset",
  "pg_constraint", "pg_roles", "pg_type", "pg_namespace", "pg_class", "pg_index",
  "pg_indexes", "pg_tables", "pg_attribute", "information_schema", "pg_catalog",
]);

interface Pelanggaran {
  berkas: string;
  nama: string;
}

function periksa(dirs: readonly string[], dikenal: ReadonlySet<string>): Pelanggaran[] {
  const out: Pelanggaran[] = [];
  for (const f of dirs.flatMap(berkasTs)) {
    const src = readFileSync(f, "utf8");
    for (const q of kueriDalam(src)) {
      // ⛔ CTE dikumpulkan PER-KUERI, bukan per-berkas.
      const cte = new Set([...q.matchAll(RE_CTE)].map((m) => m[1]!.toLowerCase()));
      for (const m of q.matchAll(RE_TABEL)) {
        const skema = m[1] ?? "";
        const nama = m[2]!;
        if (BUKAN_TABEL.has(nama) || cte.has(nama.toLowerCase())) continue;
        const penuh = skema === "" ? nama : `${skema}.${nama}`;
        if (!dikenal.has(penuh)) out.push({ berkas: f, nama: penuh });
      }
    }
  }
  return out;
}

describe("nama tabel di kueri mentah harus ada di schema.prisma", () => {
  const dikenal = tabelDikenal();

  it("penjaga ini punya SUBJEK — schema terbaca & tabelnya banyak", () => {
    expect(dikenal.size).toBeGreaterThan(30);
    expect(dikenal.has("sales_header")).toBe(true);
    expect(dikenal.has("app.manual_entry")).toBe(true);
  });

  it("🔴 DAYA-BEDA: nama yang tak ada memang ditolak", () => {
    // Tanpa baris ini, penjaga di bawah bisa hijau karena `dikenal` kebetulan
    // memuat segalanya. `so_header` adalah nama yang menggigit saya di Layar 5.
    expect(dikenal.has("so_header")).toBe(false);
    expect(dikenal.has("tabel_yang_tak_pernah_ada")).toBe(false);
  });

  it("🔴 DAYA-BEDA: nama ber-TANDA-KUTIP ikut terlihat", () => {
    // Lubang #2: bentuk `FROM "delivery"` adalah yang dipakai jalur ingest.
    const palsu = periksa([], dikenal);
    expect(palsu).toEqual([]); // sanity
    const q = 'const s = `DELETE FROM "so_header" WHERE x`;';
    const cte = new Set<string>();
    const nama = [...(kueriDalam(q)[0] ?? "").matchAll(RE_TABEL)].map((m) => m[2]);
    expect(nama, "nama ber-kutip tak terdeteksi").toContain("so_header");
    expect(cte.size).toBe(0);
  });

  it("dashboard: setiap nama tabel menunjuk tabel yang ada", () => {
    const p = periksa([DASH], dikenal);
    expect(p, `tabel tak dikenal:\n${p.map((x) => `${x.berkas}: ${x.nama}`).join("\n")}`).toEqual([]);
  });

  it("🔴 BACKEND ikut dipindai — di situlah jalur /ingest hidup", () => {
    const p = periksa([BACKEND], dikenal);
    expect(p, `tabel tak dikenal:\n${p.map((x) => `${x.berkas}: ${x.nama}`).join("\n")}`).toEqual([]);
  });

  it("🔴 nama tabel DINAMIS jalur ingest dijaga lewat pintu lain: table-config", () => {
    // `INSERT INTO "${cfg.table}"` tak terlihat regex mana pun. Yang bisa
    // dijaga adalah SUMBER nilainya, dan itu satu berkas.
    const cfg = readFileSync(TABLE_CONFIG, "utf8");
    const nama = [...cfg.matchAll(/^\s*table:\s*"([a-z_]+)"/gm)].map((m) => m[1]!);
    expect(nama.length, "table-config tak terbaca — penjaga tanpa subjek").toBeGreaterThan(10);
    const asing = nama.filter((n) => !dikenal.has(n));
    expect(asing, `table-config menyebut tabel tak dikenal: ${asing.join(", ")}`).toEqual([]);
  });

  it("batas yang TIDAK dijaga tertulis di berkas ini", () => {
    // Batas yang tak tertulis akan disangka tertutup.
    const src = readFileSync(__filename, "utf8");
    expect(src).toMatch(/disusun DINAMIS tak terlihat/);
    expect(src).toMatch(/NAMA\*\*, bukan \*\*KOLOM/);
    expect(src).toMatch(/berkas tes DIKECUALIKAN/);
    expect(src).toMatch(/Ongkosnya disebut/);
  });
});
