import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `tutupHari` dengan DB TIRUAN (rencana 2026-10-29 U12; R24, R32; AE5, AE13;
 * KTD15). Rincian langkah DITIRU — yang diuji adalah apa yang aksi lakukan
 * dengannya: selisih yang DINILAI menentukan tier, koreksi susulan disimpan di
 * sampingnya. Data SINTETIS.
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  const log: { sql: string; params: unknown[] }[] = [];
  const state = {
    rinci: { penuh: 0 as number | null, dinilai: 0 as number | null, koreksiSusulan: 0 as number | null },
    status: "open" as string | null,
  };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("FROM app.day_close")) return { rows: state.status ? [{ status: state.status }] : [], rowCount: 1 };
      if (sql.includes("UPDATE app.day_close")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  return { log, state, connect, BK };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./hari-buku-queries", () => ({ kunciHariEksklusif: vi.fn(async () => {}) }));
vi.mock("./keuangan-laporan-queries", () => ({ hitungLangkahHarianRinci: vi.fn(async () => h.state.rinci) }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "keuangan",
    email: "staf@solagroup.co",
    units: [h.BK],
    requireUnit: () => h.BK,
  })),
}));

const { tutupHari } = await import("./tutup-hari-actions");

const upd = () => h.log.find((l) => l.sql.includes("UPDATE app.day_close"));
const masukan = { code: h.BK.code, date: "2026-11-03", reasonCode: null, targetDate: null, setujui: false };

beforeEach(() => {
  h.log.length = 0;
  h.state.status = "open";
  h.state.rinci = { penuh: 0, dinilai: 0, koreksiSusulan: 0 };
});

describe("tutupHari — koreksi susulan dipisah dari selisih yang dinilai (KTD15)", () => {
  it("🔴 AE13: koreksi susulan Rp 160 jt & dinilai 0 ⇒ tier toleransi, tanpa override; day_close menyimpan koreksinya", async () => {
    h.state.rinci = { penuh: 160_000_000, dinilai: 0, koreksiSusulan: 160_000_000 };
    // Staf Keuangan, tanpa kode alasan dan tanpa persetujuan.
    const r = await tutupHari(masukan);
    expect(r).toEqual({ ok: true, tier: "within_tolerance" });
    const u = upd()!;
    expect(u.sql).toMatch(/difference_rp=\$10, koreksi_susulan_rp=\$11/);
    expect(u.params[0]).toBe("within_tolerance");
    expect(u.params[5]).toBeNull(); // approved_by
    expect(u.params[6]).toBeNull(); // approved_at
    expect(u.params[9]).toBe(0); // difference_rp = dinilai
    expect(u.params[10]).toBe(160_000_000); // koreksi_susulan_rp
  });

  it("🔴 DAYA-BEDA: selisih ASLI hari itu tidak tersembunyi di koreksi — dinilai 160 jt ⇒ butuh override Direksi", async () => {
    h.state.rinci = { penuh: 160_000_000, dinilai: 160_000_000, koreksiSusulan: 0 };
    const r = await tutupHari({ ...masukan, reasonCode: null });
    expect(r.ok).toBe(false);
    expect(upd()).toBeUndefined();
  });

  it("dinilai tak terhitung ⇒ ditolak, tidak dinolkan", async () => {
    h.state.rinci = { penuh: null, dinilai: null, koreksiSusulan: null };
    expect((await tutupHari(masukan)).ok).toBe(false);
    expect(upd()).toBeUndefined();
  });

  it("R24/AE5: tutup hari 15 Okt dengan baris parkir di penampung ⇒ BOLEH — penampung tak dibaca gerbang hari", async () => {
    const r = await tutupHari({ ...masukan, date: "2026-10-15" });
    expect(r).toEqual({ ok: true, tier: "within_tolerance" });
    expect(h.log.some((l) => /Mutasi Belum Teridentifikasi|parkir_sumber_id|tutup_bulan/.test(l.sql))).toBe(false);
  });
});
