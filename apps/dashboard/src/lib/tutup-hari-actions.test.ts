import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope";

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
    /** Galat yang dilempar `bentukUlangHari` tiruan; `null` = berhasil. */
    galatBukuBesar: null as Error | null,
    /** Galat yang dilempar INSERT day_close tiruan; `null` = berhasil. */
    galatInsert: null as unknown,
    /** Master reason_code tiruan: kode → requires_target_date. */
    reason: { "CLS-ROUND": false, "CLS-INVESTIGATING": true } as Record<string, boolean>,
  };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("INSERT INTO app.day_close") && state.galatInsert) throw state.galatInsert;
      if (sql.includes("FROM app.reason_code")) {
        const req = state.reason[String(params[0])];
        return req === undefined ? { rows: [], rowCount: 0 } : { rows: [{ requires: req }], rowCount: 1 };
      }
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
vi.mock("./buku-besar-tulis", () => ({
  bentukUlangHari: vi.fn(async (_c: unknown, unit: number, tanggal: string) => {
    h.log.push({ sql: "-- bentukUlangHari", params: [unit, tanggal] });
    if (h.state.galatBukuBesar) throw h.state.galatBukuBesar;
    return { tanggal, mode: "langsung", backfill: false, ditulis: 3, dihapus: 0, tetap: 0, koreksi: null, temuan: [] };
  }),
}));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "keuangan",
    email: "staf@solagroup.co",
    units: [h.BK],
    requireUnit: () => h.BK,
  })),
}));

const { tutupHari, pastikanBarisDayClose } = await import("./tutup-hari-actions");

const upd = () => h.log.find((l) => l.sql.includes("UPDATE app.day_close"));
const masukan = { code: h.BK.code, date: "2026-11-03", reasonCode: null, targetDate: null, setujui: false };

