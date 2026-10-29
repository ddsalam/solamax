import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Negative-access tulis manual_entry (penegasan A, jalur server action). Gerbang:
 * `unit_id` SELALU dari `scope.requireUnit(code)` (notFound utk kode di luar scope)
 * → tak pernah dari input mentah. Bila gerbang dilepas (pakai input mentah / skip
 * requireUnit), test "out-of-scope" jadi MERAH.
 */
// qScoped (RLS executor) di-mock DELEGATE ke q → assertion `q.mock.calls` tetap sah.
const { q, qScoped } = vi.hoisted(() => {
  const q = vi.fn((_t: string, _p?: unknown[]) => Promise.resolve([] as unknown[]));
  const qScoped = vi.fn((_unit: unknown, t: string, p?: unknown[]) => q(t, p));
  return { q, qScoped };
});
vi.mock("./db", () => ({ q, qScoped, pool: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Fake scope: requireUnit MENIRU gerbang asli (notFound throw utk kode di luar scope).
const SCOPED = [{ unit_id: 6478, code: "6478111", name: "IB" }];
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    requireUnit(code: string) {
      const u = SCOPED.find((x) => x.code === code);
      if (!u) throw new Error("NEXT_NOT_FOUND"); // = notFound()
      return u;
    },
  })),
}));

const { addManualEntry, voidManualEntry } = await import("./manual-entry-actions");

describe("manual_entry server action — tulis ter-scope", () => {
  beforeEach(() => q.mockClear());

  it("in-scope: INSERT unit_id = scoped (bukan input), created_by = user sesi", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "pengeluaran",
      keterangan: "BELI LAKBAN", amount: 15000,
    });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO app.manual_entry");
    expect(params![0]).toBe(6478); // unit_id TER-SCOPE
    expect(params![5]).toBe(7); // created_by_user_id = userId sesi
  });

  it("out-of-scope: requireUnit notFound → throw, TAK ADA tulis", async () => {
    await expect(
      addManualEntry({
        code: "9999999", date: "2026-06-14", section: "pengeluaran",
        keterangan: "x", amount: 1,
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(q).not.toHaveBeenCalled();
  });

  it("void: UPDATE ter-scope (unit_id=$3) + voided_by/voided_at", async () => {
    const res = await voidManualEntry({ code: "6478111", date: "2026-06-14", id: "uuid-1" });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE app\.manual_entry/);
    expect(sql).toContain("void=true");
    expect(sql).toMatch(/voided_by_user_id=\$1/);
    expect(sql).toMatch(/unit_id=\$3/);
    expect(params![2]).toBe(6478); // ter-scope
  });

  it("setoran_tunai: seksi diterima, INSERT unit_id ter-scope", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "setoran_tunai",
      keterangan: "Setoran BCA 14:00", amount: 5_000_000,
    });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO app.manual_entry");
    expect(params![0]).toBe(6478); // unit_id TER-SCOPE (bukan input mentah)
    expect(params![2]).toBe("setoran_tunai");
  });

  it("setoran_tunai: out-of-scope tetap ditolak (requireUnit notFound), TAK ADA tulis", async () => {
    await expect(
      addManualEntry({
        code: "9999999", date: "2026-06-14", section: "setoran_tunai",
        keterangan: "x", amount: 1,
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(q).not.toHaveBeenCalled();
  });

  it("validasi: amount ≤ 0 ditolak tanpa tulis", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "pengeluaran",
      keterangan: "x", amount: 0,
    });
    expect(res.ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// U5 — pemilik titipan dipilih pengawas (R6, KTD11)
// ---------------------------------------------------------------------------
describe("addManualEntry — titipan WAJIB menyebut pemiliknya", () => {
  const PEMILIK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const titipan = (over: Record<string, unknown> = {}) => ({
    code: "6478111",
    date: "2026-10-05",
    section: "pendapatan_lain" as const,
    keterangan: "SETORAN KEBAB",
    amount: 4_500_000,
    titipan: true,
    pemilikTitipanId: PEMILIK,
    ...over,
  });
  /** Jawaban kueri baca-ulang pemilik; `null` = tak ditemukan di unit ini. */
  const pemilikDb = (row: { jenis: string; aktif: boolean } | null) =>
    q.mockImplementation(async (sql: string) =>
      sql.includes("FROM app.pihak_lawan") ? (row === null ? [] : [{ nama: "Kebab", ...row }]) : [],
    );
  const inserts = () => q.mock.calls.filter(([sql]) => sql.includes("INSERT INTO app.manual_entry"));

  beforeEach(() => {
    q.mockReset();
    q.mockImplementation(async () => []);
  });

  it("pemilik aktif, unit sama, jenis titipan ⇒ INSERT membawa pihak_lawan_id + kategori titipan", async () => {
    pemilikDb({ jenis: "titipan", aktif: true });
    expect(await addManualEntry(titipan())).toEqual({ ok: true });
    const [baca] = q.mock.calls.filter(([sql]) => sql.includes("FROM app.pihak_lawan"));
    expect(baca![0]).toMatch(/unit_id = \$2/);
    expect(baca![1]).toEqual([PEMILIK, 6478]); // unit TER-SCOPE, bukan input
    const [[sql, params]] = inserts() as [[string, unknown[]]];
    expect(sql).toMatch(/pihak_lawan_id/);
    expect(params[6]).toBe("Titipan outlet");
    expect(params[7]).toBe(PEMILIK);
  });

  it("🔴 titipan TANPA pemilik ditolak, tak ada tulis", async () => {
    const r = await addManualEntry(titipan({ pemilikTitipanId: undefined }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/pemilik titipan/i) });
    expect(q).not.toHaveBeenCalled();
  });

  it("🔴 id pemilik bukan uuid ditolak sebelum kueri", async () => {
    const r = await addManualEntry(titipan({ pemilikTitipanId: "1; DROP" }));
    expect(r.ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it("🔴 pemilik unit LAIN (tak terbaca di unit ini) ditolak", async () => {
    pemilikDb(null);
    const r = await addManualEntry(titipan());
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/tak ditemukan di unit ini/) });
    expect(inserts()).toHaveLength(0);
  });

  it("🔴 pemilik NONAKTIF ditolak", async () => {
    pemilikDb({ jenis: "titipan", aktif: false });
    const r = await addManualEntry(titipan());
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nonaktif/) });
    expect(inserts()).toHaveLength(0);
  });

  it("🔴 pihak lawan BUKAN pemilik titipan ditolak", async () => {
    pemilikDb({ jenis: "kreditur", aktif: true });
    const r = await addManualEntry(titipan());
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/bukan pemilik titipan/) });
    expect(inserts()).toHaveLength(0);
  });

  it("bukan titipan ⇒ pihak_lawan_id kosong walau id dikirim; keterangan berbunyi titipan ⇒ 'Lain-Lain'", async () => {
    expect(await addManualEntry(titipan({ titipan: false, keterangan: "SETORAN BRIGHT" }))).toEqual({ ok: true });
    const [[, params]] = inserts() as [[string, unknown[]]];
    expect(params[6]).toBe("Lain-Lain");
    expect(params[7]).toBeNull();
    expect(q.mock.calls.some(([sql]) => sql.includes("FROM app.pihak_lawan"))).toBe(false);
  });

  it("seksi selain Pendapatan Lain tak pernah membawa pemilik", async () => {
    expect(await addManualEntry(titipan({ section: "pengeluaran" }))).toEqual({ ok: true });
    const [[, params]] = inserts() as [[string, unknown[]]];
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
  });
});

