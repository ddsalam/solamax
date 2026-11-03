import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AKUN_REKLAS } from "./keuangan-reklas";
import {
  kelengkapanPeta,
  periksaHapusPos,
  periksaPetaBaru,
  periksaPosJurnal,
  periksaSubPosBaru,
  posUntukKode,
  type JenisPos,
  type Pos,
} from "./pos-model";

// ---------------------------------------------------------------------------
// Rencana K6 U1 (R1–R5, KTD1, KTD2). Subjek uji kelengkapan adalah SEED
// MIGRASI 0056 itu sendiri — dibaca dari teks SQL seperti keuangan-sisi-kas.
// Ekspektasinya disalin dari Tabel Pos & Tabel Peta Kategori di rencana, bukan
// dari kode yang diuji.
// ---------------------------------------------------------------------------

const MIGRASI = resolve(__dirname, "../../../backend/prisma/migrations");
/** Teks migrasi tanpa komentar SQL: contoh di komentar bukan seed. */
const baca = (dir: string): string =>
  readFileSync(resolve(MIGRASI, dir, "migration.sql"), "utf8").replace(/--.*$/gm, "");

const SQL_0023 = baca("0023_category_account_map");
const SQL_0056 = baca("0056_pos");
const SQL_0054 = baca("0054_tutup_bulan");

function blok(sql: string, tabel: string): string {
  const m = new RegExp(`INSERT INTO "app"\\."${tabel}"[\\s\\S]*?(?:ON CONFLICT|;)`).exec(sql);
  return m?.[0] ?? "";
}

/** Baris seed `app.pos` (global, `unit_id` tidak ada di tabel ini). */
function posDariSql(sql: string): Pos[] {
  const re =
    /\(\s*'(\d{4})',\s*'([^']+)',\s*'(aset|kewajiban|modal|pendapatan|beban)',\s*(true|false),\s*(NULL|'\d{4}'),\s*(true|false),\s*(true|false),\s*(true|false),\s*(NULL|'[^']*')\s*\)/g;
  return [...blok(sql, "pos").matchAll(re)].map((m) => ({
    id: null,
    kode: m[1]!,
    nama: m[2]!,
    jenis: m[3] as JenisPos,
    induk: m[4] === "true",
    kodeInduk: m[5] === "NULL" ? null : m[5]!.slice(1, -1),
    pengurang: m[6] === "true",
    kliring: m[7] === "true",
    sistem: m[8] === "true",
    unitId: null,
    cashAccountId: null,
  }));
}

function kodeLamaDariSql(sql: string): Array<[string, string]> {
  return [...blok(sql, "pos_kode_lama").matchAll(/\(\s*'(\d-\d{4})'\s*,\s*'(\d{4})'\s*\)/g)].map((m) => [
    m[1]!,
    m[2]!,
  ]);
}

/** Baris peta BARU (kode empat digit) yang 0056 tambahkan ke category_account_map. */
function petaBaruDariSql(sql: string): Array<{ kategori: string; kodePos: string }> {
  return [...blok(sql, "category_account_map").matchAll(/\(\s*'([^']+)'\s*,\s*'(\d{4})'\s*\)/g)].map((m) => ({
    kategori: m[1]!,
    kodePos: m[2]!,
  }));
}

/** 14 kategori operasional + kode lamanya dari seed 0023. */
const SEED_0023 = [...SQL_0023.matchAll(/\(NULL,\s*'([^']+)',\s*'(\d-\d{4})'/g)].map((m) => ({
  kategori: m[1]!,
  kodeLama: m[2]!,
}));

const POS = posDariSql(SQL_0056);
const PER_KODE = new Map(POS.map((p) => [p.kode, p]));

// Tabel Peta Kategori (rencana, apa adanya).
const PETA_RENCANA: Record<string, string> = {
  "Gaji Karyawan": "5200",
  "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)": "5300",
  "Komputer dan Internet": "5300",
  MDR: "5500",
  "Biaya Admin": "5500",
  "Peralatan Kantor (ATK)": "5700",
  "Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)": "5700",
  "Transportasi / Kendaraan Milik Perusahaan": "5700",
  "Supir Tangki": "5700",
  "Iklan, Promosi, Spanduk": "5700",
  "Sumbangan / Donasi": "5700",
  "Konsumsi Makanan, Lembur, & Hiburan": "5700",
  "Biaya Taktis": "5700",
  "Lain-Lain": "5700",
};

