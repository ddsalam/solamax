import { describe, expect, it } from "vitest";
import { bukuBesarAktif, periksaBukuBesar, type MasukanCekBukuBesar } from "./buku-besar-cek";

/**
 * Pemeriksaan buku besar saat tutup bulan (rencana 2026-11-02 K6 U11; R33,
 * R11, AE9). Angka ILUSTRATIF, dalam sen. Nilai harapan ditulis tangan dari
 * aturan R33, bukan dihitung ulang dengan kode yang diuji.
 */

const RP = (rupiah: number) => rupiah * 100;
const BRI = "22222222-2222-4222-8222-222222222222";

/**
 * Buku seimbang Oktober 2026: saldo awal kas Rp 10 jt (1101) lawan modal
 * (3100); bank BRI Rp 50 jt lawan modal. Semua pos kliring nol.
 */
function dasar(): MasukanCekBukuBesar {
  return {
    bulan: "2026-10",
    saldoAwal: { jumlahBaris: 3, totalSen: 0 },
    adaTutupBukuBesar: false,
    saldoPos: [
      { posKode: "1101", saldoSen: RP(10_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ],
    bank: [{ posKode: "1111", accountId: BRI, nama: "Bank BRI - 0001", saldoRekeningKoranSen: RP(50_000_000) }],
    kliring: [],
    temuanHargaBeli: [],
  };
}

const aktif = (v: ReturnType<typeof periksaBukuBesar>) => {
  if (!v.aktif) throw new Error("diharapkan aktif");
  return v;
};

describe("bukuBesarAktif — sejak bulan pertama bersaldo awal lengkap", () => {
  it("saldo awal kosong ⇒ tidak aktif", () => {
    expect(bukuBesarAktif({ bulan: "2026-10", saldoAwal: { jumlahBaris: 0, totalSen: 0 }, adaTutupBukuBesar: false })).toBe(false);
  });

  it("saldo awal tidak seimbang ⇒ tidak aktif", () => {
    expect(bukuBesarAktif({ bulan: "2026-11", saldoAwal: { jumlahBaris: 4, totalSen: RP(10_000) }, adaTutupBukuBesar: false })).toBe(false);
  });

  it("lengkap & seimbang ⇒ aktif untuk bulan itu dan sesudahnya", () => {
    const s = { jumlahBaris: 4, totalSen: 0 };
    expect(bukuBesarAktif({ bulan: "2026-10", saldoAwal: s, adaTutupBukuBesar: false })).toBe(true);
    expect(bukuBesarAktif({ bulan: "2027-02", saldoAwal: s, adaTutupBukuBesar: false })).toBe(true);
  });

  it("sebelum buku besar dimulai (Sep 2026) ⇒ tidak pernah aktif", () => {
    expect(bukuBesarAktif({ bulan: "2026-09", saldoAwal: { jumlahBaris: 4, totalSen: 0 }, adaTutupBukuBesar: true })).toBe(false);
  });

  it("🔴 sudah ada bulan ditutup dengan buku besar ⇒ tetap aktif walau saldo awal kini tak lengkap (gagal tertutup)", () => {
    expect(bukuBesarAktif({ bulan: "2026-12", saldoAwal: { jumlahBaris: 0, totalSen: 0 }, adaTutupBukuBesar: true })).toBe(true);
  });
});

describe("periksaBukuBesar — R33", () => {
  it("buku bersih ⇒ boleh, setiap cek OK", () => {
    const v = aktif(periksaBukuBesar(dasar()));
    expect(v.boleh).toBe(true);
    expect(v.alasan).toEqual([]);
    expect(v.cek.neraca).toMatchObject({ ok: true, debetSen: RP(60_000_000), kreditSen: RP(60_000_000) });
  });

  it("🔴 saldo awal belum lengkap ⇒ tidak aktif, cek dilewati dengan alasannya", () => {
    const v = periksaBukuBesar({ ...dasar(), saldoAwal: { jumlahBaris: 0, totalSen: 0 }, saldoPos: [] });
    expect(v.aktif).toBe(false);
    expect(!v.aktif && v.alasanTidakAktif).toMatch(/pemeriksaan buku besar belum aktif — saldo awal belum lengkap/i);
  });

  it("🔴 Covers AE9: BRI buku besar Rp 50.000.000 vs rekening koran Rp 50.250.000 ⇒ menolak, tanpa angka penyeimbang", () => {
    const m = dasar();
    m.bank = [{ ...m.bank[0]!, saldoRekeningKoranSen: RP(50_250_000) }];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.cek.bank.ok).toBe(false);
    expect(v.cek.bank.rekening[0]).toMatchObject({
      posKode: "1111",
      saldoBukuSen: RP(50_000_000),
      saldoRekeningKoranSen: RP(50_250_000),
      ok: false,
    });
    expect(v.alasan.join(" ")).toMatch(/Bank BRI - 0001/);
    expect(v.alasan.join(" ")).toMatch(/50\.000\.000/);
    expect(v.alasan.join(" ")).toMatch(/50\.250\.000/);
  });

  it("sub-pos bank tanpa rekening koran aktif tetapi bersaldo ⇒ menolak; bersaldo nol ⇒ OK", () => {
    const m = dasar();
    m.bank = [{ ...m.bank[0]!, saldoRekeningKoranSen: null }];
    expect(aktif(periksaBukuBesar(m)).cek.bank.ok).toBe(false);
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(60_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    expect(aktif(periksaBukuBesar(m)).cek.bank.ok).toBe(true);
  });

  it("🔴 1190 berisi butir dalam perjalanan 2 hari ⇒ lolos dengan butir itu tercantum", () => {
    const m = dasar();
    // Kas Besar → BRI: kaki kas 31 Okt (1190 debet), kaki bank 2 Nov (1190 kredit).
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(5_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "1190", saldoSen: RP(5_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    m.kliring = [
      { jurnalId: "j1", posKode: "1190", tanggalEfektif: "2026-10-31", netSen: RP(5_000_000), keterangan: "Setoran ke Bank BRI" },
      { jurnalId: "j2", posKode: "1190", tanggalEfektif: "2026-11-02", netSen: -RP(5_000_000), keterangan: "Pindah Buku dari Kas Besar" },
    ];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(true);
    expect(v.cek.perjalanan.ok).toBe(true);
    const p1190 = v.cek.perjalanan.pos.find((p) => p.posKode === "1190")!;
    expect(p1190.butir).toEqual([
      {
        jurnalId: "j1",
        posKode: "1190",
        tanggalEfektif: "2026-10-31",
        netSen: RP(5_000_000),
        keterangan: "Setoran ke Bank BRI",
        tanggalPasangan: "2026-11-02",
      },
    ]);
    expect(p1190.sisaSen).toBe(0);
  });

  it("🔴 1190 bersisa tetapi pasangannya jatuh 4 Nov (di luar 0–3 hari) ⇒ menolak", () => {
    const m = dasar();
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(5_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "1190", saldoSen: RP(5_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    m.kliring = [
      { jurnalId: "j1", posKode: "1190", tanggalEfektif: "2026-10-31", netSen: RP(5_000_000), keterangan: "Setoran ke Bank BRI" },
      { jurnalId: "j2", posKode: "1190", tanggalEfektif: "2026-11-04", netSen: -RP(5_000_000), keterangan: "Pindah Buku dari Kas Besar" },
    ];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.cek.perjalanan.pos.find((p) => p.posKode === "1190")).toMatchObject({ sisaSen: RP(5_000_000), butir: [] });
    expect(v.alasan.join(" ")).toMatch(/1190/);
  });

  it("🔴 1190 bersisa tanpa pasangan sama sekali ⇒ menolak", () => {
    const m = dasar();
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(9_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "1190", saldoSen: RP(1_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    m.kliring = [{ jurnalId: "j1", posKode: "1190", tanggalEfektif: "2026-10-20", netSen: RP(1_000_000), keterangan: "Pindah Buku" }];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.cek.perjalanan.ok).toBe(false);
  });

  it("pasangan hanya menjelaskan SEBAGIAN sisa ⇒ menolak, butir yang sah tetap tercantum", () => {
    const m = dasar();
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(3_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "1190", saldoSen: RP(7_000_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    m.kliring = [
      { jurnalId: "j0", posKode: "1190", tanggalEfektif: "2026-10-12", netSen: RP(2_000_000), keterangan: "Pindah Buku tanpa pasangan" },
      { jurnalId: "j1", posKode: "1190", tanggalEfektif: "2026-10-31", netSen: RP(5_000_000), keterangan: "Setoran ke Bank BRI" },
      { jurnalId: "j2", posKode: "1190", tanggalEfektif: "2026-11-01", netSen: -RP(5_000_000), keterangan: "Pindah Buku dari Kas Besar" },
    ];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    const p = v.cek.perjalanan.pos.find((x) => x.posKode === "1190")!;
    expect(p.butir.map((b) => b.jurnalId)).toEqual(["j1"]);
    expect(p.sisaSen).toBe(RP(2_000_000));
  });

  it("1103 bersisa bukan butir dalam perjalanan ⇒ menolak", () => {
    const m = dasar();
    m.saldoPos = [...dasar().saldoPos, { posKode: "1103", saldoSen: RP(25_000) }, { posKode: "5130", saldoSen: -RP(25_000) }];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.alasan.join(" ")).toMatch(/1103/);
  });

  it("🔴 1198 ≠ 0 ⇒ menolak", () => {
    const m = dasar();
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(9_900_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "1198", saldoSen: RP(100_000) },
      { posKode: "3100", saldoSen: -RP(60_000_000) },
    ];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.cek.kliringNol.ok).toBe(false);
    expect(v.cek.kliringNol.pos).toEqual([
      { posKode: "1198", saldoSen: RP(100_000) },
      { posKode: "1199", saldoSen: 0 },
    ]);
    expect(v.alasan.join(" ")).toMatch(/1198/);
  });

  it("1199 ≠ 0 ⇒ menolak", () => {
    const m = dasar();
    m.saldoPos = [...dasar().saldoPos, { posKode: "1199", saldoSen: -RP(300_000) }, { posKode: "1129", saldoSen: RP(300_000) }];
    expect(aktif(periksaBukuBesar(m)).boleh).toBe(false);
  });

  it("🔴 neraca saldo tidak seimbang ⇒ menolak dan menyebut bedanya", () => {
    const m = dasar();
    m.saldoPos = [
      { posKode: "1101", saldoSen: RP(10_000_000) },
      { posKode: "1111", saldoSen: RP(50_000_000) },
      { posKode: "3100", saldoSen: -RP(59_000_000) },
    ];
    const v = aktif(periksaBukuBesar({ ...m, saldoAwal: { jumlahBaris: 3, totalSen: 0 } }));
    expect(v.boleh).toBe(false);
    expect(v.cek.neraca).toMatchObject({ ok: false, debetSen: RP(60_000_000), kreditSen: RP(59_000_000) });
    expect(v.alasan.join(" ")).toMatch(/1\.000\.000/);
  });

  it("🔴 R11: temuan 'harga beli belum diisi' ⇒ menolak dengan produk & tanggalnya", () => {
    const m = dasar();
    m.temuanHargaBeli = [{ tanggal: "2026-10-14", produk: "PERTALITE", pesan: "Harga beli PERTALITE belum diisi untuk 2026-10-14" }];
    const v = aktif(periksaBukuBesar(m));
    expect(v.boleh).toBe(false);
    expect(v.cek.hargaBeli).toMatchObject({ ok: false, diperiksa: true });
    expect(v.alasan.join(" ")).toMatch(/harga beli belum diisi/i);
    expect(v.alasan.join(" ")).toMatch(/PERTALITE/);
  });

  it("harga beli belum diperiksa (halaman, tanpa pembentukan ulang) ⇒ tidak menahan, ditandai belum diperiksa", () => {
    const v = aktif(periksaBukuBesar({ ...dasar(), temuanHargaBeli: null }));
    expect(v.boleh).toBe(true);
    expect(v.cek.hargaBeli).toMatchObject({ ok: true, diperiksa: false });
  });

  it("🔴 aktif karena bulan sebelumnya ditutup dengan buku besar, saldo awal kini tak lengkap ⇒ menolak", () => {
    const v = aktif(periksaBukuBesar({ ...dasar(), bulan: "2026-11", saldoAwal: { jumlahBaris: 0, totalSen: 0 }, adaTutupBukuBesar: true }));
    expect(v.boleh).toBe(false);
    expect(v.cek.saldoAwalPos.ok).toBe(false);
  });
});
