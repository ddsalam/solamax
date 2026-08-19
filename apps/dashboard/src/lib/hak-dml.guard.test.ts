import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

function aksiDari(kata: string): Aksi {
  const k = kata.toUpperCase();
  if (k.startsWith("INSERT")) return "INSERT";
  if (k.startsWith("DELETE")) return "DELETE";
  return "UPDATE";
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

  it("setiap DML ber-nama-literal punya haknya", () => {
    const langgar: string[] = [];
    for (const f of berkasKode(DASH)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(RE_DML)) {
        const aksi = aksiDari(m[1]!);
        const tabel = m[2]!;
        const punya = hak.get(tabel);
        // Tabel yang tak pernah disebut migrasi mana pun: TIDAK DIKETAHUI,
        // bukan tidak boleh. Lihat batas di kepala berkas.
        if (punya === undefined) continue;
        if (!punya.has(aksi)) {
          langgar.push(`${f.replace(DASH, "src")}: ${aksi} app.${tabel}`);
        }
      }
    }
    expect(langgar, `DML tanpa hak:\n${langgar.join("\n")}`).toEqual([]);
  });

  it("batas yang TIDAK dijaga tertulis di berkas ini", () => {
    const src = readFileSync(__filename, "utf8");
    expect(src).toMatch(/nama literal/);
    expect(src).toMatch(/berkas \*\*tes\*\* dikecualikan/);
    expect(src).toMatch(/DI LUAR migrasi tak terlihat/);
  });
});
