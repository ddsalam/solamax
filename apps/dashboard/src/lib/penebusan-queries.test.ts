import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kueri baca penebusan (rencana 2026-10-29 U7; R12, R13) dengan `qScoped`
 * TIRUAN. Yang dibuktikan di sini: bentuk tautan ke EasyMax (`lower(trim(cnoso))`
 * = SO ternormalisasi, SO batal diabaikan), jangkauan unit, dan pemetaan baris
 * DB → tampilan (produk/volume bila tertaut, `null` bila belum). Bahwa SQL-nya
 * DIEKSEKUSI Postgres: `queries.sqlcheck.integration.test.ts` (gerbang deploy).
 */
const h = vi.hoisted(() => {
  const panggil: { unit: unknown; sql: string; params: unknown[] }[] = [];
  const jawab: { rows: unknown[] } = { rows: [] };
  const qScoped = vi.fn(async (unit: unknown, sql: string, params: unknown[] = []) => {
    panggil.push({ unit, sql, params });
    return jawab.rows;
  });
  return { panggil, jawab, qScoped };
});
vi.mock("./db", () => ({ qScoped: h.qScoped, q: vi.fn(async () => []) }));

const { getPenebusanBulan, getSoBelumTertaut, getRekeningBank } = await import("./penebusan-queries");
type U = Parameters<typeof getSoBelumTertaut>[0];
const BK = 2 as unknown as U;
const IB = 1 as unknown as U;

const barisDb = (o: Record<string, unknown> = {}) => ({
  id: "p1",
  unitCode: "6378301",
  noSo: "so-1234567",
  tanggalBayar: "2026-10-02",
  rekening: "Bank BCA - 5125036811",
  net: "100000000.00",
  ppn: "11000000.00",
  pph: "250000.00",
  pbbkb: "7500000.00",
  nota: "0.00",
  gross: "118750000.00",
  kasDibuat: true,
  hariBuku: "2026-10-02",
  tanggalAsal: null,
  nSo: 1,
  produk: "Pertalite",
  volume: 16000,
  ...o,
});

beforeEach(() => {
  h.panggil.length = 0;
  h.jawab.rows = [];
});

describe("getPenebusanBulan — tautan SO EasyMax (R12) & sen bulat", () => {
  it("🔴 SO ada di tebus_header ⇒ produk & volume; komponen dalam sen", async () => {
    h.jawab.rows = [barisDb()];
    const [r] = await getPenebusanBulan([BK], "2026-10");
    expect(r).toMatchObject({
      noSo: "so-1234567",
      tertaut: true,
      produk: "Pertalite",
      volume: 16000,
      netSen: 10_000_000_000,
      grossSen: 11_875_000_000,
      notaSen: 0,
    });
  });

  it("🔴 SO tak ada di tebus_header ⇒ tertaut false, produk/volume null (bukan 0)", async () => {
    h.jawab.rows = [barisDb({ nSo: 0, produk: null, volume: null })];
    const [r] = await getPenebusanBulan([BK], "2026-10");
    expect(r).toMatchObject({ tertaut: false, produk: null, volume: null });
  });

  it("join EasyMax: lower(trim(th.cnoso)) = p.no_so, SO batal diabaikan, unit yang sama", async () => {
    await getPenebusanBulan([BK], "2026-10");
    const { sql, params, unit } = h.panggil[0]!;
    expect(sql).toMatch(/lower\(trim\(th\.cnoso\)\) = p\.no_so/);
    expect(sql).toMatch(/COALESCE\(th\.sbatal,\s*0\) = 0/);
    expect(sql).toMatch(/th\.unit_id = p\.unit_id/);
    expect(sql).toMatch(/NOT p\.void/);
    expect(params).toEqual([[2], "2026-10-01", "2026-10-31"]);
    expect(unit).toEqual([BK]);
  });

  it("rekap PT: beberapa unit dalam SATU qScoped (jangkauan = unit yang dipegang)", async () => {
    await getPenebusanBulan([IB, BK], "2026-10");
    expect(h.panggil[0]!.unit).toEqual([IB, BK]);
    expect(h.panggil[0]!.params[0]).toEqual([1, 2]);
  });

  it("bulan tak sah ⇒ melempar sebelum kueri", async () => {
    await expect(getPenebusanBulan([BK], "2026-13")).rejects.toThrow();
    expect(h.panggil).toHaveLength(0);
  });
});

describe("getSoBelumTertaut — daftar terbuka (R12)", () => {
  it("🔴 hanya penebusan aktif yang SO-nya tak ditemukan di tebus_header", async () => {
    h.jawab.rows = [{ id: "p9", noSo: "so-x", tanggalBayar: "2026-10-03", rekening: "Bank BCA - 1", gross: "5000000.00" }];
    const r = await getSoBelumTertaut(BK);
    expect(r).toEqual([{ id: "p9", noSo: "so-x", tanggalBayar: "2026-10-03", rekening: "Bank BCA - 1", grossSen: 500_000_000 }]);
    const { sql } = h.panggil[0]!;
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM tebus_header th/);
    expect(sql).toMatch(/lower\(trim\(th\.cnoso\)\) = p\.no_so/);
    expect(sql).toMatch(/NOT p\.void/);
  });
});

describe("getRekeningBank", () => {
  it("hanya rekening BANK aktif unit ini", async () => {
    await getRekeningBank(BK);
    expect(h.panggil[0]!.sql).toMatch(/kind = 'bank' AND active/);
  });
});
