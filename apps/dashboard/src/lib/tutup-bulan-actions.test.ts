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
  // Pembentukan ulang buku besar TIRUAN (K6 U11): mencatat hari yang dibentuk
  // ulang, mengembalikan temuan per hari, dan boleh "memperbaiki" jurnal
  // tersimpan (efek yang dibaca ulang sesudahnya).
  const bb = {
    hari: [] as string[],
    temuan: {} as Record<string, { kode: string; pesan: string; produk?: string }[]>,
    gagal: null as string | null,
    sesudah: null as (() => void) | null,
  };
  return { log, state, connect, BK, sesi, bb };
});

vi.mock("./buku-besar-tulis", () => ({
  bentukUlangHari: vi.fn(async (_c: unknown, _unit: number, tanggal: string) => {
    if (h.bb.gagal === tanggal) throw new Error(`Bentuk ulang ${tanggal} gagal (tiruan)`);
    h.bb.hari.push(tanggal);
    if (h.bb.hari.length === 1) h.bb.sesudah?.();
    return { tanggal, mode: "langsung", backfill: false, ditulis: 0, dihapus: 0, tetap: 0, koreksi: null, temuan: h.bb.temuan[tanggal] ?? [] };
  }),
}));

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
// Buku besar (K6 U11): status saldo awal, saldo pos, sub-pos bank, baris kliring.
let bbStatus: Record<string, unknown>[];
let saldoPos: Record<string, unknown>[];
let bankBb: Record<string, unknown>[];
let kliring: Record<string, unknown>[];
let memorialMenunggu = 0;

const db = (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes('AS "adaTutupBukuBesar"')) return { rows: bbStatus };
  if (sql.includes("WITH gerak AS")) return { rows: saldoPos };
  if (sql.includes("FROM app.pos_unit u")) return { rows: bankBb };
  if (sql.includes("b.pos_kode = ANY($3::text[])")) return { rows: kliring };
  if (sql.includes("AS n FROM app.jurnal")) return { rows: [{ n: memorialMenunggu }] };
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
  memorialMenunggu = 0;
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
  bbStatus = [];
  saldoPos = [];
  bankBb = [];
  kliring = [];
  h.bb.hari.length = 0;
  h.bb.temuan = {};
  h.bb.gagal = null;
  h.bb.sesudah = null;
});

const BRI = "22222222-2222-4222-8222-222222222222";
/** Buku besar AKTIF & bersih: saldo awal seimbang, BRI = rekening koran, kliring nol. */
function bukuBesarBersih() {
  bbStatus = [{ jumlahBaris: 2, totalSaldoAwal: "0", adaTutupBukuBesar: false }];
  saldoPos = [
    { posKode: "1111", saldo: "5000000000" },
    { posKode: "3100", saldo: "-5000000000" },
  ];
  bankBb = [{ posKode: "1111", accountId: BRI, nama: "Bank BRI - 0011223344", saldoRekeningKoran: "50000000.00" }];
}
const pesan = (r: Awaited<ReturnType<typeof tutupBulan>>) => (r.ok ? "" : r.error);

