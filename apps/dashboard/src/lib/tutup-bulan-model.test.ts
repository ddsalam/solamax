import { describe, expect, it } from "vitest";
import {
  hariDalamBulan,
  periksaTutupBulan,
  type BarisBukuBulan,
  type BarisImporBulan,
  type BarisParkirBulan,
  type MasukanTutupBulan,
  type RekeningWajib,
} from "./tutup-bulan-model";

/**
 * Vonis tutup bulan (rencana 2026-10-29 U12; R25, AE5; KTD14). Data SINTETIS.
 */

const BCA = "11111111-1111-4111-8111-111111111111";
const BCA2 = "22222222-2222-4222-8222-222222222222";
const BRI = "33333333-3333-4333-8333-333333333333";
const G = "99999999-9999-4999-8999-999999999999";
const P = "88888888-8888-4888-8888-888888888888";

const rek = (o: Partial<RekeningWajib> = {}): RekeningWajib => ({
  id: BCA,
  nama: "Bank BCA - 1234567890",
  cutOver: "2026-10-01",
  rekeningKoranAktif: true,
  ...o,
});

const parkir = (o: Partial<BarisParkirBulan> = {}): BarisParkirBulan => ({
  id: "p1",
  accountId: BCA,
  tanggalBank: "2026-10-15",
  businessDate: "2026-10-15",
  amountSen: -500_000_000_00,
  keterangan: "Diparkir — TRSF DB tanpa keterangan",
  sudahDipindah: false,
  alasanMaju: null,
  lahirDariCocokId: G,
  ...o,
});

const buku = (o: Partial<BarisBukuBulan> = {}): BarisBukuBulan => ({
  id: "k1",
  accountId: BCA,
  businessDate: "2026-10-10",
  tanggalAsal: null,
  amountSen: -75_000_00,
  void: false,
  saldoAwal: false,
  dicocokkan: false,
  alasanMaju: null,
  lahirDariCocokId: null,
  pasanganUuid: null,
  keterangan: "Biaya admin diketik manual",
  categoryLabel: "Biaya Operasional",
  ...o,
});

const impor = (o: Partial<BarisImporBulan> = {}): BarisImporBulan => ({
  id: "m1",
  accountId: BCA,
  tanggalBank: "2026-10-05",
  praCutover: false,
  dicocokkan: true,
  ...o,
});

/** Oktober 2026 yang lengkap: semua hari tertutup, rekening koran ada, semua tercocok. */
const lengkap = (o: Partial<MasukanTutupBulan> = {}): MasukanTutupBulan => ({
  bulan: "2026-10",
  hariTertutup: hariDalamBulan("2026-10"),
  parkir: [],
  rekening: [rek()],
  impor: [impor()],
  buku: [buku({ dicocokkan: true })],
  ...o,
});

describe("hariDalamBulan", () => {
  it("menyebut setiap hari kalender, termasuk 29 Februari tahun kabisat", () => {
    expect(hariDalamBulan("2026-10")).toHaveLength(31);
    expect(hariDalamBulan("2026-10")[0]).toBe("2026-10-01");
    expect(hariDalamBulan("2026-10")[30]).toBe("2026-10-31");
    expect(hariDalamBulan("2028-02")).toHaveLength(29);
    expect(hariDalamBulan("2026-11")).toHaveLength(30);
  });
});