// Kode lama → pos baru (R2): kolom "Kode lama" Tabel Peta Kategori + Tabel Pos
// ("Pengganti 8-1000 / 3-9100 / 1-1800 / 7-1100 dan 7-1200").
const KODE_LAMA_RENCANA: Record<string, string> = {
  "6-1100": "5200",
  "6-2400": "5300",
  "6-3300": "5300",
  "7-1200": "5500",
  "7-1100": "5500",
  "6-3100": "5700",
  "6-2300": "5700",
  "6-2200": "5700",
  "6-2100": "5700",
  "6-4100": "5700",
  "6-3500": "5700",
  "6-1300": "5700",
  "6-9100": "5700",
  "6-9900": "5700",
  "8-1000": "4200",
  "3-9100": "3300",
  "1-1800": "1190",
};

// Tabel Pos: [kode, jenis, induk?, kode induk].
const POS_RENCANA: Array<[string, JenisPos, boolean, string | null]> = [
  ["1100", "aset", true, null],
  ["1101", "aset", false, "1100"],
  ["1102", "aset", false, "1100"],
  ["1103", "aset", false, "1100"],
  ["1110", "aset", true, null],
  ["1120", "aset", true, null],
  ["1121", "aset", false, "1120"],
  ["1122", "aset", false, "1120"],
  ["1129", "aset", false, "1120"],
  ["1130", "aset", true, null],
  ["1131", "aset", false, "1130"],
  ["1132", "aset", false, "1130"],
  ["1140", "aset", false, null],
  ["1150", "aset", false, null],
  ["1190", "aset", false, null],
  ["1198", "aset", false, null],
  ["1199", "aset", false, null],
  ["1500", "aset", false, null],
  ["1510", "aset", false, null],
  ["1520", "aset", false, null],
  ["1590", "aset", false, null],
  ["2100", "kewajiban", true, null],
  ["2101", "kewajiban", false, "2100"],
  ["2102", "kewajiban", false, "2100"],
  ["2103", "kewajiban", false, "2100"],
  ["2109", "kewajiban", false, "2100"],
  ["2110", "kewajiban", false, null],
  ["2200", "kewajiban", false, null],
  ["2300", "kewajiban", false, null],
  ["3100", "modal", false, null],
  ["3200", "modal", false, null],
  ["3300", "modal", false, null],
  ["3900", "modal", false, null],
  ["4100", "pendapatan", false, null],
  ["4110", "pendapatan", false, null],
  ["4200", "pendapatan", false, null],
  ["5100", "beban", false, null],
  ["5110", "beban", false, null],
  ["5120", "beban", false, null],
  ["5130", "beban", false, null],
  ["5200", "beban", false, null],
  ["5300", "beban", false, null],
  ["5400", "beban", false, null],
  ["5500", "beban", false, null],
  ["5600", "beban", false, null],
  ["5700", "beban", false, null],
  ["5800", "beban", false, null],
  ["5900", "beban", false, null],
];

const subPos = (over: Partial<Pos> = {}): Pos => ({
  id: "00000000-0000-4000-8000-000000000001",
  kode: "1104",
  nama: "Kas Kecil",
  jenis: "aset",
  induk: false,
  kodeInduk: "1100",
  pengurang: false,
  kliring: false,
  sistem: false,
  unitId: 7,
  cashAccountId: null,
  ...over,
});

