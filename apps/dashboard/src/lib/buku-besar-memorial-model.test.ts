import { describe, expect, it } from "vitest";
import {
  barisPembalikan,
  periksaMemorial,
  periksaPersetujuan,
  periksaSaldoAwal,
  posKasBank,
  saldoDariNilaiNormal,
} from "./buku-besar-memorial-model";
import type { Role } from "./auth-context";
import { canSetujuiMemorial } from "./keuangan-wewenang";
import type { Pos } from "./pos-model";

/**
 * Masukan HoF buku besar (rencana 2026-11-02 K6 U9; R8, R9, AE10, KD13).
 * Angka ILUSTRASI.
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
  pos("1102", "aset", { kodeInduk: "1100" }),
  pos("1103", "aset", { kodeInduk: "1100", kliring: true }),
  pos("1110", "aset", { induk: true }),
  pos("1111", "aset", { kodeInduk: "1110", unitId: 2, cashAccountId: "a-bank", id: "pu-1" }),
  pos("1121", "aset"),
  pos("1131", "aset"),
  pos("1132", "aset"),
  pos("1190", "aset", { kliring: true }),
  pos("1199", "aset", { kliring: true }),
  pos("1510", "aset"),
  pos("1590", "aset", { pengurang: true }),
  pos("2110", "kewajiban"),
  pos("2300", "kewajiban"),
  pos("3100", "modal"),
  pos("3200", "modal"),
  pos("3900", "modal", { sistem: true }),
  pos("4200", "pendapatan"),
  pos("5200", "beban"),
  pos("5600", "beban"),
];

const JT = 100_000_000; // Rp 1 juta dalam sen

describe("saldo awal pos (R9, AE10)", () => {
  const kas = [
    { posKode: "1101", saldoSen: 50 * JT },
    { posKode: "1111", saldoSen: 150 * JT },
  ];

  it("🔴 AE10: aset Rp 1.000 juta vs kewajiban + modal Rp 990 juta → ditolak dengan beda Rp 10 juta", () => {
    const r = periksaSaldoAwal({
      ketik: [
        { posKode: "1510", nilaiSen: 800 * JT },
        { posKode: "2110", nilaiSen: 290 * JT },
        { posKode: "3100", nilaiSen: 700 * JT },
      ],
      kas,
      daftar: DAFTAR,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.bedaSen).toBe(10 * JT);
    expect(r.error).toContain("Rp 10.000.000");
    expect(r.error).toContain("Rp 1.000.000.000");
    expect(r.error).toContain("Rp 990.000.000");
  });

  it("seimbang → baris bertanda: aset debet (+), kewajiban/modal kredit (−), pengurang aset kredit; kas dari akun", () => {
    const r = periksaSaldoAwal({
      ketik: [
        { posKode: "1510", nilaiSen: 900 * JT },
        { posKode: "1590", nilaiSen: 100 * JT },
        { posKode: "2110", nilaiSen: 300 * JT },
        { posKode: "3100", nilaiSen: 700 * JT },
      ],
      kas,
      daftar: DAFTAR,
    });
    expect(r).toEqual({
      ok: true,
      baris: [
        { posKode: "1101", saldoSen: 50 * JT, sumber: "akun_kas" },
        { posKode: "1111", saldoSen: 150 * JT, sumber: "akun_kas" },
        { posKode: "1510", saldoSen: 900 * JT, sumber: "akuntan" },
        { posKode: "1590", saldoSen: -100 * JT, sumber: "akuntan" },
        { posKode: "2110", saldoSen: -300 * JT, sumber: "akuntan" },
        { posKode: "3100", saldoSen: -700 * JT, sumber: "akuntan" },
      ],
    });
  });

  it("tidak menambah angka penyeimbang: pos yang tak diketik tetap tak ada", () => {
    const r = periksaSaldoAwal({ ketik: [{ posKode: "3100", nilaiSen: 200 * JT }], kas, daftar: DAFTAR });
    expect(r.ok && r.baris.map((b) => b.posKode)).toEqual(["1101", "1111", "3100"]);
  });

  it("nol yang diisi untuk 1131/1132 tetap tersimpan (saldo awal diketahui); nol pos lain dibuang", () => {
    const r = periksaSaldoAwal({
      ketik: [
        { posKode: "1131", nilaiSen: 0 },
        { posKode: "1132", nilaiSen: 0 },
        { posKode: "2110", nilaiSen: 0 },
        { posKode: "3100", nilaiSen: 200 * JT },
      ],
      kas,
      daftar: DAFTAR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kode = r.baris.map((b) => b.posKode);
    expect(kode).toContain("1131");
    expect(kode).toContain("1132");
    expect(kode).not.toContain("2110");
    expect(r.baris.find((b) => b.posKode === "1132")?.saldoSen).toBe(0);
  });

  it("kas & bank tidak boleh diketik — dibaca dari saldo pembuka rekening", () => {
    for (const k of ["1101", "1102", "1111"]) {
      const r = periksaSaldoAwal({ ketik: [{ posKode: k, nilaiSen: JT }], kas: [], daftar: DAFTAR });
      expect(r.ok, k).toBe(false);
    }
  });

  it("pos laba-rugi, 3900, pos induk, dan pos tak dikenal ditolak", () => {
    for (const k of ["4200", "5200", "3900", "1100", "1999"]) {
      const r = periksaSaldoAwal({ ketik: [{ posKode: k, nilaiSen: JT }], kas: [], daftar: DAFTAR });
      expect(r.ok, k).toBe(false);
    }
  });

  it("pos yang diketik dua kali ditolak", () => {
    const r = periksaSaldoAwal({
      ketik: [
        { posKode: "3100", nilaiSen: JT },
        { posKode: "3100", nilaiSen: JT },
      ],
      kas: [{ posKode: "1101", saldoSen: 2 * JT }],
      daftar: DAFTAR,
    });
    expect(r.ok).toBe(false);
  });

  it("saldoDariNilaiNormal & posKasBank", () => {
    expect(saldoDariNilaiNormal(pos("1131", "aset"), 5)).toBe(5);
    expect(saldoDariNilaiNormal(pos("1590", "aset", { pengurang: true }), 5)).toBe(-5);
    expect(saldoDariNilaiNormal(pos("2300", "kewajiban"), 5)).toBe(-5);
    expect(posKasBank(DAFTAR.find((p) => p.kode === "1111")!)).toBe(true);
    expect(posKasBank(DAFTAR.find((p) => p.kode === "1103")!)).toBe(false);
  });
});

describe("jurnal memorial (R8, KD13)", () => {
  const dasar = { tanggal: "2026-10-31", alasan: "Penyusutan Oktober", bukti: "Lampiran akuntan 03/X" };
  const dk = (posKode: string, debetSen: number, kreditSen = 0) => ({ posKode, debetSen, kreditSen });

  it("🔴 tidak seimbang → ditolak", () => {
    const r = periksaMemorial({ ...dasar, baris: [dk("5600", 15_000_000), dk("1590", 0, 14_000_000)] }, DAFTAR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tidak seimbang/);
  });

  it("🔴 Rp 150.000 → menunggu persetujuan", () => {
    const r = periksaMemorial({ ...dasar, baris: [dk("5600", 15_000_000), dk("1590", 0, 15_000_000)] }, DAFTAR);
    expect(r).toMatchObject({ ok: true, status: "menunggu", totalSen: 15_000_000 });
  });

  it("🔴 Rp 50.000 menyentuh 1199 → menunggu persetujuan", () => {
    const r = periksaMemorial({ ...dasar, baris: [dk("1199", 5_000_000), dk("2110", 0, 5_000_000)] }, DAFTAR);
    expect(r).toMatchObject({ ok: true, status: "menunggu" });
  });

  it("setiap pos kliring persetujuan (1103, 1190, 1198, 1199, 5130) → menunggu", () => {
    const daftar = [...DAFTAR, pos("1198", "aset", { kliring: true }), pos("5130", "beban", { sistem: true })];
    for (const k of ["1103", "1190", "1198", "1199", "5130"]) {
      const r = periksaMemorial({ ...dasar, baris: [dk(k, 1_000_000), dk("3100", 0, 1_000_000)] }, daftar);
      expect(r.ok && r.status, k).toBe("menunggu");
    }
  });

  it("🔴 Rp 50.000 tanpa pos kliring → aktif langsung", () => {
    const r = periksaMemorial({ ...dasar, baris: [dk("5200", 5_000_000), dk("2300", 0, 5_000_000)] }, DAFTAR);
    expect(r).toMatchObject({ ok: true, status: "aktif", totalSen: 5_000_000 });
  });

  it("tepat Rp 100.000 → aktif (ambang: LEBIH dari Rp 100.000)", () => {
    const r = periksaMemorial({ ...dasar, baris: [dk("5200", 10_000_000), dk("2300", 0, 10_000_000)] }, DAFTAR);
    expect(r.ok && r.status).toBe("aktif");
    const r2 = periksaMemorial({ ...dasar, baris: [dk("5200", 10_000_001), dk("2300", 0, 10_000_001)] }, DAFTAR);
    expect(r2.ok && r2.status).toBe("menunggu");
  });

  it("KTD11: pelanggan bayar ke rekening unit lain — debet 1199 kredit 2102 menunggu persetujuan", () => {
    const daftar = [...DAFTAR, pos("2102", "kewajiban")];
    const r = periksaMemorial({ ...dasar, baris: [dk("1199", 2_000_000), dk("2102", 0, 2_000_000)] }, daftar);
    expect(r.ok && r.status).toBe("menunggu");
  });

  it("alasan & bukti wajib; tanggal sebelum buku besar ditolak; pos induk/3900/tak dikenal ditolak", () => {
    const b = [dk("5200", 1_000), dk("2300", 0, 1_000)];
    expect(periksaMemorial({ ...dasar, alasan: " ", baris: b }, DAFTAR).ok).toBe(false);
    expect(periksaMemorial({ ...dasar, bukti: "", baris: b }, DAFTAR).ok).toBe(false);
    expect(periksaMemorial({ ...dasar, tanggal: "2026-09-30", baris: b }, DAFTAR).ok).toBe(false);
    expect(periksaMemorial({ ...dasar, tanggal: "31-10-2026", baris: b }, DAFTAR).ok).toBe(false);
    for (const k of ["1100", "3900", "1999"]) {
      expect(periksaMemorial({ ...dasar, baris: [dk(k, 1_000), dk("2300", 0, 1_000)] }, DAFTAR).ok, k).toBe(false);
    }
  });

  it("baris dua sisi, nol, pecahan sen, atau kurang dari dua baris ditolak", () => {
    expect(periksaMemorial({ ...dasar, baris: [dk("5200", 1_000, 1_000), dk("2300", 0, 0)] }, DAFTAR).ok).toBe(false);
    expect(periksaMemorial({ ...dasar, baris: [dk("5200", 10.5), dk("2300", 0, 10.5)] }, DAFTAR).ok).toBe(false);
    expect(periksaMemorial({ ...dasar, baris: [dk("5200", 1_000)] }, DAFTAR).ok).toBe(false);
  });

  it("pembalikan menukar sisi setiap baris", () => {
    expect(barisPembalikan([dk("5600", 7), dk("1590", 0, 7)])).toEqual([dk("5600", 0, 7), dk("1590", 7, 0)]);
  });
});

describe("persetujuan memorial (R8, KD13)", () => {
  const menunggu = { status: "menunggu" as const, diusulkanOleh: 15 };
  const aktor = (userId: number, role: Role, email: string | null = null) => ({
    userId,
    bolehSetujui: canSetujuiMemorial({ role, email }),
  });

  it("🔴 pengusul menyetujui memorialnya sendiri → ditolak, walau ia super admin", () => {
    expect(periksaPersetujuan(menunggu, aktor(15, "super_admin", null))).toMatch(/sendiri/);
  });

  it("Direksi lain → boleh", () => {
    expect(periksaPersetujuan(menunggu, aktor(3, "direksi", null))).toBeNull();
  });

  it("HoF / staf Keuangan → ditolak; memorial yang tidak menunggu → ditolak", () => {
    expect(periksaPersetujuan(menunggu, aktor(3, "admin_perusahaan", "hof@solagroup.co"))).not.toBeNull();
    expect(periksaPersetujuan(menunggu, aktor(3, "keuangan", null))).not.toBeNull();
    expect(periksaPersetujuan({ ...menunggu, status: "aktif" }, aktor(3, "direksi", null))).toMatch(/tidak menunggu/);
  });
});
