import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS penebusan (rencana 2026-10-29 U7; KTD5, KTD9, R26, R28) —
 * bentuk `pihak-lawan-actions.guard.test.ts`: komentar JS & SQL dibuang,
 * asersi urutan lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · gerbang (`requireUnit` + predikat) & Σ komponen SEBELUM koneksi;
 *   · `hariBukuTerkunci(client` DI DALAM transaksi (BEGIN → set_config →
 *     hariBukuTerkunci) dan SEBELUM INSERT baris kas — dan hasilnya dipakai;
 *   · pembatalan memeriksa hari buku SEBELUM UPDATE; tanpa DELETE;
 *   · kelompok cocok aktif (U10) menolak void sebelum hari & UPDATE diperiksa.
 *
 * ⚠️ Batas: membuktikan penjagaan ADA di kode. Perilakunya:
 * `penebusan-actions.test.ts` (DB tiruan) dan uji DB-live ber-gerbang env.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const MENTAH = readFileSync(resolve(__dirname, "penebusan-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
/** Inti audit bersama (satu salinan SQL) — dipanggil lewat `auditKeuangan(`. */
const KODE_TX = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-tx.ts"), "utf8"));

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

const BEGIN = 'client.query("BEGIN")';
const SETCFG = "set_config('app.unit_ids'";
const HARI = "hariBukuTerkunci(client";
const INS_KAS = "INSERT INTO app.cash_ledger";

/** Pelanggaran urutan pembukuan simpan — [] = patuh. */
function pelanggaranSimpan(fn: string): string[] {
  const salah: string[] = [];
  for (const [a, b] of [
    ["scope.requireUnit(input.code)", "pool.connect()"],
    ["canCatatPenebusan(ctx)", "pool.connect()"],
    ["periksaPenebusan(input)", "pool.connect()"],
    [BEGIN, SETCFG],
    [SETCFG, HARI],
    [HARI, INS_KAS],
    [INS_KAS, "INSERT INTO app.penebusan"],
    ["INSERT INTO app.penebusan", 'client.query("COMMIT")'],
  ] as const) {
    const u = urutan(fn, a, b);
    if (u !== "ok") salah.push(`${a} → ${b}: ${u}`);
  }
  return salah;
}

describe("simpanPenebusan — hari buku DI DALAM transaksi sebelum baris kas (KTD5, R28)", () => {
  const fn = badan(KODE, "simpanPenebusan");

  it("punya subjek", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/INSERT INTO app\.penebusan/);
  });

  it("🔴 gerbang → koneksi → BEGIN → set_config → hariBukuTerkunci → INSERT kas → INSERT penebusan → COMMIT", () => {
    expect(pelanggaranSimpan(fn)).toEqual([]);
  });

  it("🔴 hasilnya DIPAKAI: pra-cut-over ditolak; hari buku, tanggal asal & kode alasan ditulis", () => {
    expect(fn).toMatch(/if \(hari\.status === "pra-cut-over"\) \{\s*await batal\(client\);\s*return/);
    expect(fn).toMatch(/hari\.hariBuku,/);
    expect(fn).toMatch(/maju \? input\.tanggalBayar : null/);
    expect(fn).toMatch(/maju \? KODE_MAJU_PENEBUSAN : null/);
    expect(fn).toMatch(/tanggal_asal, alasan_maju, alasan_maju_applies_to/);
  });

  it("predikat wewenang DITOLAK (return), bukan sekadar dipanggil", () => {
    expect(fn).toMatch(/if \(!canCatatPenebusan\(ctx\)\) \{\s*return \{ ok: false/);
    expect(fn).toMatch(/if \(!cek\.ok\) return \{ ok: false/);
  });

  it("DAYA-BEDA: hariBukuTerkunci dipindah ke sesudah INSERT / dihapus / sebelum BEGIN ⇒ merah", () => {
    const panggil = fn.slice(fn.indexOf("const hari = await hariBukuTerkunci("), fn.indexOf("\n", fn.indexOf("const hari = await hariBukuTerkunci(")));
    expect(panggil).not.toBe("");
    const hapus = fn.replace(panggil, "const hari = { status: \"dibukukan\", hariBuku: input.tanggalBayar, perluKodeAlasan: false } as const;");
    expect(pelanggaranSimpan(hapus).length).toBeGreaterThan(0);

    const sesudah = fn.replace(panggil, "").replace(
      "const pnb = await client.query",
      `${panggil}\n    const pnb = await client.query`,
    );
    expect(sesudah).not.toBe(fn);
    expect(pelanggaranSimpan(sesudah).length).toBeGreaterThan(0);

    const sebelum = fn.replace(panggil, "").replace(`await ${BEGIN};`, `${panggil}\n    await ${BEGIN};`);
    expect(pelanggaranSimpan(sebelum).length).toBeGreaterThan(0);
  });
});

describe("batalkanPenebusan — hari terbuka, tanpa DELETE", () => {
  const fn = badan(KODE, "batalkanPenebusan");

  it("🔴 gerbang sebelum koneksi; hariBukuTerkunci sebelum UPDATE; hari tertutup ditolak", () => {
    expect(fn).not.toBe("");
    expect(urutan(fn, "canBatalkanPenebusan(ctx)", "pool.connect()")).toBe("ok");
    expect(urutan(fn, SETCFG, HARI)).toBe("ok");
    expect(urutan(fn, HARI, "UPDATE app.penebusan")).toBe("ok");
    expect(fn).toMatch(/hari\.hariBuku !== p\.businessDate/);
  });

  it("baris kas ikut di-void HANYA bila dibuat penebusan ini", () => {
    expect(fn).toMatch(/if \(p\.kasDibuat\) \{\s*await client\.query\(\s*`UPDATE app\.cash_ledger/);
  });

  it("🔴 U10: kelompok cocok AKTIF diperiksa sesudah kunci, SEBELUM pemeriksaan hari & UPDATE, dan menolak", () => {
    expect(urutan(fn, "FOR UPDATE OF p, l", "FROM app.cocok_bank_baris")).toBe("ok");
    expect(urutan(fn, "FROM app.cocok_bank_baris", "hariBukuTerkunci(client")).toBe("ok");
    expect(urutan(fn, "FROM app.cocok_bank_baris", "UPDATE app.penebusan")).toBe("ok");
    expect(fn).toMatch(/if \(\(cocok\.rows\[0\]\?\.n \?\? 0\) > 0\) \{\s*await batal\(client\);\s*return \{/);
  });
});

describe("berkas aksi", () => {
  it("tanpa DELETE; hanya cash_ledger, penebusan, audit_log yang ditulis (R14)", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    expect(KODE_TX).not.toMatch(/DELETE FROM/i);
    expect(KODE).toMatch(/auditKeuangan\(client, scope, "penebusan\.catat"/);
    expect(KODE).toMatch(/auditKeuangan\(client, scope, "penebusan\.batal"/);
    const tulis = [...(KODE + KODE_TX).matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.cash_ledger", "app.penebusan", "app.audit_log"]));
  });

  it("set_config transaction-local di kedua aksi", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// K6 U4 — penebusan dari Tambah mutasi bank (R19–R21, AE5, F3), DB TIRUAN.
// Pola `penebusan-actions.test.ts`: klien tiruan mencatat setiap pernyataan,
// jadi "ditolak" = "tak ada koneksi / tak ada INSERT". SQL tidak dijalankan —
// CHECK 0050 & FK komposit dibuktikan `penebusan.integration.test.ts`.
// ---------------------------------------------------------------------------

const t = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string) => Jawab; hari: (tanggal: string) => unknown } = {
    jawab: () => undefined,
    hari: () => undefined,
  };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const hariBukuTerkunci = vi.fn(async (_c: unknown, _u: number, tanggal: string, _o?: unknown) => state.hari(tanggal));
  const UNIT = { unit_id: 2, code: "6300001", name: "Contoh" };
  return { log, state, connect, hariBukuTerkunci, UNIT };
});

vi.mock("./db", () => ({ pool: { connect: t.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./hari-buku-queries", () => ({ hariBukuTerkunci: t.hariBukuTerkunci }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "keuangan",
    email: "staf@solagroup.co",
    units: [t.UNIT],
    requireUnit(code: string) {
      if (code !== t.UNIT.code) throw new Error("NEXT_NOT_FOUND");
      return t.UNIT;
    },
  })),
}));

const { simpanPenebusan } = await import("./penebusan-actions");

const REK = "11111111-1111-4111-8111-111111111111";
const LAMA = "22222222-2222-4222-8222-222222222222";
/** AE5 (ilustratif): Gross Rp 110.000.000, rekening & tanggal dari buku yang terbuka. */
const AE5 = {
  code: t.UNIT.code,
  dariBukuBank: true,
  keterangan: "Penebusan SO SO-0000001",
  noSo: "SO-0000001",
  tanggalBayar: "2026-11-03",
  accountId: REK,
  net: 96_000_000,
  ppn: 10_560_000,
  pph: 320_000,
  pbbkb: 3_120_000,
  nota: 0,
  gross: 110_000_000,
};

let calon: unknown[] = [];
let soGanda = false;
const insKas = () => t.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));
const insPnb = () => t.log.filter((l) => l.sql.includes("INSERT INTO app.penebusan"));

beforeEach(() => {
  t.log.length = 0;
  t.connect.mockClear();
  t.hariBukuTerkunci.mockClear();
  calon = [];
  soGanda = false;
  t.state.hari = (tanggal) => ({ status: "dibukukan", hariBuku: tanggal, terdorongMaju: false, perluKodeAlasan: false });
  t.state.jawab = (sql) => {
    if (sql.includes("FROM app.cash_account")) return { rows: [{ id: REK, nama: "Bank Contoh", kind: "bank", active: true }] };
    if (sql.includes("FROM app.penebusan") && sql.includes("no_so = $2")) {
      return { rows: soGanda ? [{ tanggalBayar: "2026-11-01" }] : [] };
    }
    if (sql.includes("FROM app.cash_ledger l")) return { rows: calon };
    if (sql.includes("INSERT INTO app.cash_ledger")) return { rows: [{ id: "kas-baru" }] };
    if (sql.includes("INSERT INTO app.penebusan")) return { rows: [{ id: "pnb-baru" }] };
    return undefined;
  };
});

describe("simpanPenebusan dariBukuBank — satu simpan menulis mutasi & penebusan (AE5, F3)", () => {
  it("🔴 AE5: Gross 110.000.000, Σ sama ⇒ SATU baris kas −110.000.000 + SATU penebusan, kas_dibuat = true", async () => {
    const r = await simpanPenebusan(AE5);
    expect(r).toMatchObject({ ok: true, diikat: false, cashLedgerId: "kas-baru", hariBuku: "2026-11-03" });

    const kas = insKas();
    expect(kas).toHaveLength(1);
    // (unit, akun, hari buku, keterangan, jenis, sisi, kategori, amount, user, tanggal_asal, alasan, applies_to)
    expect(kas[0]!.params).toEqual([
      2, REK, "2026-11-03", "Penebusan SO SO-0000001", "kredit", "kredit", "Pembelian BBM", "-110000000.00", 7, null, null, null,
    ]);
    const pnb = insPnb();
    expect(pnb).toHaveLength(1);
    // (unit, so, tanggal, akun, net, ppn, pph, pbbkb, nota, gross, cash_ledger_id, kas_dibuat, user)
    expect(pnb[0]!.params).toEqual([
      2, "so-0000001", "2026-11-03", REK,
      "96000000.00", "10560000.00", "320000.00", "3120000.00", "0.00", "110000000.00",
      "kas-baru", true, 7,
    ]);
    expect(t.log.map((l) => l.sql).at(-1)).toBe("COMMIT");
  });

  it("keterangan yang diketik dipakai untuk baris kasnya; kosong ⇒ 'Penebusan SO <SO>'", async () => {
    await simpanPenebusan({ ...AE5, keterangan: "  Bayar SO minggu ini " });
    expect(insKas()[0]!.params[3]).toBe("Bayar SO minggu ini");
    t.log.length = 0;
    await simpanPenebusan({ ...AE5, keterangan: "   " });
    expect(insKas()[0]!.params[3]).toBe("Penebusan SO SO-0000001");
  });

  it("🔴 AE5: Σ 109.990.000 ⇒ ditolak 'selisih Rp 10.000', TANPA koneksi", async () => {
    const r = await simpanPenebusan({ ...AE5, pbbkb: 3_110_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("selisih Rp 10.000");
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("🔴 SO yang sudah tercatat ⇒ ditolak, tak ada baris kas maupun penebusan", async () => {
    soGanda = true;
    const r = await simpanPenebusan(AE5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/SO-0000001 sudah tercatat/);
    expect(insKas()).toHaveLength(0);
    expect(insPnb()).toHaveLength(0);
  });

  it("🔴 baris Pembelian BBM lama sebesar Gross belum diikat ⇒ DITOLAK (tidak diikat, tidak dibuat ganda)", async () => {
    calon = [{ id: LAMA, businessDate: "2026-11-03", tanggalAsal: null, keterangan: "ketik lama", amount: "-110000000.00" }];
    const r = await simpanPenebusan(AE5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/halaman Penebusan SO/);
      expect(r.kandidat).toBeUndefined();
    }
    expect(insKas()).toHaveLength(0);
    expect(insPnb()).toHaveLength(0);
    expect(t.log.map((l) => l.sql)).toContain("ROLLBACK");
  });

  it("DAYA-BEDA: tanpa dariBukuBank, kandidat yang sama DIIKAT (perilaku halaman Penebusan SO tetap, R22)", async () => {
    calon = [{ id: LAMA, businessDate: "2026-11-03", tanggalAsal: null, keterangan: "ketik lama", amount: "-110000000.00" }];
    const r = await simpanPenebusan({ ...AE5, dariBukuBank: false });
    expect(r).toMatchObject({ ok: true, diikat: true, cashLedgerId: LAMA });
  });

  it("🔴 hari bayar tertutup ⇒ baris kas MAJU, dan penebusan menunjuk baris itu (satu hari buku untuk keduanya)", async () => {
    t.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-11-04", terdorongMaju: true, perluKodeAlasan: true });
    const r = await simpanPenebusan(AE5);
    expect(r).toMatchObject({ ok: true, hariBuku: "2026-11-04", cashLedgerId: "kas-baru" });
    const k = insKas()[0]!.params;
    expect(k[2]).toBe("2026-11-04");
    expect(k.slice(9)).toEqual(["2026-11-03", "ADJ-FWD-PURCHASE", "adjustment"]);
    const p = insPnb()[0]!.params;
    expect(p[2]).toBe("2026-11-03"); // tanggal bayar = tanggal buku yang terbuka
    expect(p[10]).toBe("kas-baru"); // hari buku penebusan = hari buku baris kas ini
    expect(t.hariBukuTerkunci).toHaveBeenCalledWith(expect.anything(), 2, "2026-11-03", { accountId: REK });
  });

  it("dariBukuBank tak boleh disertai pilihan baris kas / baris impor ⇒ ditolak tanpa koneksi", async () => {
    for (const extra of [{ cashLedgerId: LAMA }, { mutasiBankId: LAMA }]) {
      const r = await simpanPenebusan({ ...AE5, ...extra });
      expect(r.ok).toBe(false);
    }
    expect(t.connect).not.toHaveBeenCalled();
  });
});
