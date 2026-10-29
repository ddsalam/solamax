import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aksi tutup bulan (rencana 2026-10-29 U12; R25, AE5; KTD14) dengan DB TIRUAN —
 * pola `impor-bank-actions.test.ts`. Kueri bahan ASLI (`bacaBahanTutupBulan`)
 * dijalankan terhadap klien tiruan yang menjawab menurut teks SQL-nya, dan
 * vonis ASLI (`periksaTutupBulan`). Data SINTETIS.
 *
 * ⚠️ Batas: SQL tidak dijalankan. PRIMARY KEY, CHECK hari pertama, REVOKE
 * UPDATE/DELETE, dan RLS 0054 hanya dibuktikan terhadap DB hidup
 * (`tutup-bulan.integration.test.ts`, ber-gerbang env — belum dijalankan).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string, params: unknown[]) => Jawab } = { jawab: () => undefined };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  const sesi = { role: "admin_perusahaan", email: "hof@solagroup.co" as string | null, units: [BK] };
  return { log, state, connect, BK, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
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

const { tutupBulan } = await import("./tutup-bulan-actions");
const { hariDalamBulan } = await import("./tutup-bulan-model");

const BCA = "11111111-1111-4111-8111-111111111111";
const G = "99999999-9999-4999-8999-999999999999";

let sudahDitutup: boolean;
let hari: string[];
let parkir: Record<string, unknown>[];
let rekening: Record<string, unknown>[];
let impor: Record<string, unknown>[];
let buku: Record<string, unknown>[];

const db = (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.tutup_bulan")) return { rows: sudahDitutup ? [{ ada: 1 }] : [] };
  if (sql.includes("INSERT INTO app.tutup_bulan")) return { rows: [], rowCount: 1 };
  if (sql.includes("FROM app.day_close")) return { rows: hari.map((d) => ({ d })) };
  if (sql.includes("l.parkir_sumber_id IS NULL")) return { rows: parkir };
  if (sql.includes('AS "rekeningKoranAktif"')) return { rows: rekening };
  if (sql.includes("m.rk_status = 'aktif'")) return { rows: impor };
  if (sql.includes("WITH rek AS")) return { rows: buku };
  return undefined;
};

const masukan = { code: h.BK.code, bulan: "2026-10" };
const idx = (frag: string) => h.log.findIndex((l) => l.sql.includes(frag));
const ins = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.tutup_bulan"));
const committed = () => h.log.some((l) => l.sql.trim() === "COMMIT");

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.state.jawab = db;
  h.sesi.role = "admin_perusahaan";
  h.sesi.email = "hof@solagroup.co";
  sudahDitutup = false;
  hari = hariDalamBulan("2026-10");
  parkir = [];
  rekening = [{ id: BCA, nama: "Bank BCA - 1234567890", cutOver: "2026-10-01", rekeningKoranAktif: true }];
  impor = [{ id: "m1", accountId: BCA, tanggalBank: "2026-10-05", praCutover: false, dicocokkan: true }];
  buku = [];
});

