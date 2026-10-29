import { beforeEach, describe, expect, it, vi } from "vitest";
import { kumpulkanBeban, pilahManualEntry, totalBeban, type BarisManualLaporan } from "./keuangan-beban";
import { sisiKasNeraca, type MutasiSisiKas } from "./keuangan-sisi-kas";

/**
 * Klasifikasi baris rekening koran (rencana 2026-10-29 U11; R9, R11, R21, R23,
 * R27, R28, R30; AE5, AE9; KTD5, KTD6, KTD8) dengan DB TIRUAN — pola
 * `cocok-bank-actions.test.ts`. Klien tiruan mencatat setiap pernyataan, jadi
 * "ditolak" dibuktikan sebagai "tak ada koneksi / tak ada INSERT / tak ada
 * COMMIT". Akibat ke laporan dibuktikan lewat MODEL LAPORAN YANG SAMA dengan
 * produksi (`sisiKasNeraca`, `pilahManualEntry` → `kumpulkanBeban`) atas baris
 * yang benar-benar ditulis aksi. Data SINTETIS.
 *
 * ⚠️ Batas: SQL tidak dijalankan. FK komposit, partial unique 0052/0053, dan
 * trigger hari tertutup dibuktikan oleh uji DB-live ber-gerbang env (belum
 * dijalankan di sini).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: {
    jawab: (sql: string, params: unknown[]) => Jawab;
    hari: (unitId: number, tanggal: string) => unknown;
    n: number;
  } = { jawab: () => undefined, hari: () => undefined, n: 0 };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("INSERT INTO app.cash_ledger") && sql.includes("RETURNING")) return { rows: [{ id: `kas-${++state.n}` }], rowCount: 1 };
      if (sql.includes("INSERT INTO app.manual_entry")) return { rows: [{ id: `beban-${++state.n}` }], rowCount: 1 };
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const hariBukuTerkunci = vi.fn(async (_c: unknown, unitId: number, tanggal: string) => state.hari(unitId, tanggal));
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  const BL = { unit_id: 3, code: "6478302", name: "Batu Layang" };
  const sesi = {
    role: "keuangan",
    email: "staf@solagroup.co" as string | null,
    units: [BK] as { unit_id: number; code: string; name: string }[],
  };
  return { log, state, connect, hariBukuTerkunci, BK, BL, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
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

const { klasifikasiAntarUnit, klasifikasiKategori, klasifikasiParkir, klasifikasiPecah, pindahkanDariPenampung } = await import(
  "./klasifikasi-actions"
);
const { simpanPenebusan } = await import("./penebusan-actions");

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AKUN = uid(101);
const AKUN_BL = uid(102);
const RK = uid(201);
const G = uid(900);
const LINE = uid(1);
const PL_KREDITUR = uid(301);
const PL_BK_BL = uid(302);
const PL_BL_BK = uid(303);

const KATEGORI = new Set([
  "debet|Transfer Pembayaran Piutang Pelanggan",
  "debet|Mutasi Belum Teridentifikasi",
  "kredit|Mutasi Belum Teridentifikasi",
  "kredit|Biaya Operasional",
  "kredit|Hutang Piutang",
  "debet|Hutang Piutang",
  "debet|Pendapatan Lain-Lain",
]);

let baris: Record<string, unknown>;
let parkir: Record<string, unknown> | null;

const mutasi = (over: Record<string, unknown> = {}) => ({
  id: LINE,
  accountId: AKUN,
  tanggalBank: "2026-10-02",
  keterangan: "TRSF E-BANKING CR | PELANGGAN CONTOH",
  amount: "160000000.00",
  so: null,
  dokRef: null,
  praCutover: false,
  rkStatus: "aktif",
  rekeningKoranId: RK,
  dicocokkan: false,
  ...over,
});

const db = (sql: string, p: unknown[]): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("m.id = ANY($2::uuid[])")) return { rows: (p[1] as string[]).includes(String(baris.id)) ? [baris] : [] };
  if (sql.includes("FROM app.rekening_koran")) return { rows: [{ id: RK }] };
  if (sql.includes("FROM app.cash_mutation_category")) return { rows: KATEGORI.has(`${p[0]}|${p[1]}`) ? [{ ada: true }] : [] };
  if (sql.includes("jenis = 'unit' AND lawan_unit_id")) {
    return { rows: [{ id: p[0] === h.BK.unit_id ? PL_BK_BL : PL_BL_BK, nama: "unit", jenis: "unit", aktif: true }] };
  }
  if (sql.includes("FROM app.pihak_lawan\n")) {
    if (p[0] === PL_KREDITUR) return { rows: [{ id: PL_KREDITUR, nama: "BPR Contoh", jenis: "kreditur", aktif: true, lawanUnitId: null }] };
    return { rows: [] };
  }
  if (sql.includes("FROM app.cash_account")) {
    return { rows: [{ id: p[0], nama: "Bank BCA - 1", kind: "bank", active: true }] };
  }
  if (sql.includes("INSERT INTO app.cocok_bank (")) return { rows: [{ id: G }] };
  if (sql.includes("FROM app.category_account_map")) return { rows: [{ account: "Beban Administrasi Bank" }] };
  if (sql.includes("WHERE l.id = $1::uuid AND l.unit_id = $2 AND NOT l.void")) return { rows: parkir ? [parkir] : [] };
  if (sql.includes("FROM app.cocok_bank WHERE id = $1::uuid")) return { rows: [{ aktif: true }] };
  if (sql.includes("FROM app.penebusan")) return { rows: [] };
  return undefined;
};

const ins = (tabel: string) => h.log.filter((l) => new RegExp(`INSERT INTO ${tabel}\\s*\\(`).test(l.sql));
const auditAksi = () => h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log")).map((l) => ({ aksi: l.params[2], aktor: l.params[0] }));
const committed = () => h.log.some((l) => l.sql.trim() === "COMMIT");
const terbuka = (_u: number, t: string) => ({ status: "dibukukan", hariBuku: t, terdorongMaju: false, perluKodeAlasan: false });

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.hariBukuTerkunci.mockClear();
  h.state.jawab = db;
  h.state.hari = terbuka;
  h.state.n = 0;
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
  h.sesi.units = [h.BK];
  baris = mutasi();
  parkir = null;
});

/** Baris kas yang ditulis aksi → bentuk `MutasiSisiKas` untuk model laporan. */
function kasTertulis(): MutasiSisiKas[] {
  return ins("app.cash_ledger").map((l) => ({
    accountId: String(l.params[1]),
    businessDate: String(l.params[2]),
    jenis: l.params[4] as "debet" | "kredit",
    categorySide: l.params[5] as "debet" | "kredit",
    categoryLabel: String(l.params[6]),
    amount: Number(l.params[7]),
    saldoAwal: false,
    void: false,
    pihakLawanId: (l.params[9] as string | null) ?? null,
    tanggalAsal: (l.params[10] as string | null) ?? null,
  }));
}
const buka: MutasiSisiKas = {
  accountId: AKUN,
  businessDate: "2026-10-01",
  jenis: "adjustment",
  categorySide: null,
  categoryLabel: null,
  amount: 1_000_000_000,
  saldoAwal: true,
  void: false,
};
const neraca = (mutasi: MutasiSisiKas[], date: string) =>
  sisiKasNeraca({
    mutasi,
    date,
    adaAkun: true,
    kasTerhitung: true,
    pihakLawan: [{ id: PL_KREDITUR, jenis: "kreditur", saldoAwal: null }],
    titipanDiterima: null,
  });
