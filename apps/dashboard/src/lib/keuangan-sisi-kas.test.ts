import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { panelBalance, panelCashFlow, type BalanceInput } from "./keuangan-laporan-model";
import {
  arusBukuKas,
  barisSusulan,
  PETA_KATEGORI_ARUS_KAS,
  sisiKasNeraca,
  type MasukanSisiKas,
  type MutasiSisiKas,
} from "./keuangan-sisi-kas";

// ---------------------------------------------------------------------------
// KTD12 — setiap kategori yang di-seed migrasi punya baris arus kas
// ---------------------------------------------------------------------------

const MIGRASI = resolve(__dirname, "../../../backend/prisma/migrations");

/** Label `cash_mutation_category` dari teks SQL — setiap blok INSERT ke tabel itu. */
function labelDariSql(sql: string): string[] {
  const out: string[] = [];
  const blok = /INSERT INTO "app"\."cash_mutation_category"[^;]*?VALUES([\s\S]*?)(?:ON CONFLICT|;)/g;
  for (const m of sql.matchAll(blok)) {
    for (const t of m[1]!.matchAll(/\(\s*'(?:debet|kredit)'\s*,\s*'([^']+)'\s*\)/g)) out.push(t[1]!);
  }
  return out;
}

function labelMigrasi(): Map<string, string[]> {
  const per = new Map<string, string[]>();
  for (const dir of readdirSync(MIGRASI).sort()) {
    let sql: string;
    try {
      sql = readFileSync(resolve(MIGRASI, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    // Komentar SQL dibuang: contoh di komentar bukan seed.
    const l = labelDariSql(sql.replace(/--.*$/gm, ""));
    if (l.length) per.set(dir, l);
  }
  return per;
}

const tanpaPeta = (labels: readonly string[]) => labels.filter((l) => PETA_KATEGORI_ARUS_KAS[l] === undefined);

describe("KTD12 — peta kategori kas → baris arus kas", () => {
  const per = labelMigrasi();
  const semua = [...new Set([...per.values()].flat())];

  it("penjaga ini punya SUBJEK: seed 0029, 0043, 0045, 0049 terbaca", () => {
    expect([...per.keys()]).toEqual(
      expect.arrayContaining(["0029_cash_ledger", "0043_edc_per_shift", "0045_titipan_bright", "0049_pihak_lawan"]),
    );
    expect(per.get("0029_cash_ledger")).toHaveLength(15);
    expect(semua).toContain("Mutasi Belum Teridentifikasi");
    expect(semua).toContain("Penyerahan titipan");
  });

  it("🔴 SETIAP label yang di-seed migrasi punya tepat satu baris arus kas", () => {
    expect(tanpaPeta(semua), "kategori kas tanpa baris arus kas — tambahkan ke PETA_KATEGORI_ARUS_KAS").toEqual([]);
  });

  it("🔴 MUTAN: migrasi baru menyemai kategori tanpa peta ⇒ merah", () => {
    const sqlBaru = `INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES
        ('kredit', 'Biaya Bunga Bank'),
        ('debet',  'Hutang Piutang')
      ON CONFLICT ("side", "label") DO NOTHING;`;
    expect(tanpaPeta(labelDariSql(sqlBaru))).toEqual(["Biaya Bunga Bank"]);
  });

  it("peta tidak memuat label yang tak pernah di-seed (salah ketik terdeteksi)", () => {
    expect(Object.keys(PETA_KATEGORI_ARUS_KAS).filter((l) => !semua.includes(l))).toEqual([]);
  });

  it("baris arus yang dijumlah dari buku kas memakai baris panel yang ADA", () => {
    const p = panelCashFlow({
      sebabKas: null, kasAwalPerAkun: [], kasAkhir: 0, omzet: 0, teraValue: 0, transaksiPiutangEasymax: 0,
      hutangPiutangNonEasymax: 0, penebusanSo: 0, temporaryInvestment: 0, penampung: 0, pendapatanLain: 0,
      biayaOperasional: 0, arusTitipanBright: 0, kontribusiPemilik: 0,
    });
    const labelPanel = new Set(p.baris.map((b) => b.label));
    for (const [kategori, peta] of Object.entries(PETA_KATEGORI_ARUS_KAS)) {
      if (peta.baris === "Perpindahan antar akun kas") continue; // bersih nol, bukan arus
      expect(labelPanel.has(peta.baris), `${kategori} → ${peta.baris}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Arus kas: identitas Net cash change = Δ kas buku
// ---------------------------------------------------------------------------

const row = (o: Partial<MutasiSisiKas> & { amount: number; categoryLabel: string | null }): MutasiSisiKas => ({
  accountId: "BCA",
  businessDate: "2026-11-03",
  jenis: o.amount < 0 ? "kredit" : "debet",
  categorySide: o.amount < 0 ? "kredit" : "debet",
  saldoAwal: false,
  void: false,
  pihakLawanId: null,
  tanggalAsal: null,
  ...o,
});

describe("cek arus kas terhitung & identitasnya berlaku (R16, KTD12)", () => {
  const D = "2026-11-03";
  const mutasi: MutasiSisiKas[] = [
    row({ amount: 1_000_000_000, businessDate: "2026-10-01", jenis: "adjustment", categorySide: null, categoryLabel: null, saldoAwal: true }),
    row({ amount: -320_000_000, categoryLabel: "Pembelian BBM" }),
    row({ amount: 50_000_000, categoryLabel: "Hutang Piutang", pihakLawanId: "k" }),
    row({ amount: -10_000_000, categoryLabel: "Temporary Investment" }),
    row({ amount: 7_000_000, categoryLabel: "Mutasi Belum Teridentifikasi" }),
    row({ amount: -2_000_000, categoryLabel: "Penyerahan titipan", pihakLawanId: "t" }),
    row({ amount: -5_000_000, categoryLabel: "Kontribusi ke Pusat" }),
    // Perpindahan antar akun: bersih nol di dalam buku, tak menyentuh arus.
    row({ amount: -40_000_000, categoryLabel: "Pindah Buku" }),
    row({ amount: 40_000_000, accountId: "KAS", categoryLabel: "Pindah Buku" }),
    // Realisasi omzet — arusnya dari EasyMax (di sini omzet = 0), jadi baris ini
    // BUKAN arus buku kas; untuk identitas uji, omzet EasyMax = setorannya.
    row({ amount: 12_000_000, accountId: "KAS", categoryLabel: "Setoran Hasil Penjualan" }),
  ];

  it("arus dari buku kas dijumlah per baris arus — penebusan SO terisi", () => {
    const a = arusBukuKas(mutasi, D);
    expect(a.get("Penebusan SO")).toBe(-320_000_000);
    expect(a.get("Transaksi hutang piutang non-EasyMax")).toBe(50_000_000);
    expect(a.get("Temporary investment")).toBe(-10_000_000);
    expect(a.get("Mutasi belum teridentifikasi (penampung)")).toBe(7_000_000);
    expect(a.get("Titipan outlet Bright (bukan pendapatan)")).toBe(-2_000_000);
    expect(a.get("Prive / kontribusi pemilik (bukan beban)")).toBe(-5_000_000);
    expect(a.has("Perpindahan antar akun kas")).toBe(false);
    expect(a.has("Omzet penjualan")).toBe(false); // sumbernya EasyMax
  });

  it("🔴 penebusanSo terisi ⇒ cek arus kas TERHITUNG, dan Rp 0 bila semua tercatat", () => {
    const a = arusBukuKas(mutasi, D);
    const p = panelCashFlow({
      sebabKas: null,
      kasAwalPerAkun: [{ nama: "BCA", saldo: 1_000_000_000 }],
      kasAkhir: 1_000_000_000 - 320_000_000 + 50_000_000 - 10_000_000 + 7_000_000 - 2_000_000 - 5_000_000 + 12_000_000,
      omzet: 12_000_000,
      teraValue: 0,
      transaksiPiutangEasymax: 0,
      hutangPiutangNonEasymax: a.get("Transaksi hutang piutang non-EasyMax")!,
      penebusanSo: a.get("Penebusan SO")!,
      temporaryInvestment: a.get("Temporary investment")!,
      penampung: a.get("Mutasi belum teridentifikasi (penampung)")!,
      pendapatanLain: 0,
      biayaOperasional: 0,
      arusTitipanBright: a.get("Titipan outlet Bright (bukan pendapatan)")!,
      // CF menampilkan −kontribusi; kas keluar ke pusat 5 jt = kontribusi +5 jt.
      kontribusiPemilik: -a.get("Prive / kontribusi pemilik (bukan beban)")!,
    });
    expect(p.pemeriksa.nilai).not.toBeNull();
    expect(p.pemeriksa.nilai).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Neraca: tak ada baris kas bukan-laba yang menggeser langkah
// ---------------------------------------------------------------------------

const PL = [
  { id: "k", jenis: "kreditur" as const, saldoAwal: null },
  { id: "t", jenis: "titipan" as const, saldoAwal: null },
];
const masukan = (mutasi: MutasiSisiKas[], o: Partial<MasukanSisiKas> = {}): MasukanSisiKas => ({
  mutasi,
  date: "2026-11-03",
  adaAkun: true,
  kasTerhitung: true,
  pihakLawan: PL,
  titipanDiterima: [{ pihakLawanId: "t", nama: "Outlet Bright", rp: 0, businessDate: null }],
  ...o,
});

/** Asset bersih sisi kas — susunan yang sama dengan `panelBalance`. */
const asetKas = (s: ReturnType<typeof sisiKasNeraca>) =>
  s.kasAkhir! + s.hutangPiutangNonEasymax! + s.penampung! + s.temporaryInvestment! - s.saldoTitipanBright;

describe("sisiKasNeraca — tiap baris bukan-laba diimbangi tepat sekali", () => {
  const buka = row({ amount: 0, businessDate: "2026-10-01", jenis: "adjustment", categorySide: null, categoryLabel: null, saldoAwal: true });

  it.each([
    ["Hutang Piutang (kreditur)", row({ amount: 1_000_000, categoryLabel: "Hutang Piutang", pihakLawanId: "k" })],
    ["Hutang Piutang tanpa pihak lawan", row({ amount: -3_000_000, categoryLabel: "Hutang Piutang" })],
    ["penampung debet", row({ amount: 500_000_000, categoryLabel: "Mutasi Belum Teridentifikasi" })],
    ["Temporary Investment", row({ amount: -10_000_000, categoryLabel: "Temporary Investment" })],
    ["Penyerahan titipan ke pemilik", row({ amount: -2_000_000, categoryLabel: "Penyerahan titipan", pihakLawanId: "t" })],
  ])("%s ⇒ asset bersih sisi kas tidak berubah", (_n, r) => {
    expect(asetKas(sisiKasNeraca(masukan([buka, r])))).toBe(0);
  });

  it("🔴 Penyerahan titipan TIDAK dihitung dua kali — term pihak lawan tak menyentuhnya", () => {
    const s = sisiKasNeraca(masukan([buka, row({ amount: -2_000_000, categoryLabel: "Penyerahan titipan", pihakLawanId: "t" })]));
    expect(s.hutangPiutangNonEasymax).toBe(0);
    expect(s.saldoTitipanBright).toBe(-2_000_000);
  });

  it("🔴 saldo pembuka pemilik TITIPAN masuk liabilitas titipan, BUKAN term pihak lawan", () => {
    const s = sisiKasNeraca(
      masukan([buka, row({ amount: -500_000, businessDate: "2026-10-03", categoryLabel: "Penyerahan titipan", pihakLawanId: "t" })], {
        pihakLawan: [
          PL[0]!,
          // Utang 2 jt yang dibawa masuk per 5 Okt (tanda 0049: negatif = hutang).
          { id: "t", jenis: "titipan", saldoAwal: { tanggal: "2026-10-05", amountSen: -200_000_000, sementara: true } },
        ],
      }),
    );
    expect(s.hutangPiutangNonEasymax).toBe(0);
    // Penyerahan 3 Okt sudah termuat di pembuka 5 Okt ⇒ tak dijumlah lagi.
    expect(s.saldoTitipanBright).toBe(2_000_000);
    expect(s.titipanSementara).toBe(true);
    expect(s.pihakLawanSementara).toBe(false);
  });

  it("saldo pembuka pihak lawan non-titipan berlaku sejak tanggalnya; baris sebelumnya termuat", () => {
    const pl = [{ id: "k", jenis: "kreditur" as const, saldoAwal: { tanggal: "2026-10-10", amountSen: -100_000_000_00, sementara: false } }];
    const rows = [
      buka,
      row({ amount: 5_000_000, businessDate: "2026-10-05", categoryLabel: "Hutang Piutang", pihakLawanId: "k" }),
      row({ amount: -1_000_000, businessDate: "2026-10-20", categoryLabel: "Hutang Piutang", pihakLawanId: "k" }),
    ];
    expect(sisiKasNeraca(masukan(rows, { pihakLawan: pl, date: "2026-10-09" })).hutangPiutangNonEasymax).toBe(-5_000_000);
    expect(sisiKasNeraca(masukan(rows, { pihakLawan: pl, date: "2026-11-03" })).hutangPiutangNonEasymax).toBe(-100_000_000 + 1_000_000);
  });

  it("Tambahan Modal / Kontribusi ke Pusat hari itu ⇒ arus ekuitas (positif = keluar)", () => {
    const s = sisiKasNeraca(
      masukan([
        buka,
        row({ amount: -5_000_000, categoryLabel: "Kontribusi ke Pusat" }),
        row({ amount: 2_000_000, categoryLabel: "Tambahan Modal" }),
        row({ amount: -9_000_000, businessDate: "2026-11-02", categoryLabel: "Kontribusi ke Pusat" }),
      ]),
    );
    expect(s.kontribusiKas).toBe(3_000_000);
  });

  it("tanpa akun kas ⇒ term kategori null, bukan 0", () => {
    const s = sisiKasNeraca(masukan([], { adaAkun: false, kasTerhitung: false }));
    expect(s.kasAkhir).toBeNull();
    expect(s.hutangPiutangNonEasymax).toBeNull();
    expect(s.penampung).toBeNull();
    expect(s.temporaryInvestment).toBeNull();
  });
});

describe("barisSusulan (KTD15)", () => {
  it("hanya baris yang dibukukan HARI ITU dengan tanggal asal lebih awal", () => {
    expect(barisSusulan(row({ amount: 1, categoryLabel: null, tanggalAsal: "2026-10-02" }), "2026-11-03")).toBe(true);
    expect(barisSusulan(row({ amount: 1, categoryLabel: null, tanggalAsal: "2026-11-03" }), "2026-11-03")).toBe(false);
    expect(barisSusulan(row({ amount: 1, categoryLabel: null }), "2026-11-03")).toBe(false);
    expect(
      barisSusulan(row({ amount: 1, categoryLabel: null, businessDate: "2026-11-02", tanggalAsal: "2026-10-02" }), "2026-11-03"),
    ).toBe(false);
  });
});

describe("neraca menandai saldo pembuka sementara & merinci titipan per pemilik", () => {
  const dasar: BalanceInput = {
    sebabKas: null, cashOnHand: 100, inventoryValue: 0, soValue: 0, piutangEasymax: 0,
    hutangPiutangNonEasymax: -40, penampung: 0, temporaryInvestment: 0, openedRetainedEarnings: null,
    netIncome: 0, incomeAdjustment: null, totalAssetKemarin: null, deltaKontribusi: 0, saldoTitipanBright: 30,
  };

  it("§10.26 — pembuka pihak lawan sementara ⇒ baris neraca bertanda 'saldo pembuka sementara'", () => {
    const p = panelBalance({ ...dasar, pihakLawanSementara: true });
    expect(p.baris.find((b) => b.label === "Hutang piutang non-EasyMax")!.tanda).toBe("saldo pembuka sementara");
    expect(panelBalance(dasar).baris.find((b) => b.label === "Hutang piutang non-EasyMax")!.tanda).toBeUndefined();
  });

  it("titipan per pemilik dirinci di bawah baris titipan; totalnya tetap", () => {
    const p = panelBalance({
      ...dasar,
      titipanPerPemilik: [{ nama: "Kebab", saldo: 10 }, { nama: "Outlet Bright", saldo: 20 }],
    });
    const lbl = p.baris.map((b) => b.label);
    const i = lbl.indexOf("Titipan outlet Bright (liabilitas)");
    expect(lbl.slice(i, i + 3)).toEqual(["Titipan outlet Bright (liabilitas)", "· Kebab", "· Outlet Bright"]);
    expect(p.baris[i]!.nilai).toBe(-30);
    expect(p.baris.find((b) => b.label === "Asset − liabilities")!.nilai).toBe(100 - 40 - 30);
  });

  it("baris 'pihak lawan belum ditetapkan' tampil hanya bila ada", () => {
    expect(panelBalance({ ...dasar, pihakLawanBelumDitetapkan: -40 }).baris.some((b) => b.label === "· pihak lawan belum ditetapkan")).toBe(true);
    expect(panelBalance({ ...dasar, pihakLawanBelumDitetapkan: 0 }).baris.some((b) => b.label === "· pihak lawan belum ditetapkan")).toBe(false);
  });
});
