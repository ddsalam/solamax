import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `simpanMutasiKas` berpihak lawan + `pecahMutasi` (rencana 2026-10-29 U3; R2,
 * R9, AE6, KTD3) — perilaku dengan DB TIRUAN. "Ditolak" dibuktikan sebagai
 * "tak ada koneksi / tak ada INSERT", bukan hanya pesannya.
 *
 * `hariBukuTerkunci` ditiru: perilakunya sendiri (kunci, hari tertutup) diuji
 * `hari-buku.test.ts` + `hari-buku.integration.test.ts`; di sini yang diuji
 * adalah bahwa pecahan MEMAKAI hasilnya (hari buku, tanggal asal, kode alasan).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string) => Jawab } = { jawab: () => undefined };
  let n = 0;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("INSERT INTO app.cash_ledger") && sql.includes("RETURNING")) {
        return { rows: [{ id: `baris-${++n}` }], rowCount: 1 };
      }
      const r = state.jawab(sql);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const hariBuku = vi.fn(async (_c: unknown, _u: unknown, tanggal: string) => ({
    status: "dibukukan" as const,
    hariBuku: tanggal,
    terdorongMaju: false,
    perluKodeAlasan: false,
  }));
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null };
  return { log, state, connect, hariBuku, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(), q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./hari-buku-queries", () => ({ hariBukuTerkunci: h.hariBuku }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: h.sesi.role,
    email: h.sesi.email,
    requireUnit(code: string) {
      if (code !== "6478111") throw new Error("NEXT_NOT_FOUND");
      return { unit_id: 6478, code, name: "IB" };
    },
  })),
}));

const { simpanMutasiKas, pecahMutasi } = await import("./kas-actions");

const PL = "11111111-1111-4111-8111-111111111111";
const AKUN = "44444444-4444-4444-8444-444444444444";
const pihakBaris = (over: Record<string, unknown> = {}) => (sql: string) =>
  sql.includes("FROM app.pihak_lawan\n")
    ? { rows: [{ id: PL, nama: "BPR Utari", jenis: "kreditur", aktif: true, lawanUnitId: null, ...over }] }
    : undefined;
const insertKas = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.cash_ledger"));

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.hariBuku.mockClear();
  h.state.jawab = () => undefined;
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
});

describe("simpanMutasiKas — kategori pihak lawan wajib menyebut pihak lawan (R2)", () => {
  const mutasi = {
    code: "6478111",
    date: "2026-10-02",
    accountId: AKUN,
    keterangan: "Pinjaman BPR",
    jenis: "debet" as const,
    categorySide: "debet" as const,
    categoryLabel: "Hutang Piutang",
    amount: 6_000_000,
  };

  it("🔴 tanpa pihak lawan DITOLAK di aksi, sebelum koneksi", async () => {
    const r = await simpanMutasiKas(mutasi);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/wajib menyebut pihak lawan/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 pihak lawan NONAKTIF tak bisa dipilih — tak ada INSERT", async () => {
    h.state.jawab = pihakBaris({ aktif: false });
    const r = await simpanMutasiKas({ ...mutasi, pihakLawanId: PL });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonaktif/) });
    expect(insertKas()).toHaveLength(0);
  });

  it("Penyerahan titipan hanya ke pemilik titipan", async () => {
    h.state.jawab = pihakBaris();
    const r = await simpanMutasiKas({
      ...mutasi,
      jenis: "kredit",
      categorySide: "kredit",
      categoryLabel: "Penyerahan titipan",
      amount: -25_000_000,
      pihakLawanId: PL,
    });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/pemilik titipan/) });
    expect(insertKas()).toHaveLength(0);
  });

  it("pihak lawan aktif sejenis: INSERT membawa pihak_lawan_id", async () => {
    h.state.jawab = pihakBaris();
    const r = await simpanMutasiKas({ ...mutasi, pihakLawanId: PL });
    expect(r).toEqual({ ok: true });
    const [ins] = insertKas();
    expect(ins!.sql).toMatch(/pihak_lawan_id/);
    expect(ins!.params.at(-1)).toBe(PL);
  });

  it("kategori biasa tetap jalan tanpa pihak lawan (perilaku lama)", async () => {
    const r = await simpanMutasiKas({ ...mutasi, categoryLabel: "Pendapatan Lain", pihakLawanId: null });
    expect(r).toEqual({ ok: true });
    expect(insertKas()[0]!.params.at(-1)).toBeNull();
  });
});

