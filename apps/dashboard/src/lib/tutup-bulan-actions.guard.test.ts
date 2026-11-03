import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas tutup bulan (rencana 2026-10-29 U12; R25; KTD14) — urutan
 * kunci → baca ulang → vonis → tulis, satu pembuat vonis, gerbang baca/tulis.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const MENTAH = readFileSync(resolve(__dirname, "tutup-bulan-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
/** Inti audit bersama (satu salinan SQL) — dipanggil lewat `auditKeuangan(`. */
const KODE_TX = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-tx.ts"), "utf8"));
const Q = tanpaKomentar(readFileSync(resolve(__dirname, "tutup-bulan-queries.ts"), "utf8"));
const HAL = tanpaKomentar(
  readFileSync(resolve(__dirname, "../app/(app)/keuangan/unit/[code]/tutup-bulan/[bulan]/page.tsx"), "utf8"),
);
const PERIKSA = tanpaKomentar(readFileSync(resolve(__dirname, "../components/keuangan/TutupBulanPeriksa.tsx"), "utf8"));
const TOMBOL = tanpaKomentar(readFileSync(resolve(__dirname, "../components/keuangan/TutupBulanTombol.tsx"), "utf8"));

describe("tutupBulan — penjagaan yang tak boleh hilang", () => {
  const fn = KODE.slice(KODE.indexOf("export async function tutupBulan"));

  it("penjaga ini punya SUBJEK; berkas aksi 'use server'", () => {
    expect(fn).toMatch(/export async function tutupBulan/);
    expect(MENTAH).toMatch(/^"use server";/);
  });

  it("🔴 wewenang HoF SEBELUM koneksi", () => {
    expect(urutan(fn, "canTutupBulan(", "pool.connect()")).toBe("ok");
  });

  it("🔴 URUTAN: RLS → kunci eksklusif bulan → kunci baris → BACA ULANG → vonis → tulis → audit → COMMIT", () => {
    expect(urutan(fn, "set_config('app.unit_ids'", "kunciBulanEksklusif(client")).toBe("ok");
    expect(urutan(fn, "kunciBulanEksklusif(client", "FOR UPDATE")).toBe("ok");
    expect(urutan(fn, "FOR UPDATE", "bacaBahanTutupBulan(client")).toBe("ok");
    expect(urutan(fn, "bacaBahanTutupBulan(client", "periksaTutupBulan(")).toBe("ok");
    expect(urutan(fn, "periksaTutupBulan(", "INSERT INTO app.tutup_bulan")).toBe("ok");
    expect(urutan(fn, "INSERT INTO app.tutup_bulan", "auditKeuangan(client")).toBe("ok");
    expect(urutan(fn, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Jejak audit tinggal di satu salinan bersama (keuangan-tx.ts).
    expect(KODE_TX).toMatch(/INSERT INTO app\.audit_log \(actor_user_id, actor_email, action, target, detail\)/);
  });

  it("🔴 vonis MENOLAK (bukan sekadar dipanggil); masukan dibaca lewat KLIEN TRANSAKSI, bukan qScoped", () => {
    expect(fn).toMatch(/if \(!vonis\.boleh\) \{\s*await batal\(client\);\s*return \{ ok: false/);
    expect(fn).toMatch(/const bahan = await bacaBahanTutupBulan\(client, unit\.unit_id, input\.bulan\)/);
    expect(fn).not.toMatch(/getBahanTutupBulan|qScoped/);
  });

  it("idempoten: baris yang sudah ada dijawab 'sudah ditutup' SEBELUM membaca syarat; ON CONFLICT DO NOTHING", () => {
    expect(urutan(fn, "sudah.rows.length > 0", "bacaBahanTutupBulan(client")).toBe("ok");
    expect(fn).toMatch(/ON CONFLICT \(unit_id, bulan\) DO NOTHING/);
    expect(fn).toMatch(/"tutup_bulan\.tutup"/);
  });

  it("🔴 aturan R25 tidak disalin di aksi, halaman, atau komponen — satu pembuat vonis", () => {
    for (const src of [KODE, HAL, PERIKSA, TOMBOL]) {
      expect(src).not.toMatch(/KATEGORI_PENAMPUNG|Mutasi Belum Teridentifikasi|ADJ-FWD-REVERSAL|saldoAwal\b/);
    }
    expect(HAL).toMatch(/const vonis = periksaTutupBulan\(bahan\)/);
  });

  it("🔴 K6 U11 R33: pembentukan ulang SEBELUM vonis, di klien transaksi; buku_besar ditulis dari vonis", () => {
    expect(urutan(fn, "bacaBahanTutupBulan(client", "bukuBesarTerkini(client")).toBe("ok");
    expect(urutan(fn, "bukuBesarTerkini(client", "periksaTutupBulan({ ...bahan, bukuBesar })")).toBe("ok");
    expect(fn).toMatch(/INSERT INTO app\.tutup_bulan \(unit_id, bulan, ditutup_by_user_id, buku_besar\)/);
    expect(fn).toMatch(/\[unit\.unit_id, `\$\{input\.bulan\}-01`, scope\.userId, vonis\.bukuBesar\]/);
    const bb = KODE.slice(KODE.indexOf("async function bukuBesarTerkini"));
    expect(bb).toMatch(/async function bukuBesarTerkini/);
    // Hanya bila aktif DAN syarat K5 lolos; setiap hari bulan itu; baca ULANG sesudahnya.
    expect(urutan(bb, "syaratK5Lolos(", "bentukUlangHari(client")).toBe("ok");
    expect(bb).toMatch(/for \(const d of hariDalamBulan\(bulan\)\)/);
    expect(urutan(bb, "bentukUlangHari(client", "bacaBahanBukuBesar(client")).toBe("ok");
  });

  it("tanpa UPDATE/DELETE atas tutup_bulan (bulan tertutup beku)", () => {
    expect(KODE).not.toMatch(/UPDATE app\.tutup_bulan|DELETE FROM/i);
  });
});

describe("kunci bulan — eksklusif bagi penutup, bersama bagi jalur tulis, KUNCI DULU baru BACA", () => {
  it("🔴 bulanTertutupTerkunci: kunci bersama (urut) SEBELUM membaca tutup_bulan", () => {
    const f = Q.slice(Q.indexOf("export async function bulanTertutupTerkunci"));
    expect(urutan(f, "pg_advisory_xact_lock_shared(", "FROM app.tutup_bulan")).toBe("ok");
    expect(f).toMatch(/\.sort\(\)/);
  });

  it("🔴 pembentukan ulang buku besar memakai kunci bulan yang sama — impor, bukan salinan", () => {
    const tulis = tanpaKomentar(readFileSync(resolve(__dirname, "buku-besar-tulis.ts"), "utf8"));
    expect(tulis).toMatch(/import \{ KUNCI_BULAN_SQL \} from "\.\/tutup-bulan-queries"/);
    expect(tulis).toMatch(/pg_advisory_xact_lock_shared\(\$\{KUNCI_BULAN_SQL\}\)/);
    expect(tulis).not.toMatch(/hashtextextended\('tutup-bulan:/);
  });

  it("🔴 penutup & jalur tulis memakai kunci yang SAMA (satu ekspresi)", () => {
    const n = (Q.match(/KUNCI_BULAN_SQL/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(3); // definisi + eksklusif + bersama
    expect(Q).toMatch(/pg_advisory_xact_lock\(\$\{KUNCI_BULAN_SQL\}\)/);
    expect(Q).toMatch(/pg_advisory_xact_lock_shared\(\$\{KUNCI_BULAN_SQL\}\)/);
  });

  it("🔴 K6 U11 R28: rekening wajib = SEMUA rekening bank aktif (PREDIKAT_REKENING_BANK), bukan BCA saja", () => {
    expect(Q).toMatch(/export const PREDIKAT_REKENING_BANK = `kind = 'bank' AND active`/);
    expect(Q).not.toMatch(/PREDIKAT_REKENING_BCA/);
    const rek = Q.slice(Q.indexOf("export const SQL_REKENING_WAJIB"), Q.indexOf("export const SQL_IMPOR_BULAN"));
    expect(rek).toMatch(/\$\{PREDIKAT_REKENING_BANK\}/);
    // 'menunggu' (U10) dibaca terpisah — tak pernah dihitung sebagai rekening koran aktif.
    expect(rek).toMatch(/r\.status = 'aktif' AND r\.periode = \$2::date\) AS "rekeningKoranAktif"/);
    expect(rek).toMatch(/r\.status = 'menunggu' AND r\.periode = \$2::date\) AS "rekeningKoranMenunggu"/);
    // Saldo & mutasi menurut TANGGAL EFEKTIF (tanggal asal ?? hari buku).
    expect(rek).toMatch(/COALESCE\(l\.tanggal_asal, l\.business_date\) < \(\$2::date \+ interval '1 month'\)/);
    const buku = Q.slice(Q.indexOf("export const SQL_BUKU_BULAN"));
    expect(buku).toMatch(/\$\{PREDIKAT_REKENING_BANK\}/);
  });
});

describe("halaman tutup bulan — gerbang baca & tombol", () => {
  it("gerbang BACA §10.13 dipakai dan penolakannya terjadi", () => {
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
  });

  it("🔴 tombol HANYA bagi canTutupBulan (dihitung di server), aktif HANYA bila vonis lolos", () => {
    expect(HAL).toMatch(/const bolehTutup = canTutupBulan\(ctx\)/);
    expect(HAL).toMatch(/\{bolehTutup && tertutup === null && <TutupBulanTombol [^>]*siap=\{vonis\.boleh\}/);
    expect(TOMBOL).toMatch(/disabled=\{pending \|\| !siap\}/);
    expect(TOMBOL).not.toMatch(/canTutupBulan|isHeadOfFinance/);
  });
});

describe("jelaskanButirTerbuka (K6 U11, R32) — saran saja, tanpa tulis, tanpa log", () => {
  const awal = KODE.indexOf("export async function jelaskanButirTerbuka");
  const fn = KODE.slice(awal, KODE.indexOf("export async function tutupBulan"));
  const PENJELASAN = tanpaKomentar(readFileSync(resolve(__dirname, "tutup-bulan-penjelasan.ts"), "utf8"));
  const KOMPONEN = tanpaKomentar(readFileSync(resolve(__dirname, "../components/keuangan/TutupBulanPenjelasan.tsx"), "utf8"));

  it("penjaga ini punya SUBJEK (didefinisikan SEBELUM tutupBulan)", () => {
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(fn).toMatch(/jelaskanButir\(/);
  });

  it("🔴 gerbang staf Keuangan / HoF SEBELUM membaca apa pun; vonis dari pembuat vonis yang sama", () => {
    expect(urutan(fn, "bolehMintaPenjelasan(", "getBahanTutupBulan(")).toBe("ok");
    expect(urutan(fn, "getBahanTutupBulan(", "periksaTutupBulan(")).toBe("ok");
    expect(urutan(fn, "periksaTutupBulan(", "jelaskanButir(")).toBe("ok");
  });

  it("🔴 tak menulis apa pun & tak mengubah vonis: tanpa INSERT/UPDATE/pool.connect; hasilnya tanpa `boleh`", () => {
    expect(fn).not.toMatch(/INSERT|UPDATE|pool\.connect|revalidatePath/);
    expect(fn).not.toMatch(/boleh:/);
  });

  it("🔴 isi rekening koran tak pernah ke log", () => {
    for (const src of [fn, PENJELASAN, KOMPONEN]) expect(src).not.toMatch(/console\./);
  });

  it("klien dari buatKlien (kunci ANTHROPIC_API_KEY; kosong ⇒ gagal tertutup), model claude-opus-5-5", () => {
    expect(fn).toMatch(/buatKlien\(\)/);
    expect(PENJELASAN).toMatch(/model: MODEL_PEMBACA/);
  });

  it("komponen tak mengimpor modul AI/DB (hanya aksi & tipe)", () => {
    const impor = KOMPONEN.split("\n").filter((l) => l.includes('from "@/lib/tutup-bulan-penjelasan"'));
    expect(impor.length).toBeGreaterThan(0);
    for (const l of impor) expect(l).toMatch(/^import type /);
    expect(KOMPONEN).not.toMatch(/@anthropic-ai|rekening-koran-ai|@\/lib\/db/);
  });

  it("halaman: tombol penjelasan hanya bagi bolehMintaPenjelasan; tombol tutup tetap canTutupBulan", () => {
    expect(HAL).toMatch(/const bolehJelaskan = bolehMintaPenjelasan\(ctx\)/);
    expect(HAL).toMatch(/\{bolehJelaskan && tertutup === null && !vonis\.boleh && <TutupBulanPenjelasan /);
  });
});
