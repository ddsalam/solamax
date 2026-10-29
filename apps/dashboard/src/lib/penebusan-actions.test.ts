import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server action penebusan per SO (rencana 2026-10-29 U7; R10, R26, R28, R29;
 * KTD9) dengan DB TIRUAN — pola `antar-unit-actions.test.ts`. Klien tiruan
 * mencatat setiap pernyataan, jadi "ditolak" dibuktikan sebagai "tak ada
 * koneksi / tak ada INSERT". `hariBukuTerkunci` ditiru supaya hari tertutup
 * bisa disimulasikan.
 *
 * ⚠️ Batas: SQL tidak dijalankan. CHECK jumlah + FK komposit 0050 dibuktikan
 * `penebusan.integration.test.ts` (ber-gerbang env — belum dijalankan).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: {
    jawab: (sql: string, params: unknown[]) => Jawab;
    hari: (unitId: number, tanggal: string) => unknown;
  } = { jawab: () => undefined, hari: () => undefined };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const hariBukuTerkunci = vi.fn(async (_c: unknown, unitId: number, tanggal: string, _opsi?: unknown) =>
    state.hari(unitId, tanggal),
  );
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null, units: [BK] };
  return { log, state, connect, hariBukuTerkunci, BK, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./hari-buku-queries", () => ({ hariBukuTerkunci: h.hariBukuTerkunci }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: h.sesi.role,
    email: h.sesi.email,
    units: h.sesi.units,
    requireUnit(code: string) {
      const u = h.sesi.units.find((x) => x.code === code);
      if (!u) throw new Error("NEXT_NOT_FOUND");
      return u;
    },
  })),
}));

const { simpanPenebusan, batalkanPenebusan } = await import("./penebusan-actions");

const AKUN = "11111111-1111-4111-8111-111111111111";
const MANUAL = "22222222-2222-4222-8222-222222222222";
const MANUAL2 = "33333333-3333-4333-8333-333333333333";
const PNB = "44444444-4444-4444-8444-444444444444";

const AE2 = {
  code: h.BK.code,
  noSo: "  SO-1234567 ",
  tanggalBayar: "2026-10-02",
  accountId: AKUN,
  net: 100_000_000,
  ppn: 11_000_000,
  pph: 250_000,
  pbbkb: 7_500_000,
  nota: 0,
  gross: 118_750_000,
};

const insertKas = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));
const insertPnb = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.penebusan"));
const terbuka = (_u: number, t: string) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });
const kandidat = (id: string) => ({
  id,
  businessDate: "2026-10-02",
  tanggalAsal: null,
  keterangan: "BCA DB Pertamina",
  amount: "-118750000.00",
});

/** DB tiruan: rekening bank aktif, tanpa SO ganda, kandidat dari `calon`. */
let calon: ReturnType<typeof kandidat>[] = [];
let soGanda = false;
let akun: { id: string; nama: string; kind: string; active: boolean } | null = null;
const db = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.cash_account")) return { rows: akun ? [akun] : [] };
  if (sql.includes("FROM app.penebusan") && sql.includes("no_so = $2")) {
    return { rows: soGanda ? [{ tanggalBayar: "2026-10-01" }] : [] };
  }
  if (sql.includes("FROM app.cash_ledger l")) return { rows: calon };
  if (sql.includes("INSERT INTO app.cash_ledger")) return { rows: [{ id: "kas-baru" }] };
  if (sql.includes("INSERT INTO app.penebusan")) return { rows: [{ id: PNB }] };
  void p;
  return undefined;
};

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.hariBukuTerkunci.mockClear();
  h.state.jawab = db;
  h.state.hari = terbuka;
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
  calon = [];
  soGanda = false;
  akun = { id: AKUN, nama: "Bank BCA - 5125036811", kind: "bank", active: true };
});

