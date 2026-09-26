import { describe, expect, it } from "vitest";
import type { BarisHargaBeli } from "./keuangan-harga-model";
import {
  AMBANG,
  nadaTerburuk,
  rakitPantau,
  ringkasPelaku,
  temuanKedisiplinan,
  temuanKesiapan,
  urutkanKejadian,
  type FaktaKedisiplinan,
} from "./keuangan-pantau-model";
import type { AkunPantau, BahanPantau, KejadianPantau } from "./keuangan-pantau-queries";

const akun = (kind: AkunPantau["kind"], adaSaldoAwal = true, active = true): AkunPantau => ({
  unitId: 1,
  nama: `${kind}-x`,
  kind,
  active,
  adaSaldoAwal,
  saldoAwalSementara: false,
});

const harga = (nama: string, p2Due: boolean, p2StaleDays: number | null = null): BarisHargaBeli => ({
  productKey: nama,
  nama,
  hargaBeli: 1,
  hargaJual: 2,
  margin: 1,
  berlakuSejak: "2026-08-01",
  p1Aktif: false,
  p2Due,
  p2StaleDays,
});

const fakta = (f: Partial<FaktaKedisiplinan> = {}): FaktaKedisiplinan => ({
  hariPenjualan: 14,
  hariBermutasi: 14,
  mutasiTerakhir: "2026-09-25",
  setoranN: 0,
  setoranRp: 0,
  setoranTertua: null,
  ditutup: 14,
  dibukaBelumDitutup: 0,
  diLuarToleransi: 0,
  ...f,
});

describe("kesiapan", () => {
  it("unit lengkap ⇒ semua hijau", () => {
    const t = temuanKesiapan([akun("kas"), akun("bank"), akun("edc_penampungan")], [], [harga("PERTALITE", false)]);
    expect(nadaTerburuk(t)).toBe("hijau");
  });

  it("keadaan enam unit 26-Sep: hanya bank, tanpa saldo pembuka ⇒ merah dengan akun yang DISEBUT", () => {
    const t = temuanKesiapan([akun("bank", false)], [], []);
    const a = t.find((x) => x.kode === "akun")!;
    expect(a.nada).toBe("merah");
    expect(a.rinci).toContain("Kas Besar");
    expect(a.rinci).toContain("EDC Penampungan");
    expect(t.find((x) => x.kode === "saldo_awal")!.nada).toBe("merah");
  });

  it("akun NONAKTIF tidak dihitung sebagai punya", () => {
    const t = temuanKesiapan([akun("bank"), akun("kas", true, false), akun("edc_penampungan")], [], []);
    expect(t.find((x) => x.kode === "akun")!.rinci).toContain("Kas Besar");
  });

  it("P2 dari Layar 3 menghasilkan kuning yang menyebut produk & umurnya", () => {
    const t = temuanKesiapan([akun("kas"), akun("bank"), akun("edc_penampungan")], [], [
      harga("DEXLITE", true, 24),
      harga("PERTALITE", false),
    ]);
    const h = t.find((x) => x.kode === "harga_basi")!;
    expect(h.nada).toBe("kuning");
    expect(h.rinci).toContain("DEXLITE (harga jual berubah 24 hari lalu)");
    expect(h.rinci).not.toContain("PERTALITE");
  });

  it("produk TERJUAL tanpa harga ⇒ merah", () => {
    const t = temuanKesiapan([akun("kas"), akun("bank"), akun("edc_penampungan")], [{ nama: "SOLAR", hari: 3 }], []);
    expect(t.find((x) => x.kode === "harga_kosong")!.nada).toBe("merah");
    // Hijau "harga terkini" TIDAK boleh muncul bersamaan dengan merah harga kosong.
    expect(t.find((x) => x.kode === "harga_basi")).toBeUndefined();
  });
});

describe("kedisiplinan", () => {
  it("unit yang dikerjakan penuh ⇒ hijau", () => {
    expect(nadaTerburuk(temuanKedisiplinan(fakta(), "2026-09-25"))).toBe("hijau");
  });

  it("buku kas tak pernah diisi ⇒ merah dan kalimatnya berkata 'belum pernah'", () => {
    const t = temuanKedisiplinan(fakta({ hariBermutasi: 0, mutasiTerakhir: null }), "2026-09-25");
    const b = t.find((x) => x.kode === "buku_kas")!;
    expect(b.nada).toBe("merah");
    expect(b.rinci).toContain("Belum pernah");
  });

  it("buku kas bolong di bawah ambang ⇒ kuning", () => {
    const n = Math.floor(14 * AMBANG.porsiBukuKuning) - 1;
    const t = temuanKedisiplinan(fakta({ hariBermutasi: n }), "2026-09-25");
    expect(t.find((x) => x.kode === "buku_kas")!.nada).toBe("kuning");
  });

  it("setoran tertunda: muda ⇒ kuning, tua ⇒ merah (ambang bernama)", () => {
    const muda = temuanKedisiplinan(fakta({ setoranN: 1, setoranRp: 5, setoranTertua: "2026-09-24" }), "2026-09-25");
    expect(muda.find((x) => x.kode === "setoran")!.nada).toBe("kuning");
    const tua = temuanKedisiplinan(fakta({ setoranN: 1, setoranRp: 5, setoranTertua: "2026-09-12" }), "2026-09-25");
    expect(tua.find((x) => x.kode === "setoran")!.nada).toBe("merah");
  });

  it("🔴 tutup hari dihitung terhadap HARI PENJUALAN, bukan baris day_close (§10.15)", () => {
    // Hari yang tak pernah dibuka tak punya baris. Kalau penyebutnya jumlah
    // baris, unit yang tak pernah membuka satu hari pun terbaca "0 dari 0" —
    // hijau-tanpa-subjek.
    const t = temuanKedisiplinan(fakta({ ditutup: 0 }), "2026-09-25");
    const d = t.find((x) => x.kode === "tutup_hari")!;
    expect(d.nada).toBe("merah");
    expect(d.rinci).toContain("14 hari belum ditutup");
  });
});

