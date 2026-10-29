import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server action pihak lawan (rencana 2026-10-29 U3) — perilaku gerbang &
 * validasi dengan DB TIRUAN. Klien tiruan mencatat setiap pernyataan, sehingga
 * "ditolak" dibuktikan sebagai "tak ada koneksi / tak ada INSERT", bukan hanya
 * pesan yang benar.
 *
 * ⚠️ Batas: SQL-nya tidak dijalankan. Penegakan DB (RLS, FK komposit, CHECK
 * 0049) dibuktikan `pihak-lawan.integration.test.ts` dan
 * `pihak-lawan-saldo-awal.integration.test.ts` (ber-gerbang env).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: {
    jawab: (sql: string, params: unknown[]) => Jawab;
    qJawab: (sql: string, params: unknown[]) => unknown[];
  } = { jawab: () => undefined, qJawab: () => [] };
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
  const A = { unit_id: 6478, code: "6478111", name: "IB" };
  const B = { unit_id: 6479, code: "6479222", name: "Bakau" };
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null, units: [A, B] };
  return { log, state, connect, qScoped, A, B, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: h.qScoped, q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

const { tambahPihakLawan, nonaktifkanPihakLawan, tetapkanSaldoAwalPihakLawan, tetapkanPihakLawanBaris } =
  await import("./pihak-lawan-actions");

const PL = "11111111-1111-4111-8111-111111111111";
const PL_B = "22222222-2222-4222-8222-222222222222";
const KAS = "33333333-3333-4333-8333-333333333333";

const sebagai = (role: string, email: string | null = "orang@solagroup.co", units = [h.A, h.B]) => {
  h.sesi.role = role;
  h.sesi.email = email;
  h.sesi.units = units;
};
const KEUANGAN = () => sebagai("keuangan", "staf@solagroup.co");
const HOF = () => sebagai("admin_perusahaan", "hof@solagroup.co");
const insert = (tabel: string) => h.log.filter((l) => l.sql.includes(`INSERT INTO app.${tabel}`));
const urutanSql = () => h.log.map((l) => l.sql.trim().split(/\s+/).slice(0, 3).join(" "));

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.qScoped.mockClear();
  h.state.jawab = () => undefined;
  h.state.qJawab = () => [];
  KEUANGAN();
});