describe("simpanPenebusan — AE2 & baris kas (R10, R29)", () => {
  it("🔴 AE2 tanpa kandidat ⇒ SATU baris kas −118.750.000 Pembelian BBM, bertaut ke penebusan", async () => {
    const r = await simpanPenebusan(AE2);
    expect(r).toMatchObject({ ok: true, diikat: false, cashLedgerId: "kas-baru", hariBuku: "2026-10-02" });

    const kas = insertKas();
    expect(kas).toHaveLength(1);
    // (unit, akun, hari buku, keterangan, jenis, sisi, kategori, amount, user, tanggal_asal, alasan, applies_to)
    expect(kas[0]!.params).toEqual([
      h.BK.unit_id,
      AKUN,
      "2026-10-02",
      "Penebusan SO SO-1234567",
      "kredit",
      "kredit",
      "Pembelian BBM",
      "-118750000.00",
      7,
      null,
      null,
      null,
    ]);

    const pnb = insertPnb();
    expect(pnb).toHaveLength(1);
    // (unit, so, tanggal, akun, net, ppn, pph, pbbkb, nota, gross, cash_ledger_id, kas_dibuat, user)
    expect(pnb[0]!.params).toEqual([
      h.BK.unit_id,
      "so-1234567",
      "2026-10-02",
      AKUN,
      "100000000.00",
      "11000000.00",
      "250000.00",
      "7500000.00",
      "0.00",
      "118750000.00",
      "kas-baru",
      true,
      7,
    ]);
    expect(h.log.map((l) => l.sql).at(-1)).toBe("COMMIT");
  });

  it("🔴 AE2: PBBKB +1 ⇒ ditolak 'selisih Rp 1', TANPA koneksi", async () => {
    const r = await simpanPenebusan({ ...AE2, pbbkb: 7_500_001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/selisih Rp 1\b/);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 baris manual −118.750.000 sudah ada di rekening & tanggal sama ⇒ DIIKAT, tak ada baris kas baru", async () => {
    calon = [kandidat(MANUAL)];
    const r = await simpanPenebusan(AE2);
    expect(r).toMatchObject({ ok: true, diikat: true, cashLedgerId: MANUAL });
    expect(insertKas()).toHaveLength(0);
    expect(h.hariBukuTerkunci).not.toHaveBeenCalled();
    const p = insertPnb()[0]!.params;
    expect(p[10]).toBe(MANUAL);
    expect(p[11]).toBe(false);
  });

  it("kandidat dicari dengan rekening, kategori, nominal −Gross, tanggal (hari buku ATAU tanggal asal), belum diikat", async () => {
    await simpanPenebusan(AE2);
    const q = h.log.find((l) => l.sql.includes("FROM app.cash_ledger l"))!;
    expect(q.sql).toMatch(/l\.category_label = 'Pembelian BBM'/);
    expect(q.sql).toMatch(/l\.amount = \$3::numeric/);
    expect(q.sql).toMatch(/l\.business_date = \$4::date OR l\.tanggal_asal = \$4::date/);
    expect(q.sql).toMatch(/NOT EXISTS[\s\S]*app\.penebusan[\s\S]*NOT p\.void/);
    expect(q.sql).toMatch(/NOT l\.void/);
    expect(q.sql).toMatch(/FOR UPDATE/);
    expect(q.params).toEqual([h.BK.unit_id, AKUN, "-118750000.00", "2026-10-02"]);
  });

  it("🔴 dua kandidat ⇒ TIDAK diikat otomatis; kandidat dikembalikan, tak ada INSERT", async () => {
    calon = [kandidat(MANUAL), kandidat(MANUAL2)];
    const r = await simpanPenebusan(AE2);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kandidat?.map((k) => k.id)).toEqual([MANUAL, MANUAL2]);
      expect(r.kandidat?.[0]?.amountSen).toBe(-11_875_000_000);
    }
    expect(insertKas()).toHaveLength(0);
    expect(insertPnb()).toHaveLength(0);
    expect(h.log.map((l) => l.sql)).toContain("ROLLBACK");
  });

  it("dua kandidat + pilihan eksplisit ⇒ yang dipilih diikat", async () => {
    calon = [kandidat(MANUAL), kandidat(MANUAL2)];
    const r = await simpanPenebusan({ ...AE2, cashLedgerId: MANUAL2 });
    expect(r).toMatchObject({ ok: true, diikat: true, cashLedgerId: MANUAL2 });
    expect(insertKas()).toHaveLength(0);
  });

  it("pilihan eksplisit yang bukan kandidat ditolak", async () => {
    calon = [kandidat(MANUAL)];
    const r = await simpanPenebusan({ ...AE2, cashLedgerId: MANUAL2 });
    expect(r.ok).toBe(false);
    expect(insertPnb()).toHaveLength(0);
  });

  it("hari bayar tertutup ⇒ baris kas dibukukan MAJU dengan tanggal asal + ADJ-FWD-PURCHASE (R28)", async () => {
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-10-05", terdorongMaju: true, perluKodeAlasan: true });
    const r = await simpanPenebusan(AE2);
    expect(r).toMatchObject({ ok: true, hariBuku: "2026-10-05" });
    const p = insertKas()[0]!.params;
    expect(p[2]).toBe("2026-10-05");
    expect(p.slice(9)).toEqual(["2026-10-02", "ADJ-FWD-PURCHASE", "adjustment"]);
    expect(h.hariBukuTerkunci).toHaveBeenCalledWith(expect.anything(), h.BK.unit_id, "2026-10-02", { accountId: AKUN });
  });

  it("pra-cut-over ⇒ ditolak, tak ada INSERT", async () => {
    h.state.hari = () => ({ status: "pra-cut-over", cutOver: "2026-10-01" });
    const r = await simpanPenebusan({ ...AE2, tanggalBayar: "2026-09-30" });
    expect(r.ok).toBe(false);
    expect(insertKas()).toHaveLength(0);
    expect(insertPnb()).toHaveLength(0);
  });
});