describe("tutupBulan — HoF, di bawah kunci, idempoten", () => {
  it("🔴 semua syarat terpenuhi ⇒ baris tutup_bulan + audit tutup_bulan.tutup + COMMIT", async () => {
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: true, sudahDitutup: false });
    expect(ins()).toHaveLength(1);
    expect(ins()[0]!.params).toEqual([h.BK.unit_id, "2026-10-01", 7]);
    const a = h.log.find((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(a?.params[2]).toBe("tutup_bulan.tutup");
    expect(a?.params[3]).toBe(`${h.BK.code}/2026-10`);
    expect(committed()).toBe(true);
  });

  it("🔴 URUTAN: RLS → kunci eksklusif bulan → kunci baris → baca ULANG masukan → tulis", async () => {
    await tutupBulan(masukan);
    const rls = idx("set_config('app.unit_ids'");
    const kunci = idx("pg_advisory_xact_lock(hashtextextended('tutup-bulan:'");
    const baris = h.log.findIndex((l) => l.sql.includes("FROM app.tutup_bulan") && l.sql.includes("FOR UPDATE"));
    const baca = idx("FROM app.day_close");
    const tulis = idx("INSERT INTO app.tutup_bulan");
    expect(rls).toBeGreaterThanOrEqual(0);
    expect(rls).toBeLessThan(kunci);
    expect(kunci).toBeLessThan(baris);
    expect(baris).toBeLessThan(baca);
    expect(baca).toBeLessThan(tulis);
    expect(h.log[kunci]!.params).toEqual([h.BK.unit_id, "2026-10"]);
    // Kelima bacaan bahan lewat klien TRANSAKSI yang memegang kunci, bukan qScoped.
    for (const f of ["FROM app.day_close", "l.parkir_sumber_id IS NULL", '"rekeningKoranAktif"', "m.rk_status", "WITH rek AS"]) {
      expect(idx(f), f).toBeGreaterThan(kunci);
    }
  });

  it("🔴 ulangi ⇒ idempoten: 'sudah ditutup', tanpa INSERT, tanpa membaca syarat", async () => {
    sudahDitutup = true;
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: true, sudahDitutup: true });
    expect(ins()).toHaveLength(0);
    expect(committed()).toBe(false);
    expect(idx("FROM app.day_close")).toBe(-1);
  });

  it("🔴 Keuangan non-HoF ⇒ ditolak tanpa koneksi", async () => {
    h.sesi.role = "keuangan";
    h.sesi.email = "staf@solagroup.co";
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Head of Finance/) });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("super admin boleh", async () => {
    h.sesi.role = "super_admin";
    h.sesi.email = "root@solagroup.co";
    expect(await tutupBulan(masukan)).toMatchObject({ ok: true, sudahDitutup: false });
  });

  it("🔴 AE5: Rp 500 jt diparkir 15 Okt ⇒ ditolak dengan alasan penampung; tanpa INSERT", async () => {
    parkir = [
      {
        id: "p1",
        accountId: BCA,
        tanggalBank: "2026-10-15",
        businessDate: "2026-10-15",
        amount: "-500000000.00",
        keterangan: "Diparkir — DB tanpa keterangan",
        sudahDipindah: false,
        alasanMaju: null,
        lahirDariCocokId: G,
        rekening: "Bank BCA - 1234567890",
      },
    ];
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.alasan).toEqual([expect.stringMatching(/Penampung belum nol: 1 baris/)]);
    expect(ins()).toHaveLength(0);
    expect(committed()).toBe(false);
  });

  it("satu hari belum tertutup / rekening koran belum diimpor / baris buku manual ⇒ ditolak", async () => {
    hari = hariDalamBulan("2026-10").slice(1);
    expect(await tutupBulan(masukan)).toMatchObject({ ok: false, error: expect.stringMatching(/1 hari/) });
    hari = hariDalamBulan("2026-10");
    rekening = [{ ...rekening[0], rekeningKoranAktif: false }];
    expect(await tutupBulan(masukan)).toMatchObject({ ok: false, error: expect.stringMatching(/rekening BCA belum diimpor/) });
    rekening = [{ ...rekening[0], rekeningKoranAktif: true }];
    buku = [
      {
        id: "k1", accountId: BCA, businessDate: "2026-10-10", tanggalAsal: null, amount: "-75000.00", void: false,
        saldoAwal: false, dicocokkan: false, alasanMaju: null, lahirDariCocokId: null, pasanganUuid: null,
        keterangan: "Biaya admin manual", categoryLabel: "Biaya Operasional",
      },
    ];
    expect(await tutupBulan(masukan)).toMatchObject({ ok: false, error: expect.stringMatching(/1 baris buku tanpa pasangan/) });
    expect(ins()).toHaveLength(0);
  });

  it("baris parkir yang sudah dipindahkan + semua syarat lain ⇒ tutup lolos", async () => {
    parkir = [
      {
        id: "p1", accountId: BCA, tanggalBank: "2026-10-15", businessDate: "2026-10-15", amount: "-500000000.00",
        keterangan: "x", sudahDipindah: true, alasanMaju: null, lahirDariCocokId: G, rekening: "Bank BCA",
      },
    ];
    expect(await tutupBulan(masukan)).toMatchObject({ ok: true, sudahDitutup: false });
  });

  it("bulan tak sah ⇒ ditolak tanpa koneksi", async () => {
    expect(await tutupBulan({ ...masukan, bulan: "2026-13" })).toMatchObject({ ok: false });
    expect(await tutupBulan({ ...masukan, bulan: "2026-10-01" })).toMatchObject({ ok: false });
    expect(h.connect).not.toHaveBeenCalled();
  });
});
