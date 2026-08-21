import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga HAK DML — saudara dari `nama-tabel.guard.test.ts`, untuk kelas yang
 * sama tetapi sisi lain: **DML yang menyebut tabel yang haknya tidak diberikan
 * kepada `dashboard_app`.**
 *
 * 🔴 KELASNYA. `DELETE FROM app.cash_account` gramatikanya sempurna, tabelnya
 * ada, `tsc` tak keberatan, dan uji unit tak menyentuh DB — lalu ia jatuh
 * **`42501` saat dijalankan**, di produksi, pada orang pertama yang menekan
 * tombolnya. Persis bentuk `so_header`, ditukar dari "tabel tak ada" jadi
 * "hak tak ada".
 *
 * ⚠️ Sumber kebenarannya **migrasi**, bukan daftar yang ditulis tangan di sini:
 * `GRANT …` memberi, `REVOKE …` mencabut, dan yang terakhir menang. Daftar
 * tangan akan basi pada migrasi berikutnya, dan basinya tak bersuara.
 *
 * ⚠️ BATAS, ditulis alih-alih didiamkan:
 *   · hanya DML ber-**nama literal**; `${cfg.table}` tak terlihat (sama seperti
 *     saudaranya, dan jalur ingest memang dijaga lewat `table-config`);
 *   · hanya `app.*` — tabel `public` adalah cermin EasyMax yang di-ingest
 *     backend dengan role berbeda;
 *   · berkas **tes** dikecualikan: mereka memuat kutipan `GRANT`/`REVOKE`
 *     sebagai teks, dan memasukkannya menghasilkan positif-palsu.
 *   · 🔴 **tabel yang haknya diberikan DI LUAR migrasi tak terlihat.** Ditemukan
 *     saat penjaga ini pertama dijalankan: ia menuduh tujuh DML di layar
 *     `/admin` — yang HIDUP di produksi — tak punya hak. Yang salah premisnya,
 *     bukan kodenya: **`app.membership` dan `app.user_unit` tidak punya satu pun
 *     `GRANT` di migrasi mana pun**; haknya diberikan langsung di DB, sejak
 *     sebelum disiplin grant-lewat-migrasi ada.
 *
 *     Karena itu penjaga ini hanya menilai tabel yang migrasinya MEMANG
 *     menyebutkan haknya. Tabel yang tak pernah disebut dilewati — bukan
 *     dianggap boleh, melainkan **diakui tak diketahui**. Penjaga yang menebak
 *     pada data yang tak dimilikinya akan menuduh kode yang benar, dan tuduhan
 *     palsu adalah cara tercepat sebuah penjaga dimatikan.
 *
 * 🔴 **LUBANG YANG PERNAH ADA DI SINI, DAN SUDAH DITUTUP.** Sampai 19 Agu 2026,
 *    TUJUH tabel dipakai kode tanpa satu pun GRANT di migrasi mana pun:
 *
 *      app.users · app.accounts · app.sessions · app.verification_token
 *      app.membership · app.user_unit · app.tenant
 *
 *    Ketujuhnya jalur autentikasi. Haknya dipasang DI LUAR migrasi saat deploy
 *    B1 (`ALTER DEFAULT PRIVILEGES` — dirujuk di komentar 0004/0006/0007, tak
 *    pernah dieksekusi). Akibatnya bukan "/admin mati di DB yang dibangun
 *    ulang", melainkan **LOGIN yang mati**.
 *
 *    Ditutup `0035_grant_auth_tables` (keputusan owner 18 Agu 2026,
 *    AUTH-RBAC-DESIGN.md §7). Dan karena ketidaktahuan itu kini punya obatnya,
 *    ia **berhenti jadi pengecualian dan menjadi kegagalan**: tabel yang dipakai
 *    kode tetapi tak pernah disebut GRANT mana pun MEMERAHKAN penjaga ini.
 *
 *    ⚠️ Batas yang tetap: migrasi ini MENAMBAH, tak mencabut. Produksi masih
 *    memegang `arwd` pada ketujuhnya dari default privileges tangan itu, jadi
 *    hak yang terbaca penjaga ini adalah hak DB BARU — bukan potret produksi.
 */

