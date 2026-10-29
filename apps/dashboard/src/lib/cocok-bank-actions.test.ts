import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi kelompok cocok (rencana 2026-10-29 U10; R19, R20, R31; AE4, AE11;
 * KTD6) dengan DB TIRUAN — pola `impor-bank-actions.test.ts`. Klien tiruan
 * mencatat setiap pernyataan, jadi "ditolak" dibuktikan sebagai "tak ada
 * koneksi / tak ada INSERT / tak ada COMMIT". Data SINTETIS.
 *
 * ⚠️ Batas: SQL tidak dijalankan. Partial unique keanggotaan aktif, FK komposit
 * & cermin `aktif` ON UPDATE CASCADE 0052 dibuktikan
 * `cocok-bank.integration.test.ts` (ber-gerbang env — belum dijalankan).
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
  const hariBukuTerkunci = vi.fn(async (_c: unknown, unitId: number, tanggal: string) => state.hari(unitId, tanggal));
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

const { batalkanCocok, cocokkanManual, cocokkanOtomatis } = await import("./cocok-bank-actions");

const AKUN = "11111111-1111-4111-8111-111111111111";
const RK = "22222222-2222-4222-8222-222222222222";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const G = uid(900);

type Mutasi = Record<string, unknown>;
type Kas = Record<string, unknown>;
const mutasi = (id: string, over: Mutasi = {}): Mutasi => ({
  id,
  accountId: AKUN,
  tanggalBank: "2026-09-03",
  keterangan: "TRSF E-BANKING CR | CONTOH",
  amount: "1000.00",
  so: null,
  dokRef: null,
  praCutover: false,
  rkStatus: "aktif",
  rekeningKoranId: RK,
  dicocokkan: false,
  ...over,
});
const kas = (id: string, over: Kas = {}): Kas => ({
  id,
  accountId: AKUN,
  businessDate: "2026-09-03",
  tanggalAsal: null,
  amount: "1000.00",
  keterangan: "Ketikan",
  categoryLabel: "Pendapatan Lain-Lain",
  void: false,
  saldoAwal: false,
  edcSettlementId: null,
  edcSettlementDate: null,
  pasanganUuid: null,
  lahirDariCocokId: null,
  dicocokkan: false,
  ...over,
});

let semuaMutasi: Mutasi[];
let semuaKas: Kas[];
let rkStatus: string | null;

const db = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.rekening_koran") && sql.includes("FOR NO KEY UPDATE")) {
    return { rows: rkStatus === null ? [] : [{ status: rkStatus, id: RK }] };
  }
  if (sql.includes("m.rekening_koran_id = $2::uuid")) return { rows: semuaMutasi };
  if (sql.includes("m.id = ANY($2::uuid[])")) return { rows: semuaMutasi.filter((m) => (p[1] as string[]).includes(String(m.id))) };
  if (sql.includes("kind = 'bank'")) return { rows: [{ id: AKUN, nomorRekening: "5125036811" }] };
  if (sql.includes("BETWEEN $2::date")) return { rows: semuaKas };
  if (sql.includes("l.id = ANY($2::uuid[])")) return { rows: semuaKas.filter((k) => (p[1] as string[]).includes(String(k.id))) };
  if (sql.includes("FROM app.penebusan")) return { rows: [] };
  if (sql.includes("INSERT INTO app.cocok_bank (")) return { rows: [{ id: G }] };
  return undefined;
};

const ins = (tabel: string) => h.log.filter((l) => new RegExp(`INSERT INTO ${tabel}\\s*\\(`).test(l.sql));
const upd = (tabel: string) => h.log.filter((l) => new RegExp(`UPDATE ${tabel}\\b`).test(l.sql));
const audit = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log"));
const committed = () => h.log.some((l) => l.sql.trim() === "COMMIT");

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.hariBukuTerkunci.mockClear();
  h.state.jawab = db;
  h.state.hari = (_u, t) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
  semuaMutasi = [];
  semuaKas = [];
  rkStatus = "aktif";
});

// ---------------------------------------------------------------------------
// Otomatis
// ---------------------------------------------------------------------------

