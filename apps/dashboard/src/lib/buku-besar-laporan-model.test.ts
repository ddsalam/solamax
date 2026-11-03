import { describe, expect, it } from "vitest";
import { susunLaporan, temuanBeda, type BahanLaporanBukuBesar, type GerakPos } from "./buku-besar-laporan-model";
import type { Pos } from "./pos-model";

/**
 * Laporan formal buku besar (rencana 2026-11-02 K6 U9; R10, R12, KTD10).
 * Angka ILUSTRASI, dalam sen.
 */

const pos = (kode: string, jenis: Pos["jenis"], o: Partial<Pos> = {}): Pos => ({
  id: null,
  kode,
  nama: `Pos ${kode}`,
  jenis,
  induk: false,
  kodeInduk: null,
  pengurang: false,
  kliring: false,
  sistem: false,
  unitId: null,
  cashAccountId: null,
  ...o,
});

const DAFTAR: Pos[] = [
  pos("1100", "aset", { induk: true }),
  pos("1101", "aset", { kodeInduk: "1100" }),
  pos("1103", "aset", { kodeInduk: "1100", kliring: true }),
  pos("1110", "aset", { induk: true }),
  pos("1111", "aset", { kodeInduk: "1110", unitId: 2, cashAccountId: "a-bank" }),
  pos("1121", "aset"),
  pos("1131", "aset"),
  pos("1132", "aset"),
  pos("1510", "aset"),
  pos("1590", "aset", { pengurang: true }),
  pos("2300", "kewajiban"),
  pos("3100", "modal"),
  pos("3900", "modal", { sistem: true }),
  pos("4100", "pendapatan"),
  pos("4110", "pendapatan", { pengurang: true }),
  pos("5100", "beban"),
  pos("5600", "beban"),
];

const g = (posKode: string, debetSen: number, kreditSen: number, o: Partial<GerakPos> = {}): GerakPos => ({
  posKode,
  debetSen,
  kreditSen,
  status: "aktif",
  jenis: "sumber",
  dalamBulan: true,
  ...o,
});

const bahan = (o: Partial<BahanLaporanBukuBesar> = {}): BahanLaporanBukuBesar => ({
  daftar: DAFTAR,
  saldoAwal: [
    { posKode: "1101", saldoSen: 1_000_000, sumber: "akun_kas" },
    { posKode: "1111", saldoSen: 4_000_000, sumber: "akun_kas" },
    { posKode: "1510", saldoSen: 10_000_000, sumber: "akuntan" },
    { posKode: "3100", saldoSen: -15_000_000, sumber: "akuntan" },
  ],
  kasPembuka: [
    { nama: "Kas Besar", posKode: "1101", saldoSen: 1_000_000, sementara: false },
    { nama: "Bank A", posKode: "1111", saldoSen: 4_000_000, sementara: false },
  ],
  gerak: [
    // Penjualan 3.000.000: kas 2.500.000 + piutang 500.000
    g("1101", 2_500_000, 0),
    g("1121", 500_000, 0),
    g("4100", 0, 3_000_000),
    // HPP 2.000.000 dari persediaan
    g("5100", 2_000_000, 0),
    g("1131", 0, 2_000_000),
  ],
  bulanDitutupBukuBesar: true,
  ...o,
});

const nilai = (baris: { kode: string; nilaiSen: number }[], kode: string) => baris.find((b) => b.kode === kode)?.nilaiSen;