const MIG = resolve(__dirname, "../../../backend/prisma/migrations");
const DASH = resolve(__dirname, "..");

type Aksi = "SELECT" | "INSERT" | "UPDATE" | "DELETE";
const AKSI: Aksi[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** Hak `dashboard_app` per tabel `app.*`, dibaca dari SELURUH migrasi berurut. */
function hakDashboardApp(): Map<string, Set<Aksi>> {
  const out = new Map<string, Set<Aksi>>();
  const dirs = readdirSync(MIG).filter((d) => /^\d{4}_/.test(d)).sort();
  for (const d of dirs) {
    const f = join(MIG, d, "migration.sql");
    if (!existsSync(f)) continue;
    const sql = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const m of sql.matchAll(
      /\b(GRANT|REVOKE)\s+([A-Z, ]+?)\s+ON\s+"?app"?\."?([a-z_]+)"?\s+(?:TO|FROM)\s+dashboard_app/gi,
    )) {
      const jenis = m[1]!.toUpperCase();
      const aksi = m[2]!.split(",").map((x) => x.trim().toUpperCase()).filter((x): x is Aksi =>
        (AKSI as string[]).includes(x),
      );
      const tabel = m[3]!;
      const set = out.get(tabel) ?? new Set<Aksi>();
      for (const a of aksi) {
        if (jenis === "GRANT") set.add(a);
        else set.delete(a); // yang TERAKHIR menang — urutan migrasi dipertahankan
      }
      out.set(tabel, set);
    }
  }
  return out;
}

function berkasKode(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasKode(p);
    if (!/\.tsx?$/.test(e.name)) return [];
    return /\.(test|spec)\.tsx?$/.test(e.name) ? [] : [p];
  });
}

/** DML ber-nama-literal ke `app.<tabel>`. */
const RE_DML = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?app"?\."?([a-z_]+)"?/gi;
/** BACA ber-nama-literal — membaca pun menuntut SELECT. */
const RE_BACA = /\b(FROM|JOIN)\s+"?app"?\."?([a-z_]+)"?/gi;

function aksiDari(kata: string): Aksi {
  const k = kata.toUpperCase();
  if (k.startsWith("INSERT")) return "INSERT";
  if (k.startsWith("DELETE")) return "DELETE";
  return "UPDATE";
}

/**
 * Cari direktori paket dengan ALGORITMA RESOLUSI NODE — naik dari berkas ini ke
 * tiap induk, cari `node_modules/<paket>`. Bukan tebakan path relatif.
 *
 * ⛔ Kenapa bukan `createRequire(...).resolve()`: @auth/pg-adapter hanya
 * mengekspor kondisi `import` (`exports: {".": {import: "./index.js"}}`), jadi
 * `require.resolve` gagal ERR_PACKAGE_PATH_NOT_EXPORTED — diverifikasi, bukan
 * dikira. Dan penjaga ini butuh TEKS sumbernya, bukan modulnya.
 *
 * ⛔ Kenapa bukan daftar kandidat: penjaga harus menemukan subjeknya lewat
 * mekanisme yang SAMA di CI dan di mesin pengembang. Daftar path bekerja sampai
 * satu tata-letak install berbeda, lalu memerah di tempat yang salah — dan
 * penjaga yang merah hanya di satu tempat mengajari orang mengabaikannya.
 */
export function cariBerkasPaket(mulai: string, subpath: string): string | null {
  let dir = mulai;
  for (;;) {
    const kandidat = join(dir, "node_modules", subpath);
    if (existsSync(kandidat)) return kandidat;
    const induk = dirname(dir);
    if (induk === dir) return null;
    dir = induk;
  }
}

/**
 * Petik LITERAL yang isinya SQL dari sumber JavaScript.
 *
 * ⚠️ MASALAH YANG DITUTUPNYA: regex tabel dijalankan atas JAVASCRIPT, bukan SQL.
 * `import x from "pg"` cocok dengan pola `from <nama>`. Selama ada saringan
 * daftar-nama, kebisingan itu tersembunyi; begitu saringannya dilepas — dan ia
 * HARUS dilepas, lihat di bawah — ia banjir. Jadi yang dipindai bukan seluruh
 * berkas, melainkan hanya literal (backtick / kutip) yang isinya benar-benar
 * SQL. Pembedanya kata kerja SQL di dalam literal itu sendiri.
 */