describe("pelaku", () => {
  it("porsi pembatalan hanya dinilai bila tulisannya cukup", () => {
    const sedikit = ringkasPelaku([
      { userId: 1, email: "a@x", nama: null, jenis: "mutasi kas", n: 2, terakhir: "2026-09-20 10:00" },
      { userId: 1, email: "a@x", nama: null, jenis: "pembatalan", n: 2, terakhir: "2026-09-20 11:00" },
    ]);
    expect(sedikit[0]!.porsiBatal).toBeNull();
    expect(sedikit[0]!.perhatian).toBe(false);

    const banyak = ringkasPelaku([
      { userId: 2, email: "b@x", nama: "B", jenis: "mutasi kas", n: 20, terakhir: "2026-09-20 10:00" },
      { userId: 2, email: "b@x", nama: "B", jenis: "pembatalan", n: 6, terakhir: "2026-09-21 09:00" },
    ]);
    expect(banyak[0]!.porsiBatal).toBeCloseTo(0.3);
    expect(banyak[0]!.perhatian).toBe(true);
    expect(banyak[0]!.terakhir).toBe("2026-09-21 09:00");
    expect(banyak[0]!.label).toBe("B (b@x)");
  });
});

describe("kejadian & rakitan", () => {
  const k = (jenis: KejadianPantau["jenis"], waktu: string): KejadianPantau => ({
    unitId: 1,
    jenis,
    waktu,
    tanggalBisnis: null,
    pelaku: null,
    keterangan: "",
    nominal: null,
    hariTerlambat: null,
  });

  it("merah dulu, lalu yang terbaru", () => {
    const u = urutkanKejadian([
      k("mutasi_terlambat", "2026-09-25 10:00"),
      k("batal_saldo_awal", "2026-09-20 10:00"),
      k("batal_harga_beli", "2026-09-24 10:00"),
    ]);
    expect(u.map((x) => x.jenis)).toEqual(["batal_saldo_awal", "mutasi_terlambat", "batal_harga_beli"]);
  });

  it("unit tanpa baris apa pun tetap MUNCUL — dan merah, bukan hilang", () => {
    const bahan: BahanPantau = {
      dari: "2026-09-12",
      sampai: "2026-09-25",
      hariPenjualan: new Map([[7, 14]]),
      edc: new Map(),
      akun: [],
      bukuKas: [],
      setoran: [],
      tutupHari: [],
      tanpaHarga: [],
      kejadian: [],
      aktivitas: [],
      harga: new Map(),
    };
    const r = rakitPantau([7], bahan);
    expect(r).toHaveLength(1);
    expect(r[0]!.merah).toBeGreaterThan(0);
  });
});

describe("tambahan 26 Sep — tanpa penjualan & EDC per shift", () => {
  it("jendela tanpa penjualan: satu temuan hijau, bukan '0 hari belum ditutup'", () => {
    const t = temuanKedisiplinan(fakta({ hariPenjualan: 0, ditutup: 0, hariBermutasi: 0 }), "2026-09-25");
    expect(t).toHaveLength(1);
    expect(t[0]!.kode).toBe("tanpa_penjualan");
    expect(t[0]!.nada).toBe("hijau");
  });

  it("EDC: belum pernah dibukukan ⇒ merah; sebagian ⇒ kuning; tanpa penjualan EDC ⇒ tak dinilai", () => {
    const nada = (hariEdc: number, hariEdcDibukukan: number) =>
      temuanKedisiplinan(fakta({ hariEdc, hariEdcDibukukan }), "2026-09-25").find((x) => x.kode === "edc_penampungan")
        ?.nada;
    expect(nada(10, 0)).toBe("merah");
    expect(nada(10, 6)).toBe("kuning");
    expect(nada(10, 10)).toBe("hijau");
    expect(nada(0, 0)).toBeUndefined();
  });
});

describe("§10.26 — saldo pembuka sementara", () => {
  it("titik awal sementara ⇒ kuning yang menyebut akunnya, bukan hijau 'lengkap'", () => {
    const a = { ...akun("bank"), nama: "Bank BCA - 1", saldoAwalSementara: true };
    const t = temuanKesiapan([akun("kas"), akun("edc_penampungan"), a], [], []);
    const s = t.find((x) => x.kode === "saldo_awal")!;
    expect(s.nada).toBe("kuning");
    expect(s.rinci).toContain("Bank BCA - 1");
  });
});