describe("R1 — seed app.pos = Tabel Pos", () => {
  it("penjaga ini punya SUBJEK: seed 0023 dan 0056 terbaca", () => {
    expect(SEED_0023).toHaveLength(14);
    expect(POS.length).toBeGreaterThanOrEqual(40);
  });

  it("setiap baris Tabel Pos ada dengan jenis, status induk, dan induk yang benar — dan tak ada pos lain", () => {
    expect(POS.map((p) => p.kode).sort()).toEqual(POS_RENCANA.map((r) => r[0]).sort());
    for (const [kode, jenis, induk, kodeInduk] of POS_RENCANA) {
      const p = PER_KODE.get(kode)!;
      expect({ kode, jenis: p.jenis, induk: p.induk, kodeInduk: p.kodeInduk }).toEqual({ kode, jenis, induk, kodeInduk });
    }
  });

  it("pos sistem persis yang ditandai `sistem` di Tabel Pos", () => {
    expect(POS.filter((p) => p.sistem).map((p) => p.kode).sort()).toEqual(["1103", "1198", "3900", "5120", "5130"]);
  });

  it("pos kliring = yang R33 wajibkan Rp 0 saat tutup bulan; pengurang = 1590 dan 4110", () => {
    expect(POS.filter((p) => p.kliring).map((p) => p.kode).sort()).toEqual(["1103", "1190", "1198", "1199"]);
    expect(POS.filter((p) => p.pengurang).map((p) => p.kode).sort()).toEqual(["1590", "4110"]);
  });
});

