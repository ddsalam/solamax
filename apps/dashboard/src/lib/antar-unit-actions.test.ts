import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server action pasangan antar unit (rencana 2026-10-29 U4) dengan DB TIRUAN —
 * pola `pihak-lawan-actions.test.ts`. Klien tiruan mencatat setiap pernyataan,
 * jadi "ditolak utuh" dibuktikan sebagai "tak ada koneksi / tak ada INSERT".
 * `hariBukuTerkunci` ditiru per unit supaya hari tertutup bisa disimulasikan.
 *
 * ⚠️ Batas: SQL tidak dijalankan. RLS dua unit + FK komposit dibuktikan
 * `antar-unit.integration.test.ts` (ber-gerbang env).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: {
    jawab: (sql: string, params: unknown[]) => Jawab;
    qJawab: (sql: string, params: unknown[]) => unknown[];
    hari: (unitId: number, tanggal: string) => unknown;
  } = { jawab: () => undefined, qJawab: () => [], hari: () => undefined };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const qScoped = vi.fn(async (_u: unknown, sql: string, params: unknown[] = []) => state.qJawab(sql, params));
  const hariBukuTerkunci = vi.fn(async (_c: unknown, unitId: number, tanggal: string, _opsi?: unknown) => state.hari(unitId, tanggal));
  // Peta tenant config.ts: IB & BK = PT Sola Petra Abadi; BL = PT Batu Layang Jaya.
  const IB = { unit_id: 1, code: "6478111", name: "Imam Bonjol" };
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  const BL = { unit_id: 4, code: "6478201", name: "Batu Layang" };
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null, units: [IB, BK, BL] };
  return { log, state, connect, qScoped, hariBukuTerkunci, IB, BK, BL, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: h.qScoped, q: vi.fn(async () => []) }));
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

const { catatAntarUnit, balikPasanganAntarUnit, rekeningAntarUnit } = await import("./antar-unit-actions");

const AKUN_BK = "11111111-1111-4111-8111-111111111111";
const AKUN_BL = "22222222-2222-4222-8222-222222222222";
const PL_BK_BL = "33333333-3333-4333-8333-333333333333"; // di buku BK: pihak lawan "Batu Layang"
const PL_BL_BK = "44444444-4444-4444-8444-444444444444"; // di buku BL: pihak lawan "Bakau"
const PASANGAN = "55555555-5555-4555-8555-555555555555";

const sebagai = (role: string, email: string | null, units = [h.IB, h.BK, h.BL]) => {
  h.sesi.role = role;
  h.sesi.email = email;
  h.sesi.units = units;
};
const insertKas = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));
const voidKas = () => h.log.filter((l) => l.sql.includes("UPDATE app.cash_ledger") && l.sql.includes("SET void = true"));
const audit = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log"));

/** DB tiruan yang tahu rekening & pihak lawan berjenis unit BK ↔ BL. */
const dbPasangan = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.cash_account")) {
    const [id, unit] = p as [string, number];
    if (id === AKUN_BK && unit === h.BK.unit_id) return { rows: [{ id, nama: "Bank BCA - 111", active: true }] };
    if (id === AKUN_BL && unit === h.BL.unit_id) return { rows: [{ id, nama: "Bank BCA - 222", active: true }] };
    return { rows: [] };
  }
  if (sql.includes("FROM app.pihak_lawan") && sql.includes("lawan_unit_id = $2")) {
    const [unit, lawan] = p as [number, number];
    if (unit === h.BK.unit_id && lawan === h.BL.unit_id) {
      return { rows: [{ id: PL_BK_BL, nama: "Batu Layang", jenis: "unit", aktif: true, lawanUnitId: lawan }] };
    }
    if (unit === h.BL.unit_id && lawan === h.BK.unit_id) {
      return { rows: [{ id: PL_BL_BK, nama: "Bakau", jenis: "unit", aktif: true, lawanUnitId: lawan }] };
    }
    return { rows: [] };
  }
  if (sql.includes("INSERT INTO app.cash_ledger")) return { rows: [{ id: `kaki-${p[0]}` }] };
  return undefined;
};

const terbuka = (_u: number, t: string) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });

const masukan = {
  pemberiCode: h.BK.code,
  pemberiAccountId: AKUN_BK,
  penerimaCode: h.BL.code,
  penerimaAccountId: AKUN_BL,
  nominal: 500_000_000,
  tanggal: "2026-10-04",
  jenis: "pinjaman",
  catatan: "modal kerja",
};

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.qScoped.mockClear();
  h.hariBukuTerkunci.mockClear();
  h.state.jawab = dbPasangan;
  h.state.qJawab = () => [];
  h.state.hari = terbuka;
  sebagai("keuangan", "staf@solagroup.co");
});