describe("pecahMutasi — AE6 (R9)", () => {
  const pecahan = (bunga: number) => ({
    code: "6478111",
    date: "2026-10-02",
    accountId: AKUN,
    keterangan: "Angsuran BPR Okt",
    jenis: "kredit" as const,
    total: -6_500_000,
    baris: [
      { amount: -6_000_000, categorySide: "kredit" as const, categoryLabel: "Hutang Piutang", pihakLawanId: PL, keterangan: "Pokok" },
      { amount: -bunga, categorySide: "kredit" as const, categoryLabel: "Biaya Operasional", pihakLawanId: null, keterangan: "Bunga" },
    ],
  });

  it("🔴 AE6: 6.000.000 (kreditur BPR) + 500.000 (beban) TERSIMPAN — dua baris, satu hari buku", async () => {
    h.state.jawab = pihakBaris();
    const r = await pecahMutasi(pecahan(500_000));
    expect(r).toEqual({ ok: true, n: 2 });
    const ins = insertKas();
    expect(ins).toHaveLength(2);
    expect(ins[0]!.params).toContain(-6_000_000);
    expect(ins[0]!.params).toContain(PL);
    expect(ins[1]!.params).toContain(-500_000);
    expect(h.hariBuku).toHaveBeenCalledTimes(1);
    // Jejak siapa & kapan (R27): created_by di tiap baris + audit_log pecahan.
    const audit = h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.params[2]).toBe("kas.pecah");
  });

  it("🔴 AE6: 6.000.000 + 499.999 DITOLAK dengan selisih Rp 1 — sebelum koneksi", async () => {
    const r = await pecahMutasi(pecahan(499_999));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/selisih Rp 1\b/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("baris berkategori pihak lawan tanpa pihak lawan ditolak sebelum koneksi", async () => {
    const p = pecahan(500_000);
    p.baris[0]!.pihakLawanId = null as unknown as string;
    const r = await pecahMutasi(p);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Baris 1: .*wajib menyebut pihak lawan/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("hari tertutup: dibukukan MAJU membawa tanggal asal + ADJ-FWD", async () => {
    h.state.jawab = pihakBaris();
    h.hariBuku.mockResolvedValueOnce({ status: "dibukukan", hariBuku: "2026-11-03", terdorongMaju: true, perluKodeAlasan: true });
    const r = await pecahMutasi(pecahan(500_000));
    expect(r.ok).toBe(true);
    for (const ins of insertKas()) {
      expect(ins.sql).toMatch(/tanggal_asal, alasan_maju, alasan_maju_applies_to/);
      expect(ins.params).toContain("2026-11-03");
      expect(ins.params).toContain("2026-10-02");
      expect(ins.params).toContain("ADJ-FWD-IMPORT");
    }
  });

  it("pra-cut-over: TIDAK dibukukan sama sekali", async () => {
    h.hariBuku.mockResolvedValueOnce({ status: "pra-cut-over", cutOver: "2026-10-01" } as never);
    const r = await pecahMutasi({ ...pecahan(500_000), date: "2026-09-30" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/mendahului saldo pembuka/) });
    expect(insertKas()).toHaveLength(0);
  });

  it("🔴 pengawas & HoF tidak boleh memecah", async () => {
    for (const [role, email] of [
      ["pengawas", "p@solagroup.co"],
      ["admin_perusahaan", "hof@solagroup.co"],
    ] as const) {
      h.sesi.role = role;
      h.sesi.email = email;
      expect((await pecahMutasi(pecahan(500_000))).ok, role).toBe(false);
    }
    expect(h.connect).not.toHaveBeenCalled();
  });
});