describe("neraca formal dari jurnal tersimpan + saldo awal (R10, KTD10)", () => {
  it("🔴 neraca seimbang: aset = kewajiban + modal + laba berjalan, saldo awal ikut", () => {
    const l = susunLaporan(bahan());
    const aset = l.neraca.kelompok.find((k) => k.jenis === "aset")!;
    expect(nilai(aset.baris, "1101")).toBe(3_500_000);
    expect(nilai(aset.baris, "1111")).toBe(4_000_000);
    expect(nilai(aset.baris, "1131")).toBe(-2_000_000);
    expect(l.neraca.totalAsetSen).toBe(1_000_000 + 2_500_000 + 4_000_000 + 500_000 - 2_000_000 + 10_000_000);
    expect(l.neraca.labaBerjalanSen).toBe(1_000_000);
    expect(l.neraca.totalKewajibanModalSen).toBe(15_000_000 + 1_000_000);
    expect(l.neraca.bedaSen).toBe(0);
  });

  it("🔴 laba-rugi bulan dari kelas 4 dan 5 saja; pos pengurang (tera) mengurangi pendapatan", () => {
    const l = susunLaporan(
      bahan({
        gerak: [...bahan().gerak, g("4110", 100_000, 0), g("1101", 0, 100_000), g("4100", 0, 9_000_000, { dalamBulan: false }), g("1101", 9_000_000, 0, { dalamBulan: false })],
      }),
    );
    expect(nilai(l.labaRugi.pendapatan, "4100")).toBe(3_000_000);
    expect(nilai(l.labaRugi.pendapatan, "4110")).toBe(-100_000);
    expect(nilai(l.labaRugi.beban, "5100")).toBe(2_000_000);
    expect(l.labaRugi.labaSen).toBe(3_000_000 - 100_000 - 2_000_000);
    // Laba bulan sebelumnya masuk laba berjalan neraca, tidak masuk laba-rugi bulan ini.
    expect(l.neraca.labaBerjalanSen).toBe(9_000_000 + 900_000);
    expect(l.neraca.bedaSen).toBe(0);
  });

  it("🔴 memorial menunggu dan batal tidak masuk laporan sampai disetujui", () => {
    const memorial = [g("5600", 15_000_000, 0, { jenis: "memorial", status: "menunggu" }), g("1590", 0, 15_000_000, { jenis: "memorial", status: "menunggu" })];
    const sebelum = susunLaporan(bahan({ gerak: [...bahan().gerak, ...memorial] }));
    expect(sebelum.labaRugi.labaSen).toBe(1_000_000);
    expect(nilai(sebelum.labaRugi.beban, "5600")).toBeUndefined();
    const batal = susunLaporan(bahan({ gerak: [...bahan().gerak, ...memorial.map((m) => ({ ...m, status: "batal" as const }))] }));
    expect(batal.labaRugi.labaSen).toBe(1_000_000);
    const sesudah = susunLaporan(bahan({ gerak: [...bahan().gerak, ...memorial.map((m) => ({ ...m, status: "aktif" as const }))] }));
    expect(sesudah.labaRugi.labaSen).toBe(1_000_000 - 15_000_000);
    expect(nilai(sesudah.neraca.kelompok.find((k) => k.jenis === "aset")!.baris, "1590")).toBe(-15_000_000);
    expect(sesudah.neraca.bedaSen).toBe(0);
  });

  it("jurnal berjenis saldo_awal tidak dijumlah dua kali dengan saldo_awal_pos", () => {
    const l = susunLaporan(bahan({ gerak: [...bahan().gerak, g("1510", 10_000_000, 0, { jenis: "saldo_awal" }), g("3100", 0, 10_000_000, { jenis: "saldo_awal" })] }));
    expect(nilai(l.neraca.kelompok.find((k) => k.jenis === "aset")!.baris, "1510")).toBe(10_000_000);
  });

  it("jurnal tak seimbang (mustahil di DB) tampil sebagai beda, tidak disembunyikan", () => {
    const l = susunLaporan(bahan({ gerak: [...bahan().gerak, g("1101", 7, 0)] }));
    expect(l.neraca.bedaSen).toBe(7);
  });
});