describe("tutupBulan — HoF, di bawah kunci, idempoten", () => {
  it("🔴 semua syarat terpenuhi ⇒ baris tutup_bulan + audit tutup_bulan.tutup + COMMIT", async () => {
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: true, sudahDitutup: false });
    expect(ins()).toHaveLength(1);
    // Saldo awal pos belum ada ⇒ pemeriksaan buku besar tak aktif ⇒ tutup K5, buku_besar false.
    expect(ins()[0]!.params).toEqual([h.BK.unit_id, "2026-10-01", 7, false]);
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
    expect(await tutupBulan(masukan)).toMatchObject({ ok: false, error: expect.stringMatching(/rekening bank belum punya rekening koran aktif/) });
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

describe("tutupBulan — pemeriksaan buku besar (K6 U11, R33)", () => {
  it("🔴 bulan tanpa saldo awal lengkap ⇒ cek dilewati, tutup menurut K5, buku_besar false, TANPA pembentukan ulang", async () => {
    bbStatus = [{ jumlahBaris: 0, totalSaldoAwal: "0", adaTutupBukuBesar: false }];
    saldoPos = [{ posKode: "1198", saldo: "10000000" }];
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: true, sudahDitutup: false });
    expect(ins()[0]!.params[3]).toBe(false);
    expect(h.bb.hari).toEqual([]);
  });

  it("🔴 aktif & bersih ⇒ jurnal SETIAP hari dibentuk ulang berurutan, lalu tutup dengan buku_besar = true", async () => {
    bukuBesarBersih();
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: true, sudahDitutup: false });
    expect(h.bb.hari).toEqual(hariDalamBulan("2026-10"));
    expect(ins()).toHaveLength(1);
    expect(ins()[0]!.params).toEqual([h.BK.unit_id, "2026-10-01", 7, true]);
    expect(committed()).toBe(true);
  });

  it("🔴 memorial menunggu di bulan berbuku besar ⇒ menolak, tanpa INSERT", async () => {
    bukuBesarBersih();
    memorialMenunggu = 2;
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(pesan(r)).toMatch(/2 jurnal memorial/);
    expect(ins()).toHaveLength(0);
    expect(committed()).toBe(false);
  });

  it("🔴 vonis membaca jurnal SESUDAH pembentukan ulang, bukan yang tersimpan sebelumnya", async () => {
    bukuBesarBersih();
    const bersih = saldoPos;
    saldoPos = [...bersih, { posKode: "1198", saldo: "10000000" }, { posKode: "1101", saldo: "-10000000" }];
    h.bb.sesudah = () => {
      saldoPos = bersih;
    };
    expect(await tutupBulan(masukan)).toMatchObject({ ok: true, sudahDitutup: false });
    expect(ins()[0]!.params[3]).toBe(true);
  });

  it("🔴 Covers AE9: BRI buku besar Rp 50.000.000 vs rekening koran Rp 50.250.000 ⇒ menolak, tanpa INSERT", async () => {
    bukuBesarBersih();
    bankBb = [{ ...bankBb[0], saldoRekeningKoran: "50250000.00" }];
    const r = await tutupBulan(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(pesan(r)).toMatch(/Bank BRI - 0011223344/);
    expect(ins()).toHaveLength(0);
    expect(committed()).toBe(false);
  });

  it("🔴 1198 ≠ 0 sesudah pembentukan ulang ⇒ menolak", async () => {
    bukuBesarBersih();
    saldoPos = [...saldoPos, { posKode: "1198", saldo: "2500000" }, { posKode: "1101", saldo: "-2500000" }];
    const r = await tutupBulan(masukan);
    expect(pesan(r)).toMatch(/1198/);
    expect(ins()).toHaveLength(0);
  });

  it("🔴 1190 bersisa butir dalam perjalanan 2 hari ⇒ lolos; sisa tanpa pasangan ⇒ menolak", async () => {
    bukuBesarBersih();
    saldoPos = [
      { posKode: "1101", saldo: "-500000000" },
      { posKode: "1111", saldo: "5000000000" },
      { posKode: "1190", saldo: "500000000" },
      { posKode: "3100", saldo: "-5000000000" },
    ];
    kliring = [
      { jurnalId: "j1", posKode: "1190", tanggalEfektif: "2026-10-31", keterangan: "Setoran ke Bank", net: "500000000" },
      { jurnalId: "j2", posKode: "1190", tanggalEfektif: "2026-11-02", keterangan: "Pindah Buku", net: "-500000000" },
    ];
    expect(await tutupBulan(masukan)).toMatchObject({ ok: true, sudahDitutup: false });
    kliring = [kliring[0]!];
    h.log.length = 0;
    const r = await tutupBulan(masukan);
    expect(pesan(r)).toMatch(/1190/);
    expect(ins()).toHaveLength(0);
  });

  it("🔴 R11: temuan 'harga beli belum diisi' dari pembentukan ulang ⇒ menolak, produk & tanggal disebut", async () => {
    bukuBesarBersih();
    h.bb.temuan["2026-10-14"] = [
      { kode: "harga_beli_kosong", pesan: "Harga beli PERTALITE belum diisi untuk 2026-10-14", produk: "PERTALITE" },
      { kode: "losses_gain_kosong", pesan: "tak terhitung", produk: "PERTALITE" },
    ];
    const r = await tutupBulan(masukan);
    expect(pesan(r)).toMatch(/Harga beli belum diisi: PERTALITE 2026-10-14/);
    expect(ins()).toHaveLength(0);
  });

  it("neraca tidak seimbang ⇒ menolak", async () => {
    bukuBesarBersih();
    saldoPos = [
      { posKode: "1111", saldo: "5000000000" },
      { posKode: "3100", saldo: "-4900000000" },
    ];
    expect(pesan(await tutupBulan(masukan))).toMatch(/Neraca saldo buku besar tidak seimbang/);
    expect(ins()).toHaveLength(0);
  });

  it("syarat K5 gagal ⇒ menolak TANPA membentuk ulang jurnal", async () => {
    bukuBesarBersih();
    hari = hariDalamBulan("2026-10").slice(1);
    expect(await tutupBulan(masukan)).toMatchObject({ ok: false, error: expect.stringMatching(/1 hari/) });
    expect(h.bb.hari).toEqual([]);
  });

  it("pembentukan ulang gagal di tengah ⇒ tutup gagal, tanpa INSERT, tanpa COMMIT", async () => {
    bukuBesarBersih();
    h.bb.gagal = "2026-10-20";
    const r = await tutupBulan(masukan);
    expect(pesan(r)).toMatch(/2026-10-20/);
    expect(ins()).toHaveLength(0);
    expect(committed()).toBe(false);
  });
});