export function literalSql(sumber: string): string[] {
  const literal = sumber.match(/`[^`]*`|'[^'\n]*'|"[^"\n]*"/g) ?? [];
  return literal.filter((l) => /\b(select|insert\s+into|update|delete\s+from)\b/i.test(l));
}

/**
 * Tabel yang disentuh adapter, dari SQL-nya sendiri.
 *
 * ⛔ TIDAK ADA SARINGAN DAFTAR-NAMA DI SINI, dan itu inti perbaikannya. Versi
 * sebelumnya menyaring `if (hak.has(t) || [empat nama].includes(t))` — yang
 * membuang **tepat kelas yang dicari**: adapter yang menyentuh tabel yang BELUM
 * punya GRANT (kasus paling berbahaya, dan persis kasus yang melahirkan 0035)
 * tak masuk himpunan, jadi asersinya tetap hijau. Nama tak dikenal WAJIB lolos
 * masuk lalu memerahkan sesuatu, bukan disaring keluar diam-diam.
 */
export function tabelAdapter(sumber: string): Set<string> {
  const out = new Set<string>();
  for (const l of literalSql(sumber)) {
    for (const m of l.matchAll(/\b(?:from|into|join|update)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      out.add(m[1]!.toLowerCase());
    }
  }
  return out;
}

/**
 * Pemeriksa hak adapter — SATU fungsi, dipakai baik oleh uji atas adapter NYATA
 * maupun oleh uji atas adapter KARANGAN.
 *
 * ⛔ Kenapa terpisah: saat pemeriksanya ditulis inline di dalam uji, mutasi yang
 * melumpuhkannya tetap HIJAU — adapter nyata tak punya satu pun tabel tanpa hak,
 * jadi asersi itu tak punya kasus gagal yang tersedia. Uji karangan sudah ada,
 * tetapi ia menyalin logikanya alih-alih memanggilnya, jadi keduanya tak saling
 * menjaga. Satu pembuat vonis, dua pemanggil.
 */
export function adapterTanpaHak(sumber: string, hak: Map<string, Set<Aksi>>): string[] {
  return [...tabelAdapter(sumber)].filter((t) => !hak.get(t)?.has("SELECT")).sort();
}

/**
 * Pelanggaran pada SATU sumber, sebagai fungsi murni — supaya penjaganya bisa
 * disodori data karangan dan terbukti MEMERAH. Penjaga yang hanya pernah melihat
 * repo yang sehat tak pernah membuktikan apa pun.
 */
export function pelanggaranPada(sumber: string, hak: Map<string, Set<Aksi>>): string[] {
  const out: string[] = [];
  for (const m of sumber.matchAll(RE_DML)) {
    const aksi = aksiDari(m[1]!);
    const tabel = m[2]!;
    const punya = hak.get(tabel);
    if (punya === undefined) out.push(`TANPA GRANT: ${aksi} app.${tabel}`);
    else if (!punya.has(aksi)) out.push(`${aksi} app.${tabel}`);
  }
  for (const m of sumber.matchAll(RE_BACA)) {
    const tabel = m[2]!;
    const punya = hak.get(tabel);
    if (punya === undefined) out.push(`TANPA GRANT: SELECT app.${tabel}`);
    else if (!punya.has("SELECT")) out.push(`SELECT app.${tabel}`);
  }
  return out;
}

describe("DML dashboard hanya menyentuh tabel app.* yang haknya diberikan", () => {
  const hak = hakDashboardApp();

  it("penjaga ini punya SUBJEK — hak terbaca dari migrasi, bukan dikarang", () => {
    expect(hak.size).toBeGreaterThan(5);
    expect([...(hak.get("cash_account") ?? [])].sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("🔴 DAYA-BEDA: REVOKE benar-benar mencabut — DELETE tak ada di cash_account", () => {
    // Tanpa baris ini, penjaga di bawah bisa hijau karena parsernya memberi
    // segalanya kepada semua tabel.
    expect(hak.get("cash_account")?.has("DELETE")).toBe(false);
    expect(hak.get("manual_entry")?.has("DELETE")).toBe(false);
    expect(hak.get("audit_log")?.has("UPDATE")).toBe(false);
  });

  it("🔴 setiap PEMAKAIAN app.* punya haknya — tak diketahui = GAGAL, bukan dilewati", () => {
    const langgar: string[] = [];
    for (const f of berkasKode(DASH)) {
      for (const p of pelanggaranPada(readFileSync(f, "utf8"), hak)) {
        langgar.push(`${f.replace(DASH, "src")}: ${p}`);
      }
    }
    expect(
      langgar,
      `Pemakaian app.* tanpa hak di migrasi mana pun:\n${langgar.join("\n")}`,
    ).toEqual([]);
  });

  it("penjaga ini MENEMUKAN HIMPUNANNYA SENDIRI, dan himpunannya tak sepele", () => {
    // Tanpa baris ini, nol pelanggaran bisa berarti "tak ada yang diperiksa".
    const dipakai = new Set<string>();
    for (const f of berkasKode(DASH)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(RE_DML)) dipakai.add(m[2]!);
      for (const m of src.matchAll(RE_BACA)) dipakai.add(m[2]!);
    }
    expect(dipakai.size).toBeGreaterThan(15);
    // Tabel autentikasi yang DIPAKAI KODE KITA — dulu "tak diketahui", kini wajib.
    for (const t of ["users", "membership", "user_unit", "tenant"]) {
      expect(dipakai.has(t), `${t} tak lagi terpakai kode?`).toBe(true);
      expect(hak.get(t)?.has("SELECT"), `app.${t} tanpa GRANT SELECT di migrasi`).toBe(true);
    }
  });

  it("🔴 TABEL YANG SQL-NYA DI node_modules ikut ditemukan — bukan diketik dari ingatan", () => {
    // ⛔ BATAS PENJAGA MANA PUN YANG MEMINDAI KODE KITA: `sessions`, `accounts`,
    // dan `verification_token` TIDAK PERNAH muncul sebagai `app.<tabel>` di repo
    // ini. SQL-nya milik @auth/pg-adapter. Penjaga yang berhenti di batas repo
    // akan melaporkan "semua aman" atas tiga tabel yang tak pernah ia lihat —
    // dan justru ketiganya jalur login.
    const berkas = cariBerkasPaket(__dirname, join("@auth", "pg-adapter", "index.js"));
    // Adapter tak ketemu = penjaga TANPA SUBJEK. Itu kegagalan, bukan lewat.
    expect(berkas, "@auth/pg-adapter tak ditemukan lewat resolusi node_modules").not.toBeNull();
    const sumber = readFileSync(berkas!, "utf8");
    const ditemukan = tabelAdapter(sumber);

    // (a) SIFAT KEAMANANNYA: apa pun yang disentuh adapter harus punya haknya.
    //     Nama yang tak dikenal sampai ke sini dan MEMERAHKAN baris ini.
    const tanpaHak = adapterTanpaHak(sumber, hak);
    expect(
      tanpaHak,
      `Adapter menyentuh tabel tanpa GRANT di migrasi mana pun: ${tanpaHak.join(", ")}`,
    ).toEqual([]);

    // (b) KOMPOSISINYA: adapter yang di-upgrade dan menyentuh tabel lain — punya
    //     hak atau tidak — memerahkan baris ini, jadi turunan hak di 0035 wajib
    //     ditinjau ulang, bukan diasumsikan masih benar.
    expect([...ditemukan].sort()).toEqual([
      "accounts",
      "sessions",
      "users",
      "verification_token",
    ]);

    // (c) Hak yang DITURUNKAN dari adapter (0035), bukan arwd borongan:
    expect([...(hak.get("sessions") ?? [])].sort()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    expect(hak.get("accounts")?.has("UPDATE"), "adapter tak pernah UPDATE accounts").toBe(false);
    expect(hak.get("verification_token")?.has("UPDATE")).toBe(false);
    expect(hak.get("user_unit")?.has("UPDATE"), "pola DELETE-lalu-INSERT").toBe(false);
    expect([...(hak.get("tenant") ?? [])].sort()).toEqual(["SELECT"]);
  });

  it("🔴 DATANYA BISA MENJATUHKANNYA: adapter karangan yang menyentuh tabel tak ber-GRANT", () => {
    // Kelas yang versi sebelumnya MUSTAHIL laporkan — saringannya membuangnya.
    const palsu = 'const sql = `insert into tabel_hantu (a) values ($1)`';
    expect(tabelAdapter(palsu).has("tabel_hantu")).toBe(true);
    // Lewat PEMBUAT VONIS YANG SAMA dengan uji atas adapter nyata — bukan salinan.
    expect(adapterTanpaHak(palsu, hak)).toEqual(["tabel_hantu"]);

    // Kontrol: tabel yang SAH tidak menghasilkan pelanggaran.
    expect(adapterTanpaHak('const sql = `select * from users where id = $1`', hak)).toEqual([]);

    // ⛔ SUMBUNYA SELECT, BUKAN SEKADAR "ADA GRANT". Tabel yang punya GRANT
    // tetapi TANPA SELECT tetap pelanggaran — adapter yang membacanya akan kena
    // 42501. Tak ada tabel begini di migrasi hari ini, jadi kasusnya dikarang;
    // tanpa ini, vonis "punya hak apa pun" lolos tanpa pernah ketahuan.
    const hakSempit = new Map([["foo", new Set<Aksi>(["INSERT"])]]);
    expect(adapterTanpaHak("const sql = `insert into foo (a) values (1)`", hakSempit)).toEqual([
      "foo",
    ]);
    const hakBaca = new Map([["foo", new Set<Aksi>(["SELECT"])]]);
    expect(adapterTanpaHak("const sql = `insert into foo (a) values (1)`", hakBaca)).toEqual([]);
  });

  it("🔴 SQL DIBEDAKAN DARI KODE DI SEKITARNYA — `import … from \"pg\"` bukan tabel", () => {
    // Melonggarkan saringan memunculkan kebisingan yang sebelumnya tersembunyi.
    // Tanpa baris ini, perbaikan cacat #2 akan ditukar dengan banjir positif-palsu.
    const js = [
      'import { Pool } from "pg";',
      'import { readFileSync } from "node:fs";',
      'export * from "./adapter";',
      'const x = orders.filter(o => o.id);',
    ].join("\n");
    expect([...tabelAdapter(js)]).toEqual([]);

    // Dan pembedanya BEKERJA dua arah: SQL di dalam literal tetap terbaca,
    // meski berkas yang sama penuh `import … from`.
    const campur = `${js}\nconst sql = \`delete from sessions where id = $1\`;`;
    expect([...tabelAdapter(campur)]).toEqual(["sessions"]);
  });

  it("🔴 0035 adalah GRANT-SAJA — keputusan owner, bukan gaya", () => {
    // §7 AUTH-RBAC-DESIGN.md: migrasi ini menuliskan hak yang SUDAH dipegang
    // kedua DB. Satu REVOKE atau satu perubahan skema di sini mengubahnya dari
    // "praktis tanpa efek di produksi" jadi perubahan pada DB hidup — dan modul
    // keuangan sudah menyala di sana.
    const f = join(MIG, "0035_grant_auth_tables", "migration.sql");
    expect(existsSync(f), "0035 hilang").toBe(true);
    const sql = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\b(CREATE|DROP|ALTER)\s+(TABLE|SCHEMA|TYPE|INDEX|POLICY)\b/i);
    expect(sql).not.toMatch(/\bALTER\s+DEFAULT\s+PRIVILEGES\b/i);
    expect(sql).not.toMatch(/\bALL\s+TABLES\s+IN\s+SCHEMA\b/i);
    expect(sql).not.toMatch(/\bALL\s+SEQUENCES\s+IN\s+SCHEMA\b/i);
    // Dan ia memang berisi GRANT — bukan lulus karena kosong.
    expect((sql.match(/\bGRANT\b/gi) ?? []).length).toBe(10);
  });

  it("batas yang TIDAK dijaga tertulis di berkas ini", () => {
    const src = readFileSync(__filename, "utf8");
    expect(src).toMatch(/nama literal/);
    expect(src).toMatch(/berkas \*\*tes\*\* dikecualikan/);
    expect(src).toMatch(/DI LUAR migrasi tak terlihat/);
  });
});