describe("tanda \"sementara\" (R10)", () => {
  it("lengkap & bulan ditutup dengan buku besar → final", () => {
    const l = susunLaporan(bahan());
    expect(l.sementara).toEqual([]);
    expect(l.saldoAwalLengkap).toBe(true);
  });

  it("🔴 saldo awal belum diisi → sementara", () => {
    const l = susunLaporan(bahan({ saldoAwal: [] }));
    expect(l.saldoAwalLengkap).toBe(false);
    expect(l.sementara.join(" ")).toMatch(/Saldo awal .* belum diisi/);
  });

  it("saldo pembuka rekening sementara / belum ditetapkan / berubah sesudah disimpan → sementara", () => {
    const sementara = susunLaporan(bahan({ kasPembuka: [{ nama: "Bank A", posKode: "1111", saldoSen: 4_000_000, sementara: true }, bahan().kasPembuka[0]!] }));
    expect(sementara.sementara.join(" ")).toMatch(/Bank A.*sementara/);
    const belum = susunLaporan(bahan({ kasPembuka: [...bahan().kasPembuka, { nama: "Bank B", posKode: null, saldoSen: null, sementara: false }] }));
    expect(belum.sementara.join(" ")).toMatch(/Bank B.*belum ditetapkan/);
    const berubah = susunLaporan(bahan({ kasPembuka: [bahan().kasPembuka[0]!, { nama: "Bank A", posKode: "1111", saldoSen: 4_500_000, sementara: false }] }));
    expect(berubah.saldoAwalLengkap).toBe(false);
    expect(berubah.sementara.join(" ")).toMatch(/berubah/);
  });

  it("saldo awal tersimpan tidak seimbang → sementara", () => {
    const l = susunLaporan(bahan({ saldoAwal: [...bahan().saldoAwal, { posKode: "2300", saldoSen: -1, sumber: "akuntan" }] }));
    expect(l.saldoAwalLengkap).toBe(false);
  });

  it("🔴 bulan belum ditutup dengan buku besar → sementara walau saldo awal lengkap", () => {
    const l = susunLaporan(bahan({ bulanDitutupBukuBesar: false }));
    expect(l.saldoAwalLengkap).toBe(true);
    expect(l.sementara.join(" ")).toMatch(/belum ditutup/);
  });
});

describe("temuan beda dengan laporan rumus (R12)", () => {
  it("🔴 beda kas antara buku besar dan laporan rumus tampil sebagai temuan; yang sama tidak", () => {
    const l = susunLaporan(bahan());
    // Buku besar: kas+bank 75.000 Rp, persediaan −20.000, SO 0, piutang 5.000, laba 10.000.
    const t = temuanBeda(l, { kasBankRp: 74_000, persediaanRp: -20_000, soRp: 0, piutangEasymaxRp: 5_000, labaRp: 10_000 });
    const kas = t.find((x) => x.kunci === "kas_bank")!;
    expect(kas.bukuBesarSen).toBe(7_500_000);
    expect(kas.rumusSen).toBe(7_400_000);
    expect(kas.bedaSen).toBe(100_000);
    expect(kas.temuan).toBe(true);
    for (const k of ["persediaan", "so", "piutang", "laba"]) {
      expect(t.find((x) => x.kunci === k)!.temuan, k).toBe(false);
    }
  });

  it("angka rumus tak terhitung → bukan temuan, bedanya null (tidak dinolkan)", () => {
    const l = susunLaporan(bahan());
    const t = temuanBeda(l, { kasBankRp: null, persediaanRp: null, soRp: 0, piutangEasymaxRp: 5_000, labaRp: null });
    expect(t.find((x) => x.kunci === "kas_bank")).toMatchObject({ rumusSen: null, bedaSen: null, temuan: false });
    expect(t.find((x) => x.kunci === "laba")).toMatchObject({ rumusSen: null, bedaSen: null, temuan: false });
  });

  it("rupiah desimal rumus dibandingkan dalam sen tanpa galat float", () => {
    const l = susunLaporan(bahan());
    const t = temuanBeda(l, { kasBankRp: 75_000.1, persediaanRp: -20_000, soRp: 0, piutangEasymaxRp: 5_000, labaRp: 10_000 });
    expect(t.find((x) => x.kunci === "kas_bank")!.bedaSen).toBe(-10);
  });
});
