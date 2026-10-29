import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS aksi klasifikasi (rencana 2026-10-29 U11; R28, R30; KTD5, KTD6,
 * KTD8; Implementation Constraints "Gerbang dua unit") — bentuk
 * `cocok-bank-actions.guard.test.ts`: komentar JS dibuang, urutan lewat
 * `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · gerbang Keuangan (`requireUnit` + predikat) SEBELUM koneksi di setiap aksi;
 *   · setiap jalur yang menulis baris kas: BEGIN → set_config → baris impor /
 *     parkir dibaca ulang → `hariBukuTerkunci(client` → kepala kelompok →
 *     `tulisBarisKlasifikasi(client` (satu-satunya INSERT baris kas);
 *   · antar unit: `requireUnit` unit lawan SEBELUM koneksi; transaksi memuat
 *     KEDUA unit; inti tulisnya `tulisPasanganAntarUnit` (penjaga hari bukunya
 *     sendiri di `antar-unit-actions.guard.test.ts`);
 *   · baris parkir tak pernah disunting; tanpa DELETE; inti tulis bukan
 *     berkas "use server" dan hanya menulis cash_ledger + manual_entry.
 *
 * ⚠️ Batas: membuktikan penjagaan ADA di kode. Perilakunya:
 * `klasifikasi-actions.test.ts` (DB tiruan).
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const MENTAH = readFileSync(resolve(__dirname, "klasifikasi-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
const TULIS_MENTAH = readFileSync(resolve(__dirname, "klasifikasi-tulis.ts"), "utf8");
const TULIS = tanpaKomentar(TULIS_MENTAH);
/** Kode pembukuan maju — satu salinan bersama (keuangan-kode-maju.ts). */
const KODE_MAJU = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-kode-maju.ts"), "utf8"));
const IMPOR_KODE_MAJU = /import \{ KODE_MAJU_IMPOR, KODE_MAJU_SUSPENSE as KODE_MAJU_PENAMPUNG \} from "\.\/keuangan-kode-maju";/;

const badan = (kode: string, nama: string): string => {
  const i = kode.search(new RegExp(`(export )?async function ${nama}\\b`));
  if (i < 0) return "";
  const j = kode.slice(i + 1).search(/\n(export )?(async )?function |\nconst |\nexport (interface|type|const) /);
  return kode.slice(i, j < 0 ? undefined : i + 1 + j);
};

describe("gerbang SEBELUM koneksi", () => {
  it("🔴 jalur satu unit (kategori/parkir/pecah) & pindah: gerbang() → pool.connect()", () => {
    for (const nama of ["klasifikasiSatuUnit", "pindahkanDariPenampung"]) {
      const fn = badan(KODE, nama);
      expect(fn, nama).not.toBe("");
      expect(urutan(fn, "await gerbang(", "pool.connect()"), nama).toBe("ok");
      expect(fn).toMatch(/if \(!g\.boleh\) return \{ ok: false, error: g\.error \}/);
    }
    const g = badan(KODE, "gerbang");
    expect(urutan(g, "scope.requireUnit(code)", "canCocokkanBank(ctx)")).toBe("ok");
    expect(g).toMatch(/if \(!canCocokkanBank\(ctx\)\) return \{ boleh: false/);
  });

  it("🔴 kategori/parkir/pecah lewat jalur satu unit yang SAMA (tak ada pool.connect sendiri)", () => {
    for (const nama of ["klasifikasiKategori", "klasifikasiParkir", "klasifikasiPecah"]) {
      const fn = badan(KODE, nama);
      expect(fn, nama).toMatch(/klasifikasiSatuUnit\(/);
      expect(fn, nama).not.toMatch(/pool\.connect\(\)/);
    }
  });

  it("🔴 R30 antar unit: KEDUA requireUnit + predikat SEBELUM koneksi; app.unit_ids memuat kedua unit", () => {
    const fn = badan(KODE, "klasifikasiAntarUnit");
    expect(fn).not.toBe("");
    expect(urutan(fn, "scope.requireUnit(input.code)", "pool.connect()")).toBe("ok");
    expect(urutan(fn, "canCatatAntarUnit(ctx)", "pool.connect()")).toBe("ok");
    expect(urutan(fn, "scope.units.some((u) => u.code === input.lawanCode)", "pool.connect()")).toBe("ok");
    expect(urutan(fn, "scope.requireUnit(input.lawanCode)", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/if \(!scope\.units\.some\(\(u\) => u\.code === input\.lawanCode\)\) return \{ ok: false, error: PESAN_DUA_UNIT \}/);
    expect(fn).toMatch(/`\$\{unit\.unit_id\},\$\{lawan\.unit_id\}`/);
    expect(urutan(fn, "buatKelompok(client", "tulisPasanganAntarUnit(client")).toBe("ok");
    expect(fn).toMatch(/lahirDariCocok: \{ unitId: unit\.unit_id, cocokId \}/);
  });
});

describe("⛔ KTD5/R28 — hari buku DI DALAM transaksi, sebelum baris kas", () => {
  for (const nama of ["klasifikasiSatuUnit", "pindahkanDariPenampung"]) {
    it(`🔴 ${nama}: BEGIN → set_config → hariBukuTerkunci(client → buatKelompok/tulisBarisKlasifikasi(client`, () => {
      const fn = badan(KODE, nama);
      expect(urutan(fn, 'client.query("BEGIN")', "set_config('app.unit_ids', $1, true)")).toBe("ok");
      expect(urutan(fn, "set_config('app.unit_ids', $1, true)", "hariBukuTerkunci(client")).toBe("ok");
      expect(urutan(fn, "hariBukuTerkunci(client", "tulisBarisKlasifikasi(client")).toBe("ok");
      expect(fn).toMatch(/if \(hari\.status === "pra-cut-over"\) \{\s*await batal\(client\);\s*return/);
      expect(fn).toMatch(/hariBuku: hari\.hariBuku/);
      expect(fn).toMatch(/maju: hari\.perluKodeAlasan/);
      expect(urutan(fn, "tulisBarisKlasifikasi(client", "tambahAnggota(client")).toBe("ok");
      expect(urutan(fn, "tambahAnggota(client", 'client.query("COMMIT")')).toBe("ok");
    });
  }

  it("jalur satu unit: tanggal = TANGGAL BANK, kode ADJ-FWD-IMPORT; baris impor dibaca ulang sebelum hari buku", () => {
    const fn = badan(KODE, "klasifikasiSatuUnit");
    expect(fn).toMatch(/hariBukuTerkunci\(client, unit\.unit_id, m\.tanggalBank, \{ accountId: m\.accountId \}\)/);
    expect(fn).toMatch(/kodeMaju: KODE_MAJU_IMPOR/);
    expect(urutan(fn, "bacaBarisTerbuka(client", "hariBukuTerkunci(client")).toBe("ok");
    expect(urutan(fn, "buatKelompok(client", "tulisBarisKlasifikasi(client")).toBe("ok");
    expect(fn).toMatch(/lahirDariCocokId: cocokId/);
    expect(MENTAH).toMatch(IMPOR_KODE_MAJU);
    expect(KODE_MAJU).toMatch(/export const KODE_MAJU_IMPOR = "ADJ-FWD-IMPORT"/);
  });

  it("pindah: baris parkir dikunci & kelompoknya FOR SHARE sebelum hari buku; ADJ-FWD-SUSPENSE; masuk kelompok parkir", () => {
    const fn = badan(KODE, "pindahkanDariPenampung");
    expect(urutan(fn, "FOR UPDATE OF l", "hariBukuTerkunci(client")).toBe("ok");
    expect(urutan(fn, "FOR SHARE", "hariBukuTerkunci(client")).toBe("ok");
    expect(fn).toMatch(/kodeMaju: KODE_MAJU_PENAMPUNG/);
    expect(fn).toMatch(/parkirSumberId: p!\.id/);
    expect(fn).toMatch(/lahirDariCocokId: p!\.cocokId/);
    expect(MENTAH).toMatch(IMPOR_KODE_MAJU);
    expect(KODE_MAJU).toMatch(/export const KODE_MAJU_SUSPENSE = "ADJ-FWD-SUSPENSE"/);
  });
});

describe("berkas", () => {
  it("🔴 baris parkir (dan baris kas mana pun) TIDAK disunting di sini; tanpa DELETE", () => {
    expect(KODE).not.toMatch(/UPDATE app\.cash_ledger/);
    expect(KODE).not.toMatch(/INSERT INTO app\.cash_ledger/);
    for (const k of [KODE, TULIS]) expect(k).not.toMatch(/DELETE\s+FROM/i);
  });

  it("🔴 inti tulis BUKAN \"use server\"; aksi \"use server\"; inti hanya menulis cash_ledger + manual_entry", () => {
    expect(TULIS_MENTAH).not.toMatch(/^\s*["']use server["']/m);
    expect(MENTAH).toMatch(/^"use server";/);
    const tulis = [...TULIS.matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.cash_ledger", "app.manual_entry"]));
  });

  it("🔴 beban: manual_entry pintu Finance bertaut ke baris kas, di HARI BUKU yang sama, CoA dipetakan", () => {
    const fn = badan(TULIS, "tulisBarisKlasifikasi");
    expect(urutan(fn, "INSERT_KAS_KLASIFIKASI", "tulisBebanFinance(c")).toBe("ok");
    expect(fn).toMatch(/businessDate: m\.hariBuku/);
    expect(fn).toMatch(/cashLedgerId: id/);
    const be = badan(TULIS, "tulisBebanFinance");
    expect(urutan(be, "FROM app.category_account_map", "INSERT INTO app.manual_entry")).toBe("ok");
    expect(be).toMatch(/'submitted', 'finance'/);
    expect(be).toMatch(/cash_ledger_id\)/);
  });

  it("set_config transaction-local di setiap transaksi (3: satu unit, antar unit, pindah)", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(3);
  });
});