describe("R3 — setiap kategori operasional terpetakan ke tepat satu pos beban", () => {
  const peta = petaBaruDariSql(SQL_0056);
  const kategori = SEED_0023.map((s) => s.kategori);

  it("🔴 kelengkapan: tak ada kategori tanpa pos, ganda, atau ke pos bukan beban", () => {
    expect(peta.length).toBeGreaterThan(10); // jangan hijau karena kosong
    expect(kelengkapanPeta(kategori, peta, POS)).toEqual({ tanpaPos: [], ganda: [], bukanBeban: [], tidakBolehJurnal: [] });
  });

  it("pemetaannya sama dengan Tabel Peta Kategori di rencana", () => {
    expect(Object.fromEntries(peta.map((r) => [r.kategori, r.kodePos]))).toEqual(PETA_RENCANA);
  });

  it("🔴 MUTAN: satu baris seed peta dihapus ⇒ merah", () => {
    const sqlMutan = SQL_0056.replace(/\(\s*'Gaji Karyawan'\s*,\s*'\d{4}'\s*\),?/, "");
    expect(sqlMutan).not.toBe(SQL_0056);
    expect(kelengkapanPeta(kategori, petaBaruDariSql(sqlMutan), POS).tanpaPos).toEqual(["Gaji Karyawan"]);
  });

  it("🔴 MUTAN: kategori diarahkan ke pos induk / bukan beban ⇒ merah", () => {
    const k = kelengkapanPeta(
      ["MDR", "Biaya Admin"],
      [
        { kategori: "MDR", kodePos: "4200" },
        { kategori: "Biaya Admin", kodePos: "1110" },
      ],
      POS,
    );
    expect(k.bukanBeban).toEqual(["MDR", "Biaya Admin"]);
    expect(k.tidakBolehJurnal).toEqual(["Biaya Admin"]);
  });

  it("kategori yang dipetakan dua kali terdeteksi", () => {
    const k = kelengkapanPeta(
      ["MDR"],
      [
        { kategori: "MDR", kodePos: "5500" },
        { kategori: "MDR", kodePos: "5700" },
      ],
      POS,
    );
    expect(k.ganda).toEqual(["MDR"]);
  });

  it("baris peta lama (0023) TIDAK disunting atau dihapus — riwayat tetap (KTD2)", () => {
    expect(SQL_0056).not.toMatch(/UPDATE\s+"?app"?\."?category_account_map/i);
    expect(SQL_0056).not.toMatch(/DELETE\s+FROM\s+"?app"?\."?category_account_map/i);
  });
});

describe("R2 / KTD2 — setiap kode lama punya tepat satu pos baru", () => {
  const lama = kodeLamaDariSql(SQL_0056);
  const peta = new Map(lama);

  it("kode lama di AKUN_REKLAS dan seed 0023 semuanya tercakup, masing-masing sekali", () => {
    const semua = new Set([...AKUN_REKLAS.map((a) => a.kode), ...SEED_0023.map((s) => s.kodeLama)]);
    expect(semua.size).toBe(17);
    for (const k of semua) expect(lama.filter(([l]) => l === k), k).toHaveLength(1);
    expect(lama).toHaveLength(semua.size);
  });

  it("targetnya sesuai rencana dan semuanya pos yang boleh dijurnal", () => {
    expect(Object.fromEntries(lama)).toEqual(KODE_LAMA_RENCANA);
    for (const [, pos] of lama) expect(periksaPosJurnal(PER_KODE.get(pos)), pos).toBeNull();
  });

  it("🔴 MUTAN: kode lama yang tak terpetakan ⇒ tidak ada pos", () => {
    const tanpa = new Map(peta);
    tanpa.delete("8-1000");
    expect(posUntukKode("8-1000", POS, tanpa)).toBeNull();
    expect(posUntukKode("8-1000", POS, peta)?.kode).toBe("4200");
  });

  it("posUntukKode: kode empat digit dipakai apa adanya, kode lama diterjemahkan", () => {
    expect(posUntukKode("6-2400", POS, peta)?.kode).toBe("5300");
    expect(posUntukKode("5300", POS, peta)?.kode).toBe("5300");
    expect(posUntukKode("1111", [...POS, subPos({ kode: "1111", kodeInduk: "1110", cashAccountId: "x" })], peta)?.kode).toBe(
      "1111",
    );
    expect(posUntukKode("9-9999", POS, peta)).toBeNull();
    expect(posUntukKode(null, POS, peta)).toBeNull();
  });
});

describe("Glosarium — pos induk tidak bisa dipakai jurnal", () => {
  it("🔴 setiap pos induk ditolak; pos biasa lolos", () => {
    const induk = POS.filter((p) => p.induk);
    expect(induk.map((p) => p.kode).sort()).toEqual(["1100", "1110", "1120", "1130", "2100"]);
    for (const p of induk) expect(periksaPosJurnal(p), p.kode).toMatch(/induk/i);
    expect(periksaPosJurnal(PER_KODE.get("1101"))).toBeNull();
    expect(periksaPosJurnal(subPos())).toBeNull();
  });

  it("pos tak dikenal ditolak", () => {
    expect(periksaPosJurnal(undefined)).toMatch(/tidak dikenal/i);
  });
});

describe("R4 — hapus pos hanya bila tak dirujuk", () => {
  const nol = { peta: 0, jurnal: 0, saldoAwal: 0 };

  it("🔴 sub-pos yang dirujuk peta, jurnal, atau saldo awal ditolak", () => {
    expect(periksaHapusPos(subPos(), { ...nol, peta: 1 })).toMatch(/peta/i);
    expect(periksaHapusPos(subPos(), { ...nol, jurnal: 3 })).toMatch(/jurnal/i);
    expect(periksaHapusPos(subPos(), { ...nol, saldoAwal: 1 })).toMatch(/saldo awal/i);
  });

  it("sub-pos tanpa rujukan boleh dihapus", () => {
    expect(periksaHapusPos(subPos(), nol)).toBeNull();
  });

  it("pos daftar resmi (global) dan sub-pos rekening bank tidak bisa dihapus", () => {
    expect(periksaHapusPos(PER_KODE.get("5700")!, nol)).toMatch(/daftar pos resmi/i);
    expect(periksaHapusPos(subPos({ kode: "1111", kodeInduk: "1110", cashAccountId: "abc" }), nol)).toMatch(/rekening/i);
  });
});

describe("R4 / R5 — tambah sub-pos", () => {
  const daftar = [...POS, subPos({ kode: "1111", kodeInduk: "1110", cashAccountId: "abc", nama: "Bank Contoh - 001" })];
  const ok = { kodeInduk: "1100", kode: "1104", nama: "Kas Kecil" };

  it("sub-pos di bawah pos induk dengan kode di rentangnya diterima", () => {
    expect(periksaSubPosBaru(ok, daftar)).toBeNull();
    expect(periksaSubPosBaru({ kodeInduk: "2100", kode: "2104", nama: "Hutang Contoh" }, daftar)).toBeNull();
  });

  it("induk harus pos induk resmi; 1110 hanya lewat rekening bank (R5)", () => {
    expect(periksaSubPosBaru({ ...ok, kodeInduk: "5700", kode: "5701" }, daftar)).toMatch(/induk/i);
    expect(periksaSubPosBaru({ ...ok, kodeInduk: "1110", kode: "1112" }, daftar)).toMatch(/rekening/i);
  });

  it("kode di luar rentang induk, kode yang sudah dipakai, atau nama kosong ditolak", () => {
    expect(periksaSubPosBaru({ ...ok, kode: "1110" }, daftar)).toMatch(/1101–1109/);
    expect(periksaSubPosBaru({ ...ok, kode: "1101" }, daftar)).toMatch(/sudah dipakai/i);
    expect(periksaSubPosBaru({ ...ok, kode: "11a4" }, daftar)).toMatch(/empat digit/i);
    expect(periksaSubPosBaru({ ...ok, nama: "  " }, daftar)).toMatch(/nama/i);
  });

  it("dua unit boleh punya 1104 masing-masing: pemeriksaan hanya melihat daftar unit itu", () => {
    // Daftar unit A tak memuat sub-pos unit B (RLS, lihat uji migrasi di bawah).
    expect(periksaSubPosBaru(ok, POS)).toBeNull();
  });
});

describe("R4 — ubah peta kategori", () => {
  const kategori = SEED_0023.map((s) => s.kategori);

  it("pos beban biasa diterima", () => {
    expect(periksaPetaBaru({ kategori: "MDR", kodePos: "5700" }, POS, kategori)).toBeNull();
  });

  it("🔴 pos bukan beban, pos sistem, atau kategori tak dikenal ditolak", () => {
    expect(periksaPetaBaru({ kategori: "MDR", kodePos: "4200" }, POS, kategori)).toMatch(/beban/i);
    expect(periksaPetaBaru({ kategori: "MDR", kodePos: "5130" }, POS, kategori)).toMatch(/sistem/i);
    expect(periksaPetaBaru({ kategori: "MDR", kodePos: "9999" }, POS, kategori)).toMatch(/tidak dikenal/i);
    expect(periksaPetaBaru({ kategori: "Kategori Karangan", kodePos: "5700" }, POS, kategori)).toMatch(/kategori/i);
  });
});

describe("migrasi 0056 — sub-pos per unit ter-scope (R5; §4.1b)", () => {
  const predikat0016 = /predicate text := \$p\$([\s\S]*?)\$p\$/.exec(SQL_0054)?.[1];

  it("pos_unit memakai predikat 0016 PERSIS (seperti 0054), tanpa cabang NULL", () => {
    expect(predikat0016).toBeTruthy();
    const blokRls = /DO \$\$(?:(?!DO \$\$)[\s\S])*?FOREACH t IN ARRAY ARRAY\['pos_unit'\][\s\S]*?END\s*\$\$;/.exec(SQL_0056)?.[0] ?? "";
    expect(blokRls).toContain(predikat0016!);
    expect(blokRls).not.toMatch(/unit_id IS NULL/);
  });

  it("kode sub-pos unik PER UNIT — dua unit bisa sama-sama punya 1111", () => {
    expect(SQL_0056).toMatch(/UNIQUE \("unit_id", "kode"\)/);
    expect(SQL_0056).not.toMatch(/UNIQUE \("kode"\)/);
  });

  it("seed sub-pos bank berjalan SEBELUM RLS pos_unit dinyalakan (§4.1b c)", () => {
    const seed = SQL_0056.indexOf(`pos_tambah_sub_bank"(r."unit_id"`);
    const rls = SQL_0056.indexOf("ARRAY['pos_unit']");
    expect(seed).toBeGreaterThan(0);
    expect(rls).toBeGreaterThan(seed);
  });

  it("rekening bank baru otomatis mendapat sub-pos (trigger pada cash_account)", () => {
    expect(SQL_0056).toMatch(/AFTER INSERT ON "app"\."cash_account"/);
  });
});
