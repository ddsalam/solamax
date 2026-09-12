import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

// Mock db.q (hindari makePool() yang butuh DATABASE_URL). Verifikasi konstruksi
// SQL + scoping tanpa DB nyata.
// qScoped (RLS executor) di-mock DELEGATE ke q → assertion `q.mock.calls` tetap sah
// (fungsi kini memanggil qScoped(unit, sql, params); delegasi memanggil q(sql, params)).
const { q, qScoped } = vi.hoisted(() => {
  const q = vi.fn((_text: string, _params?: unknown[]) => Promise.resolve([] as unknown[]));
  const qScoped = vi.fn((_unit: unknown, text: string, params?: unknown[]) => q(text, params));
  return { q, qScoped };
});
vi.mock("./db", () => ({ q, qScoped, pool: {} }));

const {
  getPelangganForDate,
  getEdcForDate,
  getEdcBlankCard,
  getDepositForDate,
  getManualEntries,
} = await import("./queries");

const U = 6478 as unknown as ScopedUnitId;

describe("F1c queries: scoped ($1=unit) + schema-qualified", () => {
  beforeEach(() => q.mockClear());

  it("getPelangganForDate: liter dari detail, RUPIAH dari POSTING dua buku, scoped", async () => {
    await getPelangganForDate(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.pelanggan_sale");
    expect(sql).toContain("public.voucher_sale");
    // Rupiah voucher HARUS datang dari posting di KEDUA buku — bukan dari
    // voucher_sale.total. Regresi 2026-09-11 (BCA 31-08, Rp 48.900).
    expect(sql).toContain("public.bppiut");
    expect(sql).toContain("public.bphut");
    expect(sql).toMatch(/vcref LIKE 'UV%'/);
    expect(sql).toMatch(/sjnsbp = 1/);
    // C = jualplg + posting; detail voucher HANYA menyumbang liter + selisih.
    expect(sql).toMatch(/COALESCE\(jp\.rp,0\) \+ COALESCE\(vp\.rp,0\)/);
    expect(sql).toMatch(/COALESCE\(jp\.liter,0\) \+ COALESCE\(vd\.liter,0\)/);
    expect(sql).toMatch(/COALESCE\(vd\.rp,0\) - COALESCE\(vp\.rp,0\)/);
    expect(sql).toMatch(/COALESCE\(ps\.sbatal,0\) = 0/);
    expect(sql).toMatch(/COALESCE\(vs\.sbatal,0\) = 0/);
    expect(sql).toMatch(/COALESCE\(b\.sbatal,0\) = 0/);
    expect(sql).toMatch(/COALESCE\(h\.sbatal,0\) = 0/);
    expect(sql).toContain("unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getPelangganForDate: baris YATIM (ckdplg NULL) dikumpulkan, tidak hilang", async () => {
    // Regresi 2026-09-12. `pelanggan_sale` ber-ckdplg NULL adalah pengisian yang
    // tautannya ke transaksi diputus di POS. Tanpa COALESCE ke sentinel, kunci
    // NULL tak pernah cocok di LEFT JOIN (NULL = NULL bukan true) sehingga
    // barisnya HILANG dari seksi Pelanggan — persis kekurangan Rp 675.054 di
    // Bundaran Kotabaru 31-08-2026.
    await getPelangganForDate(U, "2026-08-31");
    const [sql] = q.mock.calls[0]!;
    expect(sql).toMatch(/COALESCE\(trim\(ps\.ckdplg\), '\(tanpa transaksi\)'\)/);
    expect(sql).toMatch(/COALESCE\(trim\(vs\.ckdplg\), '\(tanpa transaksi\)'\)/);
    expect(sql).toContain("PENGISIAN KARTU TANPA TRANSAKSI");
    // Penjaga arah-balik: kunci telanjang `trim(ps.ckdplg)` mengembalikan bug.
    expect(sql).not.toMatch(/SELECT trim\(ps\.ckdplg\) AS k/);
    expect(sql).not.toMatch(/SELECT trim\(vs\.ckdplg\) AS k/);
  });

  it("getPelangganForDate: TIDAK menjumlah voucher_sale.total ke rupiah", async () => {
    // Penjaga arah-balik: bentuk lama `sum(u.rp)` atas UNION ALL dua tabel
    // penjualan mengembalikan bug 31-08. Kalau seseorang menuliskannya lagi,
    // uji ini merah.
    await getPelangganForDate(U, "2026-06-14");
    const [sql] = q.mock.calls[0]!;
    expect(sql).not.toMatch(/COALESCE\(vs\.total,0\)\s*(?:AS\s+rp)?\s*$/m);
    expect(sql).not.toMatch(/sum\(u\.rp\)/);
  });

  it("getEdcForDate: public.edc, blank-card DIKECUALIKAN, join master card", async () => {
    await getEdcForDate(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.edc");
    expect(sql).toContain("public.card");
    expect(sql).toMatch(/e\.ckdkartu IS NOT NULL/);
    expect(sql).toMatch(/trim\(e\.ckdkartu\) <> ''/);
    expect(sql).toContain("e.unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getEdcBlankCard: HANYA blank-card (ckdkartu null/''), scoped", async () => {
    await getEdcBlankCard(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.edc");
    expect(sql).toMatch(/e\.ckdkartu IS NULL OR trim\(e\.ckdkartu\) = ''/);
    expect(sql).toContain("e.unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getDepositForDate: public.deposit by dtgl, non-batal, scoped", async () => {
    await getDepositForDate(U, "2026-06-17");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.deposit");
    expect(sql).toMatch(/d\.dtgl = \$2::date/);
    expect(sql).toMatch(/COALESCE\(d\.sbatal,0\) = 0/);
    expect(sql).toContain("d.unit_id = $1");
    expect(params).toEqual([U, "2026-06-17"]);
  });

  it("getManualEntries: app.manual_entry, NOT void, section param, scoped", async () => {
    await getManualEntries(U, "2026-06-14", "pengeluaran");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("app.manual_entry");
    expect(sql).toContain("NOT void");
    expect(sql).toContain("unit_id = $1");
    expect(sql).toMatch(/section = \$3::app\.manual_entry_section/);
    expect(params).toEqual([U, "2026-06-14", "pengeluaran"]);
  });
});