describe("periksaTutupBulan — empat syarat R25", () => {
  it("semua syarat terpenuhi ⇒ boleh, keempatnya OK", () => {
    const v = periksaTutupBulan(lengkap());
    expect(v.boleh).toBe(true);
    expect(v.alasan).toEqual([]);
    expect(v.syarat.hari.ok && v.syarat.penampung.ok && v.syarat.rekeningKoran.ok && v.syarat.bukuTanpaPasangan.ok).toBe(true);
  });

  it("🔴 AE5: debit Rp 500 jt diparkir 15 Okt ⇒ ditolak dengan alasan penampung", () => {
    const v = periksaTutupBulan(lengkap({ parkir: [parkir()] }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.penampung).toMatchObject({ ok: false, jumlah: 1, totalSen: -500_000_000_00 });
    expect(v.alasan).toHaveLength(1);
    expect(v.alasan[0]).toMatch(/penampung/i);
    expect(v.alasan[0]).toMatch(/1 baris/);
  });

  it("🔴 mutasi bank 20 Okt diparkir dengan tanggal buku 3 Nov ⇒ menahan OKTOBER, bukan November", () => {
    const p = parkir({ tanggalBank: "2026-10-20", businessDate: "2026-11-03" });
    expect(periksaTutupBulan(lengkap({ parkir: [p] })).syarat.penampung.ok).toBe(false);
    const nov = periksaTutupBulan({
      bulan: "2026-11",
      hariTertutup: hariDalamBulan("2026-11"),
      parkir: [p],
      rekening: [rek()],
      impor: [],
      buku: [],
    });
    expect(nov.syarat.penampung.ok).toBe(true);
    expect(nov.boleh).toBe(true);
  });

  it("baris parkir yang sudah dipindahkan, semua syarat lain terpenuhi ⇒ lolos", () => {
    const v = periksaTutupBulan(lengkap({ parkir: [parkir({ sudahDipindah: true })] }));
    expect(v.syarat.penampung.ok).toBe(true);
    expect(v.boleh).toBe(true);
  });

  it("baris parkir yang DIBALIK pembatalan cocok di hari tertutup (pembalik maju bertaut) ⇒ bukan parkir terbuka", () => {
    const balik = parkir({ id: "p2", businessDate: "2026-11-02", tanggalBank: "2026-10-15", amountSen: 500_000_000_00, alasanMaju: "ADJ-FWD-REVERSAL" });
    expect(periksaTutupBulan(lengkap({ parkir: [parkir(), balik] })).syarat.penampung.ok).toBe(true);
    // DAYA-BEDA: pembalik kelompok lain tidak membalik parkir ini.
    const lain = { ...balik, lahirDariCocokId: "77777777-7777-4777-8777-777777777777" };
    expect(periksaTutupBulan(lengkap({ parkir: [parkir(), lain] })).syarat.penampung.jumlah).toBe(1);
  });

  it("🔴 satu hari belum tertutup ⇒ ditolak, harinya disebut; hari TANPA baris = belum tertutup (§10.15)", () => {
    const v = periksaTutupBulan(lengkap({ hariTertutup: hariDalamBulan("2026-10").filter((d) => d !== "2026-10-17") }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.hari).toMatchObject({ ok: false, jumlah: 1, belum: ["2026-10-17"] });
    expect(v.alasan[0]).toMatch(/1 hari/);
  });

  it("hari tertutup di bulan LAIN tidak menutupi hari bulan ini", () => {
    const v = periksaTutupBulan(lengkap({ hariTertutup: hariDalamBulan("2026-11") }));
    expect(v.syarat.hari.jumlah).toBe(31);
  });

  it("🔴 rekening BCA aktif tanpa rekening koran bulan itu ⇒ ditolak", () => {
    const v = periksaTutupBulan(lengkap({ rekening: [rek(), rek({ id: BCA2, nama: "Bank BCA - 999", rekeningKoranAktif: false })] }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.rekeningKoran).toMatchObject({ ok: false, jumlah: 1 });
    expect(v.syarat.rekeningKoran.belumDiimpor.map((r) => r.id)).toEqual([BCA2]);
  });

  it("rekening yang saldo pembukanya SESUDAH bulan itu tidak dituntut rekening korannya", () => {
    const v = periksaTutupBulan(lengkap({ rekening: [rek(), rek({ id: BCA2, cutOver: "2026-11-01", rekeningKoranAktif: false })] }));
    expect(v.syarat.rekeningKoran.ok).toBe(true);
  });

  it("baris impor TERBUKA di bulan itu ⇒ syarat rekening koran tertahan; pra-cut-over tidak dihitung", () => {
    const v = periksaTutupBulan(lengkap({ impor: [impor(), impor({ id: "m2", dicocokkan: false }), impor({ id: "m3", dicocokkan: false, praCutover: true })] }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.rekeningKoran).toMatchObject({ ok: false, jumlah: 1, imporTerbuka: 1 });
    expect(v.alasan[0]).toMatch(/1 baris rekening koran belum/);
  });

  it("baris impor terbuka bertanggal bank bulan lain tidak menahan bulan ini", () => {
    const v = periksaTutupBulan(lengkap({ impor: [impor({ tanggalBank: "2026-11-02", dicocokkan: false })] }));
    expect(v.syarat.rekeningKoran.ok).toBe(true);
  });

  it("🔴 rekening BRI diabaikan: baris buku & impornya di luar rekening wajib tidak dihitung", () => {
    const v = periksaTutupBulan(
      lengkap({ buku: [buku({ accountId: BRI })], impor: [impor({ accountId: BRI, dicocokkan: false })] }),
    );
    expect(v.boleh).toBe(true);
  });

  it("🔴 baris buku manual tanpa pasangan ⇒ ditolak dan TAMPIL di daftar", () => {
    const v = periksaTutupBulan(lengkap({ buku: [buku({ dicocokkan: true }), buku({ id: "k2" })] }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.bukuTanpaPasangan).toMatchObject({ ok: false, jumlah: 1 });
    expect(v.syarat.bukuTanpaPasangan.baris.map((b) => b.id)).toEqual(["k2"]);
    expect(v.syarat.bukuTanpaPasangan.baris[0]!.jenis).toBe("biasa");
  });

  it("baris buku dihitung pada TANGGAL ASAL, bukan hari buku", () => {
    const maju = buku({ id: "k3", businessDate: "2026-11-03", tanggalAsal: "2026-10-28" });
    expect(periksaTutupBulan(lengkap({ buku: [maju] })).syarat.bukuTanpaPasangan.jumlah).toBe(1);
    const nov = periksaTutupBulan({ ...lengkap({ buku: [maju] }), bulan: "2026-11", hariTertutup: hariDalamBulan("2026-11"), impor: [] });
    expect(nov.syarat.bukuTanpaPasangan.ok).toBe(true);
  });

  it("baris saldo pembuka di rekening bank ⇒ TIDAK dihitung tanpa pasangan", () => {
    const v = periksaTutupBulan(lengkap({ buku: [buku({ saldoAwal: true, businessDate: "2026-10-01", amountSen: 12_000_000_00 })] }));
    expect(v.syarat.bukuTanpaPasangan.ok).toBe(true);
  });

  it("baris void tidak dihitung", () => {
    expect(periksaTutupBulan(lengkap({ buku: [buku({ void: true })] })).boleh).toBe(true);
  });

  it("🔴 baris batal + pembalik MAJU-nya (tertaut kelompok, Σ Rp 0) ⇒ tidak dihitung — juga bila pembaliknya di bulan berikut", () => {
    const asli = buku({ id: "a", businessDate: "2026-10-03", amountSen: -75_000_00, lahirDariCocokId: G });
    const balik = buku({
      id: "b",
      businessDate: "2026-11-04",
      tanggalAsal: "2026-10-03",
      amountSen: 75_000_00,
      alasanMaju: "ADJ-FWD-REVERSAL",
      lahirDariCocokId: G,
    });
    expect(periksaTutupBulan(lengkap({ buku: [asli, balik] })).syarat.bukuTanpaPasangan.ok).toBe(true);
    // Pembalik di luar bulan (tanggal asal asli 20 Okt, hari bukunya 3 Nov ⇒ pembalik bertanggal asal 3 Nov).
    const asli2 = buku({ id: "a2", businessDate: "2026-11-03", tanggalAsal: "2026-10-20", lahirDariCocokId: G });
    const balik2 = buku({ id: "b2", businessDate: "2026-11-09", tanggalAsal: "2026-11-03", amountSen: 75_000_00, alasanMaju: "ADJ-FWD-REVERSAL", lahirDariCocokId: G });
    expect(periksaTutupBulan(lengkap({ buku: [asli2, balik2] })).syarat.bukuTanpaPasangan.ok).toBe(true);
  });

  it("pasangan antar unit yang dibalik (tertaut pasangan_uuid, Σ Rp 0) ⇒ tidak dihitung", () => {
    const asli = buku({ id: "a", amountSen: 10_000_000_00, pasanganUuid: P, categoryLabel: "Hutang Piutang" });
    const balik = buku({ id: "b", businessDate: "2026-11-02", tanggalAsal: "2026-10-10", amountSen: -10_000_000_00, alasanMaju: "ADJ-FWD-REVERSAL", pasanganUuid: P });
    expect(periksaTutupBulan(lengkap({ buku: [asli, balik] })).syarat.bukuTanpaPasangan.ok).toBe(true);
  });

  it("🔴 DAYA-BEDA: pembalik yang TIDAK meniadakan (nominal beda / tautan beda / rekening beda) ⇒ keduanya tetap dihitung", () => {
    const asli = buku({ id: "a", lahirDariCocokId: G });
    const balikBeda = buku({ id: "b", amountSen: 70_000_00, alasanMaju: "ADJ-FWD-REVERSAL", lahirDariCocokId: G });
    expect(periksaTutupBulan(lengkap({ buku: [asli, balikBeda] })).syarat.bukuTanpaPasangan.jumlah).toBe(2);
    const balikLepas = buku({ id: "b", amountSen: 75_000_00, alasanMaju: "ADJ-FWD-REVERSAL", lahirDariCocokId: null });
    expect(periksaTutupBulan(lengkap({ buku: [asli, balikLepas] })).syarat.bukuTanpaPasangan.jumlah).toBe(2);
    const balikRekLain = buku({ id: "b", accountId: BCA2, amountSen: 75_000_00, alasanMaju: "ADJ-FWD-REVERSAL", lahirDariCocokId: G });
    expect(
      periksaTutupBulan(lengkap({ rekening: [rek(), rek({ id: BCA2 })], buku: [asli, balikRekLain] })).syarat.bukuTanpaPasangan.jumlah,
    ).toBe(2);
    // Dua baris biasa yang kebetulan saling meniadakan BUKAN pasangan batal.
    const plus = buku({ id: "c", amountSen: 75_000_00, lahirDariCocokId: G });
    expect(periksaTutupBulan(lengkap({ buku: [asli, plus] })).syarat.bukuTanpaPasangan.jumlah).toBe(2);
  });

  it("satu pembalik meniadakan SATU asli saja", () => {
    const a1 = buku({ id: "a1", lahirDariCocokId: G });
    const a2 = buku({ id: "a2", lahirDariCocokId: G });
    const b = buku({ id: "b", amountSen: 75_000_00, alasanMaju: "ADJ-FWD-REVERSAL", lahirDariCocokId: G });
    const v = periksaTutupBulan(lengkap({ buku: [a1, a2, b] }));
    expect(v.syarat.bukuTanpaPasangan.jumlah).toBe(1);
  });

  it("⚠️ kaki antar unit tanpa mutasi bank tetap MENAHAN, dan dikenali di daftar (isu terbuka U11)", () => {
    const kaki = buku({ id: "kaki", amountSen: 25_000_000_00, pasanganUuid: P, categoryLabel: "Hutang Piutang", keterangan: "Antar unit dari Kotabaru" });
    const v = periksaTutupBulan(lengkap({ buku: [kaki] }));
    expect(v.boleh).toBe(false);
    expect(v.syarat.bukuTanpaPasangan.baris[0]!.jenis).toBe("kaki_antar_unit");
    expect(v.syarat.bukuTanpaPasangan.nKakiAntarUnit).toBe(1);
  });

  it("beberapa syarat gagal ⇒ alasan per syarat, urut hari · penampung · rekening koran · buku", () => {
    const v = periksaTutupBulan(
      lengkap({
        hariTertutup: [],
        parkir: [parkir()],
        rekening: [rek({ rekeningKoranAktif: false })],
        buku: [buku()],
      }),
    );
    expect(v.alasan).toHaveLength(4);
    expect(v.alasan[0]).toMatch(/31 hari/);
    expect(v.alasan[1]).toMatch(/penampung/i);
    expect(v.alasan[2]).toMatch(/rekening koran/i);
    expect(v.alasan[3]).toMatch(/tanpa pasangan/);
  });

  it("bulan tak sah ⇒ melempar (pemanggil memvalidasi lebih dulu)", () => {
    expect(() => periksaTutupBulan(lengkap({ bulan: "2026-13" }))).toThrow();
  });
});