describe("catat pasangan antar unit (R3, R30)", () => {
  it("🔴 AE1: BK → BL Rp 500 jt — dua kaki, satu pasangan_uuid, tanda berlawanan, pihak lawan saling menunjuk", async () => {
    const r = await catatAntarUnit(masukan);
    expect(r.ok).toBe(true);
    const cfg = h.log.find((l) => l.sql.includes("set_config('app.unit_ids'"))!;
    expect(cfg.params).toEqual([`${h.BK.unit_id},${h.BL.unit_id}`]);

    const ins = insertKas();
    expect(ins).toHaveLength(2);
    const [bk, bl] = ins.map((i) => i.params);
    // (unit, akun, hari buku, keterangan, jenis, sisi, kategori, amount, user, pihak lawan, pasangan, tanggal_asal, alasan, applies_to)
    expect(bk!.slice(0, 2)).toEqual([h.BK.unit_id, AKUN_BK]);
    expect(bk!.slice(4, 8)).toEqual(["kredit", "kredit", "Hutang Piutang", "-500000000.00"]);
    expect(bk![9]).toBe(PL_BK_BL);
    expect(bl!.slice(0, 2)).toEqual([h.BL.unit_id, AKUN_BL]);
    expect(bl!.slice(4, 8)).toEqual(["debet", "debet", "Hutang Piutang", "500000000.00"]);
    expect(bl![9]).toBe(PL_BL_BK);
    expect(bk![10]).toMatch(/^[0-9a-f-]{36}$/);
    expect(bk![10]).toBe(bl![10]);
    // Kedua hari terbuka ⇒ tak ada tanggal asal / kode alasan.
    expect(bk!.slice(11)).toEqual([null, null, null, null]);
    expect(bl!.slice(11)).toEqual([null, null, null, null]);
    // piutang BK = −(−X) = X; hutang BL = −(+X) = −X ⇒ sama besar.
    expect(-Number(bk![7]) + -Number(bl![7])).toBe(0);
    expect(String(bk![3])).toMatch(/ke Batu Layang/);
    expect(String(bl![3])).toMatch(/dari Bakau/);

    expect(audit()).toHaveLength(1);
    expect(audit()[0]!.params[2]).toBe("antar_unit.catat");
    expect(h.log.at(-1)!.sql).toBe("COMMIT");
  });

  it("hariBukuTerkunci dipanggil PER KAKI dengan unit & rekening kaki itu", async () => {
    await catatAntarUnit(masukan);
    expect(h.hariBukuTerkunci.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([
      [h.BK.unit_id, "2026-10-04", { accountId: AKUN_BK }],
      [h.BL.unit_id, "2026-10-04", { accountId: AKUN_BL }],
    ]);
  });

  it("🔴 hari penerima tertutup ⇒ kaki BL dibukukan 6 Okt bertanggal asal 4 Okt + ADJ-FWD-INTERUNIT; kaki BK tetap 4 Okt", async () => {
    h.state.hari = (u, t) =>
      u === h.BL.unit_id
        ? { status: "dibukukan", hariBuku: "2026-10-06", terdorongMaju: true, perluKodeAlasan: true }
        : terbuka(u, t);
    const r = await catatAntarUnit(masukan);
    expect(r.ok).toBe(true);
    const [bk, bl] = insertKas().map((i) => i.params);
    expect(bk![2]).toBe("2026-10-04");
    expect(bk!.slice(11)).toEqual([null, null, null, null]);
    expect(bl![2]).toBe("2026-10-06");
    expect(bl!.slice(11)).toEqual(["2026-10-04", "ADJ-FWD-INTERUNIT", "adjustment", null]);
  });

  it("pra-cut-over di salah satu kaki ⇒ ROLLBACK, tak satu kaki pun", async () => {
    h.state.hari = (u, t) => (u === h.BL.unit_id ? { status: "pra-cut-over", cutOver: "2026-10-05" } : terbuka(u, t));
    const r = await catatAntarUnit(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/cut-over|saldo pembuka/) });
    expect(insertKas()).toHaveLength(0);
    expect(h.log.some((l) => l.sql === "ROLLBACK")).toBe(true);
  });

  it("🔴 AE12: Keuangan hanya di tenant SPA (IB, BK) mencatat BK → BL ⇒ ditolak, TAK ADA koneksi", async () => {
    sebagai("keuangan", "staf@solagroup.co", [h.IB, h.BK]);
    const r = await catatAntarUnit(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/kedua unit/) });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.qScoped).not.toHaveBeenCalled();
  });

  it("🔴 unit PEMBERI di luar jangkauan juga ditolak utuh (gerbang simetris)", async () => {
    sebagai("keuangan", "staf@solagroup.co", [h.BL]);
    expect((await catatAntarUnit(masukan)).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 pengawas, Direksi, HoF ditolak SEBELUM koneksi; super admin lolos", async () => {
    for (const [peran, email] of [
      ["pengawas", "p@solagroup.co"],
      ["direksi", "d@solagroup.co"],
      ["admin_perusahaan", "hof@solagroup.co"],
    ] as const) {
      sebagai(peran, email);
      expect((await catatAntarUnit(masukan)).ok, peran).toBe(false);
    }
    expect(h.connect).not.toHaveBeenCalled();
    sebagai("super_admin", "root@solagroup.co");
    expect((await catatAntarUnit(masukan)).ok).toBe(true);
  });

  it("rekening bukan milik unitnya / nonaktif ⇒ ROLLBACK tanpa INSERT", async () => {
    const r = await catatAntarUnit({ ...masukan, penerimaAccountId: AKUN_BK });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Rekening/) });
    expect(insertKas()).toHaveLength(0);
    h.log.length = 0;
    h.state.jawab = (sql, p) =>
      sql.includes("FROM app.cash_account") ? { rows: [{ id: p[0], nama: "Bank", active: false }] } : dbPasangan(sql, p);
    expect((await catatAntarUnit(masukan)).ok).toBe(false);
    expect(insertKas()).toHaveLength(0);
  });

  it("pengembalian: jenis hanya label — arah tetap dari pemberi (kredit) ke penerima (debet)", async () => {
    await catatAntarUnit({ ...masukan, pemberiCode: h.BL.code, pemberiAccountId: AKUN_BL, penerimaCode: h.BK.code, penerimaAccountId: AKUN_BK, jenis: "pengembalian" });
    const [bl, bk] = insertKas().map((i) => i.params);
    expect([bl![0], bl![4], bl![7]]).toEqual([h.BL.unit_id, "kredit", "-500000000.00"]);
    expect([bk![0], bk![4], bk![7]]).toEqual([h.BK.unit_id, "debet", "500000000.00"]);
    expect(String(bl![3])).toMatch(/^Pengembalian pinjaman antar unit ke Bakau/);
  });

  it("validasi (unit sama, nominal 0) menolak sebelum koneksi", async () => {
    expect((await catatAntarUnit({ ...masukan, penerimaCode: h.BK.code })).ok).toBe(false);
    expect((await catatAntarUnit({ ...masukan, nominal: 0 })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("balik pasangan antar unit — HoF (R31)", () => {
  const input = { code: h.BK.code, pasanganUuid: PASANGAN, reasonCode: "ADJ-AMOUNT", catatan: "nominal salah ketik" };
  const kaki = [
    { id: "kaki-bk", unitId: h.BK.unit_id, accountId: AKUN_BK, businessDate: "2026-10-04", amount: "-500000000.00", jenis: "kredit", categorySide: "kredit", categoryLabel: "Hutang Piutang", pihakLawanId: PL_BK_BL, keterangan: "Pinjaman antar unit ke Batu Layang", void: false, alasanMaju: null },
    { id: "kaki-bl", unitId: h.BL.unit_id, accountId: AKUN_BL, businessDate: "2026-10-04", amount: "500000000.00", jenis: "debet", categorySide: "debet", categoryLabel: "Hutang Piutang", pihakLawanId: PL_BL_BK, keterangan: "Pinjaman antar unit dari Bakau", void: false, alasanMaju: null },
  ];
  const dbBalik = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
    if (sql.includes("FROM app.reason_code")) return { rows: p[0] === "ADJ-AMOUNT" ? [{ code: "ADJ-AMOUNT" }] : [] };
    if (sql.includes("FROM app.cash_ledger") && sql.includes("pasangan_uuid = $1")) return { rows: kaki };
    if (sql.includes("UPDATE app.cash_ledger")) return { rows: [], rowCount: 1 };
    if (sql.includes("INSERT INTO app.cash_ledger")) return { rows: [{ id: "pembalik" }] };
    return undefined;
  };
  beforeEach(() => {
    h.state.qJawab = () => [{ lawanUnitId: h.BL.unit_id }];
    h.state.jawab = dbBalik;
  });

  it("🔴 staf Keuangan DITOLAK sebelum koneksi", async () => {
    const r = await balikPasanganAntarUnit(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Head of Finance/) });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.qScoped).not.toHaveBeenCalled();
  });

  it("🔴 HoF, kedua hari terbuka ⇒ kedua kaki di-VOID (jejak void), tanpa baris baru, audit `antar_unit.balik`", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    const r = await balikPasanganAntarUnit(input);
    expect(r.ok).toBe(true);
    expect(h.log.find((l) => l.sql.includes("set_config('app.unit_ids'"))!.params).toEqual([`${h.BK.unit_id},${h.BL.unit_id}`]);
    const v = voidKas();
    expect(v).toHaveLength(2);
    expect(v[0]!.sql).toMatch(/voided_by_user_id = \$1, voided_at = now\(\)/);
    expect(v.map((x) => x.params[1])).toEqual(["kaki-bk", "kaki-bl"]);
    expect(insertKas()).toHaveLength(0);
    const a = audit();
    expect(a).toHaveLength(1);
    expect(a[0]!.params[2]).toBe("antar_unit.balik");
    expect(JSON.parse(a[0]!.params[4] as string)).toMatchObject({ reasonCode: "ADJ-AMOUNT", catatan: "nominal salah ketik" });
  });

  it("🔴 hari kaki BL tertutup ⇒ BK di-void, BL dibalik MAJU (tanda berlawanan, ADJ-FWD-REVERSAL, tanggal asal)", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    h.state.hari = (u, t) =>
      u === h.BL.unit_id
        ? { status: "dibukukan", hariBuku: "2026-10-09", terdorongMaju: true, perluKodeAlasan: true }
        : terbuka(u, t);
    const r = await balikPasanganAntarUnit(input);
    expect(r.ok).toBe(true);
    expect(voidKas().map((x) => x.params[1])).toEqual(["kaki-bk"]);
    const [ins] = insertKas();
    expect(ins!.params.slice(0, 3)).toEqual([h.BL.unit_id, AKUN_BL, "2026-10-09"]);
    expect(ins!.params.slice(4, 8)).toEqual(["kredit", "kredit", "Hutang Piutang", "-500000000.00"]);
    expect(ins!.params[9]).toBe(PL_BL_BK);
    expect(ins!.params[10]).toBe(PASANGAN);
    expect(ins!.params.slice(11)).toEqual(["2026-10-04", "ADJ-FWD-REVERSAL", "adjustment", null]);
  });

  it("🔴 U10: kaki di kelompok cocok AKTIF ⇒ 'batalkan cocok dulu', tak ada void/pembalik, tanpa COMMIT", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    h.state.jawab = (sql, p) =>
      sql.includes("FROM app.cocok_bank_baris") ? { rows: [{ unit: h.BL.unit_id }] } : dbBalik(sql, p);
    const r = await balikPasanganAntarUnit(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/sudah dicocokkan dengan rekening koran di Batu Layang — batalkan cocok dulu/) });
    expect(voidKas()).toHaveLength(0);
    expect(insertKas()).toHaveLength(0);
    expect(h.log.some((l) => l.sql.trim() === "COMMIT")).toBe(false);
    const cek = h.log.find((l) => l.sql.includes("FROM app.cocok_bank_baris"))!;
    expect(cek.params).toEqual([["kaki-bk", "kaki-bl"], [h.BK.unit_id, h.BL.unit_id]]);
  });

  it("🔴 HoF yang tak memegang unit lawan ⇒ ditolak utuh, tanpa koneksi tulis", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co", [h.IB, h.BK]);
    const r = await balikPasanganAntarUnit(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/ditolak utuh/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("kode alasan tak dikenal / kode maju sistem / catatan kosong ⇒ ditolak tanpa tulisan", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    expect((await balikPasanganAntarUnit({ ...input, catatan: " " })).ok).toBe(false);
    expect((await balikPasanganAntarUnit({ ...input, reasonCode: "ADJ-FWD-REVERSAL" })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
    expect((await balikPasanganAntarUnit({ ...input, reasonCode: "ADJ-NGAWUR" })).ok).toBe(false);
    expect(voidKas()).toHaveLength(0);
    expect(insertKas()).toHaveLength(0);
  });

  it("pasangan yang sudah dibalik ⇒ ditolak", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    h.state.jawab = (sql, p) =>
      sql.includes("pasangan_uuid = $1") && sql.includes("FROM app.cash_ledger")
        ? { rows: [kaki[0], { ...kaki[1], void: true }] }
        : dbBalik(sql, p);
    const r = await balikPasanganAntarUnit(input);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/sudah dibalik/) });
    expect(voidKas()).toHaveLength(0);
  });
});

describe("rekening unit lawan — dibaca server, hanya unit dalam jangkauan", () => {
  it("unit di luar jangkauan ⇒ ditolak tanpa kueri", async () => {
    sebagai("keuangan", "staf@solagroup.co", [h.IB, h.BK]);
    const r = await rekeningAntarUnit({ code: h.BL.code });
    expect(r.ok).toBe(false);
    expect(h.qScoped).not.toHaveBeenCalled();
  });
  it("unit dalam jangkauan ⇒ rekening aktif unit itu, lewat qScoped unit itu saja", async () => {
    h.state.qJawab = () => [{ id: AKUN_BL, nama: "Bank BCA - 222" }];
    const r = await rekeningAntarUnit({ code: h.BL.code });
    expect(r).toEqual({ ok: true, rekening: [{ id: AKUN_BL, nama: "Bank BCA - 222" }] });
    expect(h.qScoped.mock.calls[0]![0]).toBe(h.BL.unit_id);
  });
});