beforeEach(() => {
  h.log.length = 0;
  h.state.status = "open";
  h.state.rinci = { penuh: 0, dinilai: 0, koreksiSusulan: 0 };
  h.state.galatBukuBesar = null;
  h.state.galatInsert = null;
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

describe("tutupHari — jurnal buku besar hari itu dibentuk ulang (K6 U8/U9; KTD3 pemicu 2)", () => {
  const idx = (pola: RegExp) => h.log.findIndex((l) => pola.test(l.sql));
  const audit = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log"));

  it("🔴 dibentuk SESUDAH day_close ditulis, di transaksi yang sama, sebelum COMMIT", async () => {
    const r = await tutupHari(masukan);
    expect(r).toEqual({ ok: true, tier: "within_tolerance" });
    const upd = idx(/UPDATE app\.day_close/);
    const bentuk = idx(/bentukUlangHari/);
    const commit = idx(/^COMMIT$/);
    expect(upd).toBeGreaterThan(-1);
    expect(bentuk).toBeGreaterThan(upd);
    expect(commit).toBeGreaterThan(bentuk);
    expect(h.log[bentuk]!.params).toEqual([h.BK.unit_id, masukan.date]);
    expect(audit().some((a) => String(a.params[2]).includes("gagal"))).toBe(false);
  });

  it("🔴 bentukUlangHari GAGAL ⇒ tutup hari TETAP berhasil; kerja buku besar digulung ke savepoint dan galatnya diaudit", async () => {
    h.state.galatBukuBesar = new Error("harga beli belum diisi");
    const r = await tutupHari(masukan);
    expect(r).toEqual({ ok: true, tier: "within_tolerance" });
    const sp = idx(/^SAVEPOINT /);
    const bentuk = idx(/bentukUlangHari/);
    const balik = idx(/^ROLLBACK TO SAVEPOINT /);
    const commit = idx(/^COMMIT$/);
    expect(sp).toBeGreaterThan(-1);
    expect(sp).toBeLessThan(bentuk);
    expect(balik).toBeGreaterThan(bentuk);
    expect(commit).toBeGreaterThan(balik);
    // Tidak ada ROLLBACK seluruh transaksi: penutupan hari tersimpan.
    expect(h.log.some((l) => l.sql === "ROLLBACK")).toBe(false);
    const gagal = audit().find((a) => a.params[2] === "buku_besar.bentuk_ulang_gagal");
    expect(gagal, "galat buku besar tercatat di audit_log").toBeDefined();
    expect(gagal!.params[3]).toBe(`${h.BK.unit_id}/${masukan.date}`);
    expect(JSON.parse(String(gagal!.params[4]))).toMatchObject({ galat: "harga beli belum diisi", pemicu: "tutup_hari" });
    // Audit ditulis SESUDAH savepoint digulung — kalau sebelum, ia ikut tergulung.
    expect(h.log.indexOf(gagal!)).toBeGreaterThan(balik);
  });

  it("pemeriksaan seimbang tunda dipaksa di dalam savepoint — jurnal tak seimbang tak menggagalkan COMMIT tutup hari", async () => {
    await tutupHari(masukan);
    const cek = idx(/^SET CONSTRAINTS .*jurnal_seimbang.* IMMEDIATE$/);
    expect(cek).toBeGreaterThan(idx(/bentukUlangHari/));
    expect(cek).toBeLessThan(idx(/^RELEASE SAVEPOINT /));
  });

  it("hari sebelum buku besar dimulai (1 Okt 2026) tidak dibentuk", async () => {
    const r = await tutupHari({ ...masukan, date: "2026-09-29" });
    expect(r.ok).toBe(true);
    expect(idx(/bentukUlangHari/)).toBe(-1);
  });

  it("tutup hari yang DITOLAK tidak membentuk buku besar", async () => {
    h.state.rinci = { penuh: null, dinilai: null, koreksiSusulan: null };
    await tutupHari(masukan);
    expect(idx(/bentukUlangHari/)).toBe(-1);
  });
});

/**
 * Perbaikan 2026-11-11 (0061) — hari berselisih bukan nol bisa DIBUAT barisnya
 * dan DITUTUP. Sebelumnya CHECK 0026 menolak baris `open` berselisih tanpa
 * alasan (23514), galatnya ditelan, dan `day_close` 0 baris di ketujuh unit.
 * Data SINTETIS — selisih −470 meniru bentuk kasus Bakau 22 Okt.
 */
describe("hari berselisih kecil: baris open lahir, lalu ditutup dengan CLS-ROUND (0061)", () => {
  const U = h.BK.unit_id as unknown as ScopedUnitId;
  const ins = () => h.log.find((l) => l.sql.includes("INSERT INTO app.day_close"));

  it("🔴 baris open berselisih −470 ditulis TANPA kode alasan, tier toleransi", async () => {
    const r = await pastikanBarisDayClose(U, "2026-10-22", -470, 0);
    expect(r).toEqual({ ok: true });
    const i = ins()!;
    expect(i.sql).toMatch(/'open'/);
    expect(i.sql).not.toMatch(/reason_code/);
    expect(i.params).toEqual([h.BK.unit_id, "2026-10-22", -470, "within_tolerance", 0]);
    expect(h.log.some((l) => l.sql === "COMMIT")).toBe(true);
  });

  it("🔴 tutupHari −470 + CLS-ROUND oleh Finance ⇒ ditutup, within_tolerance, kode tersimpan, tanpa persetujuan", async () => {
    h.state.rinci = { penuh: -470, dinilai: -470, koreksiSusulan: 0 };
    const r = await tutupHari({ ...masukan, date: "2026-10-22", reasonCode: "CLS-ROUND" });
    expect(r).toEqual({ ok: true, tier: "within_tolerance" });
    const u = upd()!;
    expect(u.sql).toMatch(/SET status='closed'/);
    expect(u.params[0]).toBe("within_tolerance");
    expect(u.params[1]).toBe("CLS-ROUND");
    expect(u.params[2]).toBe(false); // reason_requires_target
    expect(u.params[5]).toBeNull(); // approved_by
    expect(u.params[9]).toBe(-470); // difference_rp apa adanya, tidak dinolkan
  });

  it("🔴 selisih bukan nol TANPA kode alasan tetap DITOLAK — tak ada UPDATE", async () => {
    h.state.rinci = { penuh: -470, dinilai: -470, koreksiSusulan: 0 };
    const r = await tutupHari({ ...masukan, date: "2026-10-22", reasonCode: null });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.kurang).toContain("reason_code");
    expect(upd()).toBeUndefined();
    expect(h.log.some((l) => l.sql === "COMMIT")).toBe(false);
  });

  it("batas toleransi: |selisih| 10.000 masih within_tolerance; 10.001 sudah di luar wewenang Finance", async () => {
    h.state.rinci = { penuh: -10_000, dinilai: -10_000, koreksiSusulan: 0 };
    expect(await tutupHari({ ...masukan, reasonCode: "CLS-ROUND" })).toEqual({ ok: true, tier: "within_tolerance" });
    h.log.length = 0;
    h.state.rinci = { penuh: 10_001, dinilai: 10_001, koreksiSusulan: 0 };
    const r = await tutupHari({ ...masukan, reasonCode: "CLS-ROUND" });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.kurang).toContain("wewenang");
    expect(upd()).toBeUndefined();
  });

  it("kode alasan tak dikenal ⇒ ditolak", async () => {
    h.state.rinci = { penuh: -470, dinilai: -470, koreksiSusulan: 0 };
    const r = await tutupHari({ ...masukan, reasonCode: "CLS-NGAWUR" });
    expect(r).toEqual({ ok: false, error: "Kode alasan tak dikenal untuk penutupan hari." });
  });
});