const asetKas = (s: ReturnType<typeof sisiKasNeraca>) =>
  s.kasAkhir! + s.hutangPiutangNonEasymax! + s.penampung! + s.temporaryInvestment! - s.saldoTitipanBright;

// ---------------------------------------------------------------------------
// AE9 — hari tertutup ⇒ dibukukan maju dari tanggal bank
// ---------------------------------------------------------------------------

describe("klasifikasiKategori — Covers AE9 (R28, KTD5)", () => {
  it("🔴 Oktober tertutup, transfer pelanggan bertanggal bank 2 Okt diklasifikasi 5 Nov ⇒ baris kas 3 Nov, tanggal asal 2 Okt, ADJ-FWD-IMPORT, kelompok aktif", async () => {
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-11-03", terdorongMaju: true, perluKodeAlasan: true });
    const r = await klasifikasiKategori({ code: h.BK.code, mutasiId: LINE, categoryLabel: "Transfer Pembayaran Piutang Pelanggan" });
    expect(r).toMatchObject({ ok: true, cocokId: G });
    // Hari buku dicari dari TANGGAL BANK, di rekening baris impor.
    expect(h.hariBukuTerkunci).toHaveBeenCalledWith(expect.anything(), h.BK.unit_id, "2026-10-02", { accountId: AKUN });
    const [k] = ins("app.cash_ledger");
    expect(k!.params.slice(0, 3)).toEqual([h.BK.unit_id, AKUN, "2026-11-03"]);
    expect(k!.params.slice(4, 8)).toEqual(["debet", "debet", "Transfer Pembayaran Piutang Pelanggan", "160000000.00"]);
    expect(k!.params.slice(10, 15)).toEqual(["2026-10-02", "ADJ-FWD-IMPORT", "adjustment", G, null]);
    // Kelompok aktif: kepala, lalu baris impor ↔ baris kas lahiran.
    expect(ins("app.cocok_bank")[0]!.params).toEqual([h.BK.unit_id, "manual", 7]);
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [LINE, null], [null, "kas-1"]]);
    // Bukan beban ⇒ tak ada manual_entry; hari tertutup tak disunting.
    expect(ins("app.manual_entry")).toHaveLength(0);
    expect(h.log.some((l) => /UPDATE app\.(cash_ledger|day_close)/.test(l.sql))).toBe(false);
    expect(committed()).toBe(true);
  });

  it("baris sudah diselesaikan / ditarik / pra-cut-over ⇒ ditolak, tanpa kelompok & tanpa COMMIT", async () => {
    for (const over of [{ dicocokkan: true }, { rkStatus: "ditarik" }, { praCutover: true }]) {
      h.log.length = 0;
      baris = mutasi(over);
      const r = await klasifikasiKategori({ code: h.BK.code, mutasiId: LINE, categoryLabel: "Transfer Pembayaran Piutang Pelanggan" });
      expect(r.ok, JSON.stringify(over)).toBe(false);
      expect(ins("app.cocok_bank")).toHaveLength(0);
      expect(committed()).toBe(false);
    }
  });

  it("kategori yang tak sesisi dengan mutasi ⇒ ditolak di transaksi, tak ada baris kas", async () => {
    const r = await klasifikasiKategori({ code: h.BK.code, mutasiId: LINE, categoryLabel: "Biaya Operasional", operationalCategory: "Biaya Admin" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/tidak ada di sisi debet/) });
    expect(ins("app.cash_ledger")).toHaveLength(0);
    expect(committed()).toBe(false);
  });

  it("🔴 pengawas & HoF tidak boleh mengklasifikasi — tanpa koneksi", async () => {
    for (const [role, email] of [
      ["pengawas", "p@solagroup.co"],
      ["admin_perusahaan", "hof@solagroup.co"],
    ] as const) {
      h.sesi.role = role;
      h.sesi.email = email;
      expect((await klasifikasiKategori({ code: h.BK.code, mutasiId: LINE, categoryLabel: "Transfer Pembayaran Piutang Pelanggan" })).ok).toBe(false);
    }
    expect(h.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Beban ⇒ laba berkurang (temuan U6)
// ---------------------------------------------------------------------------

describe("klasifikasiKategori — beban ⇒ laba hari buku berkurang lewat model laporan yang sama", () => {
  beforeEach(() => {
    baris = mutasi({ amount: "-75000.00", keterangan: "BIAYA ADM" });
  });

  it("🔴 Biaya Operasional ⇒ baris kas −75.000 + manual_entry pintu Finance (pengeluaran 75.000) bertaut; laba turun 75.000; asset kas bersih turun sama", async () => {
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-11-03", terdorongMaju: true, perluKodeAlasan: true });
    const r = await klasifikasiKategori({
      code: h.BK.code,
      mutasiId: LINE,
      categoryLabel: "Biaya Operasional",
      operationalCategory: "Biaya Admin",
    });
    expect(r.ok).toBe(true);
    const [b] = ins("app.manual_entry");
    expect(b!.sql).toMatch(/'submitted', 'finance'/);
    // [unit, HARI BUKU, seksi, keterangan, nominal positif, kategori op, CoA, aktor, baris kas]
    expect(b!.params).toEqual([h.BK.unit_id, "2026-11-03", "pengeluaran", "BIAYA ADM", "75000.00", "Biaya Admin", "Beban Administrasi Bank", 7, "kas-1"]);

    // Laba hari buku lewat pemilah & pengumpul beban produksi.
    const me: BarisManualLaporan[] = [
      {
        businessDate: String(b!.params[1]),
        accountingAccount: String(b!.params[6]),
        amountRp: Number(b!.params[4]),
        keterangan: String(b!.params[3]),
        void: false,
        section: String(b!.params[2]),
        operationalCategory: String(b!.params[5]),
      },
    ];
    const { manualBeban, pendapatanLain } = pilahManualEntry(me);
    const beban = totalBeban(kumpulkanBeban({ manual_entry: manualBeban, noncash_expense: [] }, "2026-11-03", "2026-11-03"));
    expect(beban).toBe(75_000);
    expect(pendapatanLain).toBe(0);
    // Kas turun 75.000 dan TIDAK ada term neraca lain yang mengimbanginya —
    // pengimbangnya laba (−75.000). Langkah harian = Δasset − Δlaba = 0.
    const sebelum = asetKas(neraca([buka], "2026-11-03"));
    const sesudah = asetKas(neraca([buka, ...kasTertulis()], "2026-11-03"));
    expect(sesudah - sebelum).toBe(-beban);
  });

  it("🔴 beban tanpa kategori operasional ⇒ ditolak SEBELUM koneksi", async () => {
    const r = await klasifikasiKategori({ code: h.BK.code, mutasiId: LINE, categoryLabel: "Biaya Operasional" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/kategori operasional/) });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AE5 — parkir; pindah ke kreditur
// ---------------------------------------------------------------------------

describe("klasifikasiParkir & pindahkanDariPenampung — Covers AE5 (R23, KTD8)", () => {
  beforeEach(() => {
    baris = mutasi({ amount: "-500000000.00", keterangan: "TRSF E-BANKING DB", tanggalBank: "2026-10-15" });
  });

  it("🔴 AE5: parkir debit 500 jt ⇒ baris kas penampung −500 jt (saldo bank = rekening koran), langkah harian sisi kas 0", async () => {
    const r = await klasifikasiParkir({ code: h.BK.code, mutasiId: LINE });
    expect(r.ok).toBe(true);
    const kas = kasTertulis();
    expect(kas).toHaveLength(1);
    expect(kas[0]).toMatchObject({ businessDate: "2026-10-15", categoryLabel: "Mutasi Belum Teridentifikasi", amount: -500_000_000 });
    const s = neraca([buka, ...kas], "2026-10-15");
    // Saldo bank turun persis sebesar mutasi rekening koran…
    expect(s.kasAkhir).toBe(1_000_000_000 - 500_000_000);
    // …dan penampung mengimbanginya: asset bersih sisi kas tak bergerak.
    expect(s.penampung).toBe(500_000_000);
    expect(asetKas(s)).toBe(asetKas(neraca([buka], "2026-10-15")));
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [LINE, null], [null, "kas-1"]]);
    expect(auditAksi()).toEqual([{ aksi: "klasifikasi.parkir", aktor: 7 }]);
  });

  it("🔴 pindah baris parkir ke kreditur ⇒ penampung 0, saldo kreditur naik, baris parkir tak disunting, kedua baris baru masuk kelompok parkir", async () => {
    const PARKIR = uid(50);
    parkir = {
      id: PARKIR,
      accountId: AKUN,
      businessDate: "2026-10-15",
      amount: "-500000000.00",
      keterangan: "Diparkir — TRSF E-BANKING DB",
      categoryLabel: "Mutasi Belum Teridentifikasi",
      cocokId: G,
      sudahDipindah: false,
    };
    const r = await pindahkanDariPenampung({
      code: h.BK.code,
      parkirId: PARKIR,
      tanggal: "2026-10-20",
      categoryLabel: "Hutang Piutang",
      pihakLawanId: PL_KREDITUR,
    });
    expect(r).toMatchObject({ ok: true, cocokId: G });
    const [pembalik, tujuan] = ins("app.cash_ledger");
    expect(pembalik!.params.slice(2, 8)).toEqual(["2026-10-20", "Pindah dari penampung — Diparkir — TRSF E-BANKING DB", "debet", "debet", "Mutasi Belum Teridentifikasi", "500000000.00"]);
    expect(tujuan!.params.slice(4, 10)).toEqual(["kredit", "kredit", "Hutang Piutang", "-500000000.00", 7, PL_KREDITUR]);
    // Keduanya menunjuk baris parkir & lahir dari kelompok AKTIF baris parkir.
    for (const x of [pembalik!, tujuan!]) expect(x.params.slice(13, 15)).toEqual([G, PARKIR]);
    // Baris parkir TIDAK disunting; kelompok baru TIDAK dibuat.
    expect(h.log.some((l) => /UPDATE app\.cash_ledger/.test(l.sql))).toBe(false);
    expect(ins("app.cocok_bank")).toHaveLength(0);
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [null, null], ["kas-1", "kas-2"]]);
    expect(h.hariBukuTerkunci).toHaveBeenCalledWith(expect.anything(), h.BK.unit_id, "2026-10-20", { accountId: AKUN });

    const parkirKas: MutasiSisiKas = { ...buka, businessDate: "2026-10-15", jenis: "kredit", categorySide: "kredit", categoryLabel: "Mutasi Belum Teridentifikasi", amount: -500_000_000, saldoAwal: false };
    const s = neraca([buka, parkirKas, ...kasTertulis()], "2026-10-20");
    expect(s.penampung).toBe(0);
    // Membayar kreditur 500 jt: saldo pihak lawan (−Σ amount) naik 500 jt.
    expect(s.hutangPiutangNonEasymax).toBe(500_000_000);
    // Σ kelompok tak berubah: parkir + pembalik + tujuan = mutasi bank.
    expect(-500_000_000 + 500_000_000 - 500_000_000).toBe(-500_000_000);
    expect(auditAksi()).toEqual([{ aksi: "penampung.pindah", aktor: 7 }]);
  });

  it("pindah: hari tujuan tertutup ⇒ maju dengan ADJ-FWD-SUSPENSE", async () => {
    parkir = { id: uid(50), accountId: AKUN, businessDate: "2026-10-15", amount: "-500000000.00", keterangan: "x", categoryLabel: "Mutasi Belum Teridentifikasi", cocokId: G, sudahDipindah: false };
    h.state.hari = () => ({ status: "dibukukan", hariBuku: "2026-11-03", terdorongMaju: true, perluKodeAlasan: true });
    expect((await pindahkanDariPenampung({ code: h.BK.code, parkirId: uid(50), tanggal: "2026-10-20", categoryLabel: "Hutang Piutang", pihakLawanId: PL_KREDITUR })).ok).toBe(true);
    for (const x of ins("app.cash_ledger")) expect(x.params.slice(2, 3).concat(x.params.slice(10, 12))).toEqual(["2026-11-03", "2026-10-20", "ADJ-FWD-SUSPENSE"]);
  });

  it("pindah: bukan baris penampung / sudah dipindah / tanpa kelompok aktif ⇒ ditolak, tak ada baris", async () => {
    const dasar = { id: uid(50), accountId: AKUN, businessDate: "2026-10-15", amount: "-5.00", keterangan: "x", categoryLabel: "Mutasi Belum Teridentifikasi", cocokId: G, sudahDipindah: false };
    for (const over of [{ categoryLabel: "Hutang Piutang" }, { sudahDipindah: true }, { cocokId: null }]) {
      parkir = { ...dasar, ...over };
      const r = await pindahkanDariPenampung({ code: h.BK.code, parkirId: uid(50), categoryLabel: "Hutang Piutang", pihakLawanId: PL_KREDITUR });
      expect(r.ok, JSON.stringify(over)).toBe(false);
    }
    expect(ins("app.cash_ledger")).toHaveLength(0);
    expect(committed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pecah
// ---------------------------------------------------------------------------

describe("klasifikasiPecah (R9)", () => {
  beforeEach(() => {
    baris = mutasi({ amount: "-6500000.00", keterangan: "ANGSURAN BPR" });
  });

  it("Σ = nominal baris impor ⇒ dua baris kas lahiran + beban bunga, satu kelompok", async () => {
    const r = await klasifikasiPecah({
      code: h.BK.code,
      mutasiId: LINE,
      baris: [
        { amount: 6_000_000, categoryLabel: "Hutang Piutang", pihakLawanId: PL_KREDITUR, keterangan: "Pokok" },
        { amount: 500_000, categoryLabel: "Biaya Operasional", operationalCategory: "Lain-Lain", keterangan: "Bunga" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(kasTertulis().map((k) => k.amount)).toEqual([-6_000_000, -500_000]);
    expect(ins("app.manual_entry")).toHaveLength(1);
    expect(ins("app.cocok_bank_baris")[0]!.params[3]).toEqual([null, "kas-1", "kas-2"]);
  });

  it("🔴 Σ ≠ nominal (selisih Rp 1) ⇒ ditolak, tak ada baris kas", async () => {
    const r = await klasifikasiPecah({
      code: h.BK.code,
      mutasiId: LINE,
      baris: [
        { amount: 6_000_000, categoryLabel: "Hutang Piutang", pihakLawanId: PL_KREDITUR },
        { amount: 499_999, categoryLabel: "Biaya Operasional", operationalCategory: "Lain-Lain" },
      ],
    });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/selisih Rp 1\b/) });
    expect(ins("app.cash_ledger")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Antar unit — R30
// ---------------------------------------------------------------------------

describe("klasifikasiAntarUnit — gerbang DUA unit (R30)", () => {
  const masukan = { code: h.BK.code, mutasiId: LINE, lawanCode: h.BL.code, lawanAccountId: AKUN_BL, jenis: "titipan", catatan: "PELANGGAN-X BAYAR VIA IB" };

  it("🔴 tanpa akses unit lawan ⇒ ditolak SEBELUM koneksi, nol baris", async () => {
    const r = await klasifikasiAntarUnit(masukan);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/KEDUA unit/) });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.log).toHaveLength(0);
  });

  it("🔴 'diterima untuk unit lain': kredit di rekening BK ⇒ BK penerima (hutang ke BL), BL pemberi; kaki BK lahir dari kelompok, kaki BL tidak", async () => {
    h.sesi.units = [h.BK, h.BL];
    const r = await klasifikasiAntarUnit(masukan);
    expect(r).toMatchObject({ ok: true });
    expect(h.log.find((l) => l.sql.includes("set_config('app.unit_ids'"))!.params).toEqual([`${h.BK.unit_id},${h.BL.unit_id}`]);
    const kaki = ins("app.cash_ledger");
    expect(kaki).toHaveLength(2);
    const [bl, bk] = kaki; // pemberi (BL) ditulis lebih dulu
    expect(bl!.params.slice(0, 2)).toEqual([h.BL.unit_id, AKUN_BL]);
    expect(bl!.params.slice(7, 8)).toEqual(["-160000000.00"]);
    expect(bl!.params[14]).toBeNull();
    expect(bk!.params.slice(0, 2)).toEqual([h.BK.unit_id, AKUN]);
    expect(bk!.params.slice(4, 8)).toEqual(["debet", "debet", "Hutang Piutang", "160000000.00"]);
    expect(bk!.params[9]).toBe(PL_BK_BL);
    expect(bk!.params[14]).toBe(G);
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [LINE, null], [null, "kas-2"]]);
    expect(auditAksi().map((a) => a.aksi)).toEqual(["antar_unit.catat", "klasifikasi.antar_unit"]);
  });
});

// ---------------------------------------------------------------------------
// Penebusan dari debit B2B (R11)
// ---------------------------------------------------------------------------

describe("simpanPenebusan dari baris impor (R11)", () => {
  beforeEach(() => {
    baris = mutasi({ amount: "-118750000.00", so: "H0000123456789", keterangan: "TRSF E-BANKING DB | PERTAMINA" });
  });

  it("🔴 debit B2B tanpa penebusan ⇒ SO, tanggal, rekening, Gross dari baris impor; Gross peramban DIABAIKAN; kelompok baris ↔ kas", async () => {
    const r = await simpanPenebusan({
      code: h.BK.code,
      mutasiBankId: LINE,
      // Peramban mengirim nilai rusak — harus diabaikan.
      noSo: "SALAH",
      tanggalBayar: "2026-01-01",
      accountId: uid(999),
      gross: 1,
      net: 100_000_000,
      ppn: 11_000_000,
      pph: 250_000,
      pbbkb: 7_500_000,
      nota: 0,
    });
    expect(r).toMatchObject({ ok: true });
    const [k] = ins("app.cash_ledger");
    expect(k!.params.slice(0, 3)).toEqual([h.BK.unit_id, AKUN, "2026-10-02"]);
    expect(k!.params[7]).toBe("-118750000.00");
    // Penebusan memiliki baris kasnya (KTD9) — TIDAK ditandai lahir dari kelompok.
    expect(k!.params).toHaveLength(12);
    const [p] = ins("app.penebusan");
    expect(p!.params.slice(1, 4)).toEqual(["h0000123456789", "2026-10-02", AKUN]);
    expect(p!.params[9]).toBe("118750000.00");
    expect(ins("app.cocok_bank_baris")[0]!.params).toEqual([h.BK.unit_id, G, [LINE, null], [null, "kas-1"]]);
    expect(auditAksi().map((a) => a.aksi)).toEqual(["klasifikasi.penebusan", "penebusan.catat"]);
  });

  it("komponen pajak tak sama dengan Gross baris impor ⇒ ditolak, tak ada baris", async () => {
    const r = await simpanPenebusan({
      code: h.BK.code,
      mutasiBankId: LINE,
      noSo: "H0000123456789",
      tanggalBayar: "2026-10-02",
      accountId: AKUN,
      gross: 118_750_000,
      net: 100_000_000,
      ppn: 11_000_000,
      pph: 250_000,
      pbbkb: 7_500_001,
      nota: 0,
    });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/selisih Rp 1\b.*Gross dari rekening koran/) });
    expect(ins("app.cash_ledger")).toHaveLength(0);
    expect(ins("app.penebusan")).toHaveLength(0);
  });
});