describe("cocokkanOtomatis — kelompok hanya untuk cocok TUNGGAL, tanpa baris kas baru", () => {
  it("🔴 Covers AE11: jemputan 3 Sep ↔ setoran 2 Sep (satu kandidat) ⇒ satu kelompok otomatis; cash_ledger tak disentuh", async () => {
    semuaMutasi = [mutasi(uid(1), { keterangan: "KR OTOMATIS | SETORAN JEMPUTAN | 0981", amount: "250000000.00" })];
    semuaKas = [kas(uid(11), { categoryLabel: "Setoran Hasil Penjualan", amount: "250000000.00", businessDate: "2026-09-02" })];
    const r = await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK });
    expect(r).toMatchObject({ ok: true, nOtomatis: 1, nBanyak: 0, nTanpa: 0 });
    expect(ins("app.cocok_bank")[0]!.params).toEqual([h.BK.unit_id, "otomatis", 7]);
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [uid(1), null], [null, uid(11)]]);
    expect(h.log.some((l) => /(INSERT INTO|UPDATE) app\.cash_ledger/.test(l.sql))).toBe(false);
    expect(audit()[0]!.params[2]).toBe("cocok_bank.otomatis");
    expect(committed()).toBe(true);
    // Baris kas dikunci FOR UPDATE sebelum ditautkan.
    expect(h.log.some((l) => l.sql.includes("l.id = ANY($2::uuid[])") && l.sql.includes("FOR UPDATE OF l"))).toBe(true);
  });

  it("Covers AE4: ketikan manual 1 Sep −150.000.000 + baris impor sama ⇒ dicocokkan, tak ada baris kas baru", async () => {
    semuaMutasi = [mutasi(uid(1), { tanggalBank: "2026-09-01", amount: "-150000000.00", keterangan: "TRSF E-BANKING DB" })];
    semuaKas = [kas(uid(11), { businessDate: "2026-09-01", amount: "-150000000.00", categoryLabel: "Biaya Operasional" })];
    expect(await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK })).toMatchObject({ ok: true, nOtomatis: 1 });
    expect(h.log.some((l) => /INSERT INTO app\.cash_ledger/.test(l.sql))).toBe(false);
  });

  it("dua setoran bernominal sama ⇒ banyak, TIDAK ada kelompok", async () => {
    semuaMutasi = [mutasi(uid(1), { keterangan: "SETORAN JEMPUTAN", amount: "250000000.00" })];
    semuaKas = [
      kas(uid(11), { categoryLabel: "Setoran Hasil Penjualan", amount: "250000000.00", businessDate: "2026-09-02" }),
      kas(uid(12), { categoryLabel: "Setoran Hasil Penjualan", amount: "250000000.00", businessDate: "2026-09-01" }),
    ];
    expect(await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK })).toMatchObject({ ok: true, nOtomatis: 0, nBanyak: 1 });
    expect(ins("app.cocok_bank")).toHaveLength(0);
  });

  it("baris kas berubah sejak dibaca (sudah dicocokkan saat dikunci ulang) ⇒ dilewati, bukan ditebak", async () => {
    semuaMutasi = [mutasi(uid(1))];
    semuaKas = [kas(uid(11))];
    h.state.jawab = (sql, p) =>
      sql.includes("FOR UPDATE OF l") ? { rows: [kas(uid(11), { dicocokkan: true })] } : db(sql, p);
    expect(await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK })).toMatchObject({ ok: true, nOtomatis: 0 });
    expect(ins("app.cocok_bank")).toHaveLength(0);
  });

  it("rekening koran ditarik ⇒ ditolak tanpa kelompok", async () => {
    rkStatus = "ditarik";
    expect((await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK })).ok).toBe(false);
    expect(ins("app.cocok_bank")).toHaveLength(0);
  });

  it("🔴 HoF tak mencocokkan (§10.12) — ditolak sebelum koneksi", async () => {
    h.sesi.role = "admin_perusahaan";
    h.sesi.email = "hof@solagroup.co";
    expect((await cocokkanOtomatis({ code: h.BK.code, rekeningKoranId: RK })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Manual N:M
// ---------------------------------------------------------------------------

describe("cocokkanManual — kelompok N:M, Σ = 0 tepat", () => {
  const siapkan = (setoran2: string) => {
    semuaMutasi = [
      mutasi(uid(1), { amount: "-50000.00", keterangan: "KORCPU" }),
      mutasi(uid(2), { amount: "325000000.00", keterangan: "KR OTOMATIS | SETORAN JEMPUTAN" }),
    ];
    semuaKas = [
      kas(uid(11), { amount: "200000000.00", categoryLabel: "Setoran Hasil Penjualan" }),
      kas(uid(12), { amount: setoran2, categoryLabel: "Setoran Hasil Penjualan" }),
    ];
  };
  const masukan = { code: h.BK.code, mutasiIds: [uid(1), uid(2)], kasIds: [uid(11), uid(12)] };

  it("🔴 KORCPU −50.000 + jemputan 325.000.000 ↔ dua setoran Σ 324.950.000 ⇒ diterima, satu kelompok manual, audit", async () => {
    siapkan("124950000.00");
    const r = await cocokkanManual(masukan);
    expect(r).toMatchObject({ ok: true, cocokId: G });
    expect(ins("app.cocok_bank")[0]!.params).toEqual([h.BK.unit_id, "manual", 7]);
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([
      h.BK.unit_id,
      G,
      [uid(1), uid(2), null, null],
      [null, null, uid(11), uid(12)],
    ]);
    expect(audit()[0]!.params[2]).toBe("cocok_bank.manual");
    expect(JSON.parse(String(audit()[0]!.params[4]))).toMatchObject({ total: "324950000.00" });
    expect(h.log.some((l) => /(INSERT INTO|UPDATE) app\.cash_ledger/.test(l.sql))).toBe(false);
    // Rekening koran induk dikunci, baris kas dikunci FOR UPDATE.
    expect(h.log.some((l) => l.sql.includes("FROM app.rekening_koran") && l.sql.includes("FOR NO KEY UPDATE"))).toBe(true);
    expect(h.log.some((l) => l.sql.includes("FOR UPDATE OF l"))).toBe(true);
  });

  it("🔴 Σ ≠ 0 ⇒ ditolak dengan selisihnya; tak ada kelompok, tak ada COMMIT", async () => {
    siapkan("124949000.00");
    const r = await cocokkanManual(masukan);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/selisih Rp 1\.000/);
    expect(ins("app.cocok_bank")).toHaveLength(0);
    expect(committed()).toBe(false);
  });

  it("baris tak ditemukan di unit ini / anggota sudah di kelompok aktif ⇒ ditolak", async () => {
    siapkan("124950000.00");
    expect((await cocokkanManual({ ...masukan, kasIds: [uid(11), uid(99)] })).ok).toBe(false);
    semuaKas = [kas(uid(11), { amount: "200000000.00" }), kas(uid(12), { amount: "124950000.00", dicocokkan: true })];
    expect((await cocokkanManual(masukan)).ok).toBe(false);
    expect(ins("app.cocok_bank")).toHaveLength(0);
  });

  it("masukan rusak (kosong, bukan uuid, ganda) ⇒ ditolak sebelum koneksi", async () => {
    expect((await cocokkanManual({ ...masukan, mutasiIds: [] })).ok).toBe(false);
    expect((await cocokkanManual({ ...masukan, kasIds: ["x"] })).ok).toBe(false);
    expect((await cocokkanManual({ ...masukan, mutasiIds: [uid(1), uid(1)] })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Batal — HoF (R31)
// ---------------------------------------------------------------------------

describe("batalkanCocok — HoF saja, beralasan, beraudit", () => {
  const masukan = { code: h.BK.code, cocokId: G, reasonCode: "ADJ-DUP", catatan: "salah pasang" };
  let grup: { id: string; aktif: boolean; cara: string } | null;
  let lahir: Record<string, unknown>[];
  const dbBatal = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
    if (sql.includes("FROM app.reason_code")) return { rows: p[0] === "ADJ-DUP" ? [{ code: "ADJ-DUP" }] : [] };
    if (sql.includes("FROM app.cocok_bank\n") || sql.includes("FROM app.cocok_bank WHERE") || /FROM app\.cocok_bank\s+WHERE id = \$1/.test(sql)) {
      return { rows: grup ? [grup] : [] };
    }
    if (sql.includes("FROM app.cocok_bank_baris b")) {
      return { rows: [{ mutasiId: uid(1), kasId: null, tanggalBank: "2026-09-03" }, { mutasiId: null, kasId: uid(11), tanggalBank: null }] };
    }
    if (sql.includes("lahir_dari_cocok_id = $2")) return { rows: lahir };
    if (sql.includes("UPDATE app.cocok_bank")) return { rows: [], rowCount: 1 };
    if (sql.includes("UPDATE app.cash_ledger")) return { rows: [], rowCount: 1 };
    if (sql.includes("INSERT INTO app.cash_ledger")) return { rows: [{ id: "pembalik" }] };
    return undefined;
  };
  const lahiran = (over: Record<string, unknown> = {}) => ({
    id: uid(21),
    accountId: AKUN,
    businessDate: "2026-09-03",
    amount: "-75000.00",
    keterangan: "Biaya admin bank",
    categorySide: "kredit",
    categoryLabel: "Mutasi Belum Teridentifikasi",
    pihakLawanId: null,
    pasanganUuid: null,
    sisiLawanAda: true,
    ...over,
  });

  beforeEach(() => {
    h.state.jawab = dbBatal;
    grup = { id: G, aktif: true, cara: "otomatis" };
    lahir = [];
    h.sesi.role = "admin_perusahaan";
    h.sesi.email = "hof@solagroup.co";
  });

  it("🔴 staf Keuangan (yang mencocokkan) ⇒ ditolak, tanpa koneksi", async () => {
    h.sesi.role = "keuangan";
    h.sesi.email = "staf@solagroup.co";
    const r = await batalkanCocok(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Head of Finance/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 HoF ⇒ kelompok nonaktif + alasan + catatan, audit cocok_bank.batal; baris yang hanya DIcocokkan tak disentuh", async () => {
    const r = await batalkanCocok(masukan);
    expect(r.ok).toBe(true);
    const u = upd("app.cocok_bank");
    expect(u).toHaveLength(1);
    expect(u[0]!.sql).toMatch(/SET aktif = false/);
    expect(u[0]!.sql).toMatch(/AND aktif/);
    expect(u[0]!.params).toEqual([G, h.BK.unit_id, 7, "ADJ-DUP", "salah pasang"]);
    // Anggota TIDAK ditulis aplikasi — cermin lewat FK ON UPDATE CASCADE.
    expect(h.log.some((l) => /UPDATE app\.cocok_bank_baris/.test(l.sql))).toBe(false);
    expect(h.log.some((l) => /(INSERT INTO|UPDATE) app\.cash_ledger/.test(l.sql))).toBe(false);
    const a = audit();
    expect(a).toHaveLength(1);
    expect(a[0]!.params[2]).toBe("cocok_bank.batal");
    expect(JSON.parse(String(a[0]!.params[4]))).toMatchObject({ reasonCode: "ADJ-DUP", mutasi: [uid(1)], kas: [uid(11)] });
    expect(committed()).toBe(true);
  });

  it("🔴 baris kas LAHIRAN kelompok, hari terbuka ⇒ di-void", async () => {
    lahir = [lahiran()];
    expect((await batalkanCocok(masukan)).ok).toBe(true);
    const v = upd("app.cash_ledger");
    expect(v).toHaveLength(1);
    expect(v[0]!.params).toEqual([7, uid(21), h.BK.unit_id]);
    expect(ins("app.cash_ledger")).toHaveLength(0);
  });

  it("🔴 baris kas LAHIRAN, hari tertutup ⇒ pembalik MAJU (tanda & sisi berlawanan, ADJ-FWD-REVERSAL, tanggal asal, tertandai lahir)", async () => {
    lahir = [lahiran()];
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-09-07", terdorongMaju: true, perluKodeAlasan: true });
    expect((await batalkanCocok(masukan)).ok).toBe(true);
    expect(upd("app.cash_ledger")).toHaveLength(0);
    const [b] = ins("app.cash_ledger");
    expect(b!.params).toEqual([
      h.BK.unit_id,
      AKUN,
      "2026-09-07",
      "Pembalik — Biaya admin bank",
      "debet",
      "debet",
      "Mutasi Belum Teridentifikasi",
      "75000.00",
      7,
      null,
      "2026-09-03",
      "ADJ-FWD-REVERSAL",
      G,
    ]);
    // Urutan: kelompok dinonaktifkan dulu, baru buku ditulis.
    const iU = h.log.findIndex((l) => /UPDATE app\.cocok_bank\b/.test(l.sql));
    const iI = h.log.findIndex((l) => l.sql.includes("INSERT INTO app.cash_ledger"));
    expect(iU).toBeLessThan(iI);
  });

  it("🔴 Gerbang dua unit: kelompok yang MELAHIRKAN kaki antar unit ⇒ ditolak utuh, arahkan ke Balik pasangan", async () => {
    lahir = [lahiran({ pasanganUuid: uid(500), categoryLabel: "Hutang Piutang" })];
    const r = await batalkanCocok(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Balik pasangan/) });
    expect(upd("app.cocok_bank")).toHaveLength(0);
    expect(h.log.some((l) => /(INSERT INTO|UPDATE) app\.cash_ledger/.test(l.sql))).toBe(false);
    expect(committed()).toBe(false);
  });

  it("kategori lahiran tanpa sisi lawan ⇒ ditolak utuh (pembalik mustahil), tak ada yang dibatalkan", async () => {
    lahir = [lahiran({ sisiLawanAda: false, categoryLabel: "Biaya Operasional" })];
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-09-07", terdorongMaju: true, perluKodeAlasan: true });
    expect((await batalkanCocok(masukan)).ok).toBe(false);
    expect(upd("app.cocok_bank")).toHaveLength(0);
  });

  it("sudah dibatalkan / tak ditemukan / alasan & catatan rusak ⇒ ditolak", async () => {
    grup = { id: G, aktif: false, cara: "manual" };
    expect((await batalkanCocok(masukan)).ok).toBe(false);
    grup = null;
    expect((await batalkanCocok(masukan)).ok).toBe(false);
    grup = { id: G, aktif: true, cara: "manual" };
    expect((await batalkanCocok({ ...masukan, catatan: " " })).ok).toBe(false);
    expect((await batalkanCocok({ ...masukan, reasonCode: "ADJ-FWD-REVERSAL" })).ok).toBe(false);
    expect((await batalkanCocok({ ...masukan, reasonCode: "ADJ-NGAWUR" })).ok).toBe(false);
    expect(upd("app.cocok_bank")).toHaveLength(0);
  });
});