describe("tambah pihak lawan — Keuangan saja", () => {
  it("🔴 pengawas & HoF ditolak SEBELUM koneksi", async () => {
    for (const [peran, email] of [
      ["pengawas", "p@solagroup.co"],
      ["admin_perusahaan", "hof@solagroup.co"],
      ["keuangan", "hof@solagroup.co"],
    ] as const) {
      sebagai(peran, email);
      const r = await tambahPihakLawan({ code: h.A.code, jenis: "kreditur", nama: "BPR Utari" });
      expect(r.ok, peran).toBe(false);
    }
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("Keuangan menambah kreditur: INSERT ber-unit ter-scope + audit_log", async () => {
    const r = await tambahPihakLawan({ code: h.A.code, jenis: "kreditur", nama: "  BPR Utari " });
    expect(r.ok).toBe(true);
    const [ins] = insert("pihak_lawan");
    expect(ins!.params).toEqual([h.A.unit_id, "kreditur", "BPR Utari", 7]);
    expect(insert("audit_log")[0]!.params[2]).toBe("pihak_lawan.tambah");
  });

  it("jenis `unit` tak dibuat tangan; nama kosong ditolak", async () => {
    expect((await tambahPihakLawan({ code: h.A.code, jenis: "unit", nama: "X" })).ok).toBe(false);
    expect((await tambahPihakLawan({ code: h.A.code, jenis: "kreditur", nama: "  " })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("nonaktifkan pihak lawan — Keuangan", () => {
  it("UPDATE aktif=false hanya pada baris aktif unit ini, beraudit", async () => {
    h.state.jawab = (sql) => (sql.includes("UPDATE app.pihak_lawan") ? { rows: [{ nama: "BPR" }] } : undefined);
    expect((await nonaktifkanPihakLawan({ code: h.A.code, id: PL })).ok).toBe(true);
    const upd = h.log.find((l) => l.sql.includes("UPDATE app.pihak_lawan"))!;
    expect(upd.sql).toMatch(/SET aktif = false/);
    expect(upd.sql).toMatch(/AND aktif/);
    expect(upd.params).toEqual([PL, h.A.unit_id]);
    expect(insert("audit_log")[0]!.params[2]).toBe("pihak_lawan.nonaktifkan");
  });

  it("pengawas ditolak", async () => {
    sebagai("pengawas");
    expect((await nonaktifkanPihakLawan({ code: h.A.code, id: PL })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("saldo pembuka pihak lawan — Head of Finance (R7)", () => {
  const masukan = { code: h.A.code, pihakLawanId: PL, tanggal: "2026-10-01", amount: 0, sementara: true, alasan: "menunggu konfirmasi BPR" };
  const kreditur = (sql: string): { rows: unknown[] } | undefined =>
    sql.includes("FROM app.pihak_lawan\n")
      ? { rows: [{ id: PL, nama: "BPR", jenis: "kreditur", aktif: true, lawanUnitId: null }] }
      : undefined;

  it("🔴 staf Keuangan (non-HoF) DITOLAK, tanpa koneksi", async () => {
    const r = await tetapkanSaldoAwalPihakLawan(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Head of Finance/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 HoF: Rp 0 tersimpan bertanda SEMENTARA, audit `tetapkan`", async () => {
    HOF();
    h.state.qJawab = () => [{ jenis: "kreditur", lawanUnitId: null }];
    h.state.jawab = kreditur;
    const r = await tetapkanSaldoAwalPihakLawan(masukan);
    expect(r.ok).toBe(true);
    const [ins] = insert("pihak_lawan_saldo_awal");
    expect(ins!.params).toEqual([h.A.unit_id, PL, "2026-10-01", 0, true, 7]);
    expect(insert("audit_log")[0]!.params[2]).toBe("pihak_lawan.saldo_awal.tetapkan");
    expect(h.log.some((l) => l.sql.includes("UPDATE app.pihak_lawan_saldo_awal"))).toBe(false);
  });

  it("Rp 0 tanpa sementara ditolak sebelum koneksi", async () => {
    HOF();
    expect((await tetapkanSaldoAwalPihakLawan({ ...masukan, sementara: false })).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 GANTI = void yang lama + insert baru + audit `ganti`, berurutan", async () => {
    HOF();
    h.state.qJawab = () => [{ jenis: "kreditur", lawanUnitId: null }];
    h.state.jawab = (sql) =>
      kreditur(sql) ??
      (sql.includes("FROM app.pihak_lawan_saldo_awal")
        ? { rows: [{ id: "lama-1", amount: "0.00", tanggal: "2026-10-01", sementara: true }] }
        : undefined);
    const r = await tetapkanSaldoAwalPihakLawan({ ...masukan, amount: -125_000_000, sementara: false });
    expect(r.ok).toBe(true);
    const u = urutanSql();
    const iVoid = h.log.findIndex((l) => l.sql.includes("UPDATE app.pihak_lawan_saldo_awal"));
    const iIns = h.log.findIndex((l) => l.sql.includes("INSERT INTO app.pihak_lawan_saldo_awal"));
    const iAudit = h.log.findIndex((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(iVoid, u.join(" | ")).toBeGreaterThan(-1);
    expect(iVoid).toBeLessThan(iIns);
    expect(iIns).toBeLessThan(iAudit);
    expect(h.log[iVoid]!.sql).toMatch(/SET void = true, voided_by_user_id = \$2, voided_at = now\(\)/);
    expect(insert("audit_log")[0]!.params[2]).toBe("pihak_lawan.saldo_awal.ganti");
    expect(JSON.parse(insert("audit_log")[0]!.params[4] as string).sebelumnya).toEqual({
      tanggal: "2026-10-01",
      nominal: "0.00",
      sementara: true,
    });
  });

  describe("pasangan unit — satu pengisian, dua sisi (Gerbang dua unit)", () => {
    const unitPL = (sql: string): { rows: unknown[] } | undefined => {
      if (sql.includes("FROM app.pihak_lawan\n") && sql.includes("id = $1::uuid")) {
        return { rows: [{ id: PL, nama: "Bakau", jenis: "unit", aktif: true, lawanUnitId: h.B.unit_id }] };
      }
      if (sql.includes("lawan_unit_id = $2")) return { rows: [{ id: PL_B }] };
      return undefined;
    };

    it("🔴 HoF memegang kedua unit: dua baris, tanda berlawanan, scope kedua unit", async () => {
      HOF();
      h.state.qJawab = () => [{ jenis: "unit", lawanUnitId: h.B.unit_id }];
      h.state.jawab = unitPL;
      const r = await tetapkanSaldoAwalPihakLawan({ ...masukan, amount: 500_000_000, sementara: false });
      expect(r.ok).toBe(true);
      const cfg = h.log.find((l) => l.sql.includes("set_config('app.unit_ids'"))!;
      expect(cfg.params).toEqual([`${h.A.unit_id},${h.B.unit_id}`]);
      const ins = insert("pihak_lawan_saldo_awal");
      expect(ins).toHaveLength(2);
      expect(ins[0]!.params.slice(0, 4)).toEqual([h.A.unit_id, PL, "2026-10-01", 500_000_000]);
      expect(ins[1]!.params.slice(0, 4)).toEqual([h.B.unit_id, PL_B, "2026-10-01", -500_000_000]);
      expect(insert("audit_log")).toHaveLength(2);
    });

    it("🔴 HoF hanya memegang unit A: DITOLAK UTUH, tanpa koneksi, tak satu sisi pun", async () => {
      sebagai("admin_perusahaan", "hof@solagroup.co", [h.A]);
      h.state.qJawab = () => [{ jenis: "unit", lawanUnitId: h.B.unit_id }];
      const r = await tetapkanSaldoAwalPihakLawan({ ...masukan, amount: 500_000_000, sementara: false });
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/ditolak utuh/) });
      expect(h.connect).not.toHaveBeenCalled();
      expect(insert("pihak_lawan_saldo_awal")).toHaveLength(0);
    });
  });
});

describe("Tetapkan pihak lawan — baris Hutang Piutang lama (KTD3)", () => {
  const baris = (pihak: { jenis: string; aktif: boolean }) => (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
    if (sql.includes("FROM app.cash_ledger")) {
      return {
        rows: [{ categoryLabel: "Hutang Piutang", pihakLawanId: null, void: false, amount: "-6000000.00", businessDate: "2026-10-02" }],
      };
    }
    if (sql.includes("FROM app.pihak_lawan\n")) return { rows: [{ id: PL, nama: "BPR", lawanUnitId: null, ...pihak }] };
    if (sql.includes("UPDATE app.cash_ledger")) return { rows: [], rowCount: 1 };
    return undefined;
  };

  it("mengisi pihak_lawan_id SEKALI dari NULL; nominal/tanggal/kategori tak disentuh; beraudit", async () => {
    h.state.jawab = baris({ jenis: "kreditur", aktif: true });
    const r = await tetapkanPihakLawanBaris({ code: h.A.code, cashLedgerId: KAS, pihakLawanId: PL });
    expect(r.ok).toBe(true);
    const upd = h.log.find((l) => l.sql.includes("UPDATE app.cash_ledger"))!;
    expect(upd.sql).toMatch(/SET pihak_lawan_id = \$1::uuid\s/);
    expect(upd.sql).toMatch(/pihak_lawan_id IS NULL AND NOT void/);
    expect(upd.sql).not.toMatch(/amount|business_date|category_label/);
    expect(insert("audit_log")[0]!.params[2]).toBe("kas.pihak_lawan.tetapkan");
  });

  it("🔴 pihak lawan nonaktif tak bisa dipilih — tak ada UPDATE", async () => {
    h.state.jawab = baris({ jenis: "kreditur", aktif: false });
    const r = await tetapkanPihakLawanBaris({ code: h.A.code, cashLedgerId: KAS, pihakLawanId: PL });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonaktif/) });
    expect(h.log.some((l) => l.sql.includes("UPDATE app.cash_ledger"))).toBe(false);
  });

  it("🔴 HoF & pengawas ditolak sebelum koneksi", async () => {
    for (const s of [HOF, () => sebagai("pengawas")]) {
      s();
      expect((await tetapkanPihakLawanBaris({ code: h.A.code, cashLedgerId: KAS, pihakLawanId: PL })).ok).toBe(false);
    }
    expect(h.connect).not.toHaveBeenCalled();
  });
});