describe("simpanPenebusan — validasi (R10, SO, rekening)", () => {
  it("🔴 SO duplikat di unit yang sama ditolak", async () => {
    soGanda = true;
    const r = await simpanPenebusan(AE2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/so-1234567|SO-1234567/);
    expect(insertPnb()).toHaveLength(0);
    const cek = h.log.find((l) => l.sql.includes("no_so = $2"))!;
    // Dicek dengan bentuk TERNORMALISASI — "SO-1234567 " = "so-1234567".
    expect(cek.params).toEqual([h.BK.unit_id, "so-1234567"]);
  });

  it("SO kosong sesudah normalisasi ⇒ ditolak tanpa koneksi", async () => {
    const r = await simpanPenebusan({ ...AE2, noSo: "   " });
    expect(r.ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("rekening bukan bank / nonaktif / milik unit lain ⇒ ditolak", async () => {
    akun = { id: AKUN, nama: "Kas Besar", kind: "kas", active: true };
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    akun = { id: AKUN, nama: "Bank BCA - 1", kind: "bank", active: false };
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    akun = null;
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    expect(insertPnb()).toHaveLength(0);
    const q = h.log.find((l) => l.sql.includes("FROM app.cash_account"))!;
    expect(q.params).toEqual([AKUN, h.BK.unit_id]);
  });

  it("🔴 R26: bukan Keuangan / HoF ⇒ ditolak TANPA koneksi", async () => {
    h.sesi.role = "pengawas";
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    h.sesi.role = "keuangan";
    h.sesi.email = "hof@solagroup.co";
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    h.sesi.role = "direksi";
    h.sesi.email = "d@solagroup.co";
    expect((await simpanPenebusan(AE2)).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("unit di luar jangkauan ⇒ notFound sebelum koneksi", async () => {
    await expect(simpanPenebusan({ ...AE2, code: "6478201" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 R14: tak ada tulisan ke harga beli / HPP / laba", async () => {
    await simpanPenebusan(AE2);
    calon = [kandidat(MANUAL)];
    await simpanPenebusan(AE2);
    const tulis = h.log.filter((l) => /^\s*(INSERT|UPDATE)\b/i.test(l.sql)).map((l) => l.sql);
    expect(tulis.length).toBeGreaterThan(0);
    for (const s of tulis) expect(s).not.toMatch(/purchase_price|hpp|harga_beli|gl_|laba/i);
    for (const s of tulis) expect(s).toMatch(/INSERT INTO app\.(cash_ledger|penebusan|audit_log)/);
  });
});

describe("batalkanPenebusan — void hanya bila hari buku terbuka", () => {
  let baris: Record<string, unknown> | null;
  const dbBatal = (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
    if (sql.includes("FROM app.penebusan p")) return { rows: baris ? [baris] : [] };
    if (sql.includes("UPDATE app.penebusan")) return { rows: [], rowCount: 1 };
    if (sql.includes("UPDATE app.cash_ledger")) return { rows: [], rowCount: 1 };
    return undefined;
  };
  beforeEach(() => {
    h.state.jawab = dbBatal;
    baris = {
      id: PNB,
      noSo: "so-1234567",
      kasDibuat: true,
      cashLedgerId: "kas-baru",
      businessDate: "2026-10-02",
      accountId: AKUN,
    };
  });
  const updPnb = () => h.log.filter((l) => l.sql.includes("UPDATE app.penebusan"));
  const updKas = () => h.log.filter((l) => l.sql.includes("UPDATE app.cash_ledger"));

  it("baris kas DIBUAT penebusan + hari terbuka ⇒ keduanya di-void", async () => {
    const r = await batalkanPenebusan({ code: h.BK.code, id: PNB });
    expect(r.ok).toBe(true);
    expect(updPnb()).toHaveLength(1);
    expect(updKas()).toHaveLength(1);
    expect(updKas()[0]!.params).toEqual([7, "kas-baru", h.BK.unit_id]);
    expect(h.hariBukuTerkunci).toHaveBeenCalledWith(expect.anything(), h.BK.unit_id, "2026-10-02", { accountId: AKUN });
  });

  it("baris kas manual yang DIIKAT ⇒ hanya penebusan di-void; baris manual tetap", async () => {
    baris = { ...baris!, kasDibuat: false, cashLedgerId: MANUAL };
    const r = await batalkanPenebusan({ code: h.BK.code, id: PNB });
    expect(r.ok).toBe(true);
    expect(updPnb()).toHaveLength(1);
    expect(updKas()).toHaveLength(0);
  });

  it("🔴 hari buku baris kas sudah DITUTUP ⇒ ditolak, arahkan ke pembalikan maju; tak ada UPDATE", async () => {
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-10-05", terdorongMaju: true, perluKodeAlasan: true });
    const r = await batalkanPenebusan({ code: h.BK.code, id: PNB });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pembalikan maju/i);
    expect(updPnb()).toHaveLength(0);
    expect(updKas()).toHaveLength(0);
  });

  it("🔴 U10: baris kasnya di kelompok cocok AKTIF ⇒ ditolak 'batalkan cocok dulu'; tak ada UPDATE", async () => {
    h.state.jawab = (sql) => (sql.includes("FROM app.cocok_bank_baris") ? { rows: [{ n: 1 }] } : dbBatal(sql));
    const r = await batalkanPenebusan({ code: h.BK.code, id: PNB });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/membatalkan cocoknya dulu/);
    expect(updPnb()).toHaveLength(0);
    expect(updKas()).toHaveLength(0);
    const cek = h.log.find((l) => l.sql.includes("FROM app.cocok_bank_baris"))!;
    expect(cek.params).toEqual(["kas-baru", h.BK.unit_id]);
  });

  it("penebusan tak ditemukan / sudah void ⇒ ditolak", async () => {
    baris = null;
    expect((await batalkanPenebusan({ code: h.BK.code, id: PNB })).ok).toBe(false);
  });

  it("bukan Keuangan ⇒ ditolak tanpa koneksi", async () => {
    h.sesi.role = "direksi";
    expect((await batalkanPenebusan({ code: h.BK.code, id: PNB })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});