describe("pastikanBarisDayClose — galat TIDAK ditelan (2026-11-11)", () => {
  const U = h.BK.unit_id as unknown as ScopedUnitId;
  const galatPg = (code: string, message: string) => Object.assign(new Error(message), { code });

  it("🔴 galat CHECK (23514) ⇒ dikembalikan dengan kode & pesan jelas, dicatat dengan unit/tanggal/kode, transaksi digulung", async () => {
    h.state.galatInsert = galatPg("23514", 'new row violates check constraint "day_close_reason_required"');
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await pastikanBarisDayClose(U, "2026-10-22", -470, 0);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.kode).toBe("23514");
      expect(r.pesan).toMatch(/gagal disimpan \(kode galat 23514\)/);
      expect(r.pesan).not.toMatch(/belum punya baris penilaian/);
      expect(h.log.some((l) => l.sql === "ROLLBACK")).toBe(true);
      expect(h.log.some((l) => l.sql === "COMMIT")).toBe(false);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![1]).toMatchObject({ unitId: h.BK.unit_id, date: "2026-10-22", kode: "23514" });
    } finally {
      log.mockRestore();
    }
  });

  it("galat tanpa kode SQLSTATE tetap dilaporkan (kode null), tidak dilempar", async () => {
    h.state.galatInsert = new Error("koneksi putus");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await pastikanBarisDayClose(U, "2026-10-22", 5, 0);
      expect(r).toMatchObject({ ok: false, kode: null });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("23505 (penyisipan bersamaan menang lebih dulu) ⇒ diabaikan dengan SENGAJA: barisnya ada", async () => {
    h.state.galatInsert = galatPg("23505", "duplicate key value violates unique constraint");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await pastikanBarisDayClose(U, "2026-10-22", -470, 0)).toEqual({ ok: true });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("langkah null ⇒ tak menyentuh DB sama sekali", async () => {
    h.connect.mockClear();
    expect(await pastikanBarisDayClose(U, "2026-10-22", null)).toEqual({ ok: true });
    expect(h.connect).not.toHaveBeenCalled();
  });
});
