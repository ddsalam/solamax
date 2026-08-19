import { describe, expect, it } from "vitest";
import { PENJELASAN_KOSONG } from "./keuangan-laporan-model";
import {
  CARA,
  daftarMasukan,
  ringkasSumber,
  type FaktaSumber,
} from "./keuangan-sumber-model";

const f = (o: Partial<FaktaSumber> = {}): FaktaSumber => ({
  produk: 7,
  produkBerhargaBeli: 7,
  akunKas: 7,
  adaOpname: true,
  adaPenjualan: true,
  barisBiayaPengawas: 2,
  barisBiayaFinance: 1,
  settlementHariIni: 1,
  produkTanpaSisaSo: 0,
  ...o,
});

const cari = (fk: FaktaSumber, sheet: string) =>
  daftarMasukan(fk).find((m) => m.sheet.startsWith(sheet))!;

describe("daftarMasukan — statusnya HIDUP, bukan brosur", () => {
  it("keadaan berubah mengikuti fakta — bukan teks tetap", () => {
    // Kalau statusnya tak pernah bisa berbunyi 'belum', ia hanya menyalin janji
    // mockup ke layar.
    expect(cari(f(), "StockAkhirHari").keadaan).toBe("siap");
    expect(cari(f({ adaOpname: false }), "StockAkhirHari").keadaan).toBe("belum");
    expect(cari(f({ adaPenjualan: false }), "VolumePenjualan").keadaan).toBe("belum");
  });

  it("harga beli sebagian ⇒ 'sebagian', dan menyebut BERAPA serta SIAPA", () => {
    const m = cari(f({ produkBerhargaBeli: 4 }), "HargaBeli");
    expect(m.keadaan).toBe("sebagian");
    expect(m.catatan).toMatch(/3 dari 7/);
    expect(m.catatan).toMatch(/tim keuangan/);
    expect(m.sebab).toBe("belum_ada_harga_beli");
  });

  it("🔴 SEBAB memakai nama yang SUDAH ADA — bukan sinonim baru", () => {
    // Dua layar yang menyebut keadaan sama dengan dua nama membuat orang
    // berikutnya menduga keduanya berbeda.
    for (const m of daftarMasukan(f({ akunKas: 0, adaOpname: false, produkBerhargaBeli: 0 }))) {
      if (m.sebab !== undefined) {
        expect(Object.keys(PENJELASAN_KOSONG), `sebab tak dikenal: ${m.sebab}`).toContain(m.sebab);
      }
    }
  });

  it("tanpa akun kas: buku kas & hutang-piutang non-EasyMax ikut 'belum'", () => {
    const fk = f({ akunKas: 0 });
    expect(cari(fk, "BukuKasBesar").keadaan).toBe("belum");
    expect(cari(fk, "BukuKasBesar").sebab).toBe("belum_ada_akun_kas");
    expect(cari(fk, "BukuHutangPiutangNonEasyMax").keadaan).toBe("belum");
  });

  it("🔴 SisaSO TIDAK pernah 'siap' — batas B7 disebut apa adanya", () => {
    // Layar sumber data yang tak menyebut apa yang belum cocok adalah layar
    // sumber data yang salah.
    const m = cari(f(), "SisaSO");
    expect(m.keadaan).toBe("batas_diketahui");
    expect(m.keadaan).not.toBe("siap");
    expect(m.catatan).toMatch(/4 dari 10/);
    expect(m.catatan).toMatch(/B7/);
  });

  it("🔴 baris ke-15 ADA: saldo pembuka yang tak bersumber", () => {
    // Ketiadaan sumber adalah informasi, dan ia hanya terlihat kalau punya
    // baris sendiri. Daftar workbook hanya 14.
    const semua = daftarMasukan(f());
    expect(semua).toHaveLength(15);
    const m = semua.find((x) => x.sebab === "belum_ada_saldo_pembuka")!;
    expect(m).toBeDefined();
    expect(m.keadaan).toBe("belum");
    expect(m.catatan).toMatch(/KUMULATIF mustahil|kumulatif/i);
    expect(m.catatan).toMatch(/LANGKAH HARIAN/);
  });

  it("kontrol POSITIF: dengan fakta lengkap, hanya SisaSO & saldo pembuka yang tidak 'siap'", () => {
    const bukanSiap = daftarMasukan(f()).filter((m) => m.keadaan !== "siap");
    expect(bukanSiap.map((m) => m.keadaan).sort()).toEqual(["batas_diketahui", "belum"]);
  });
});

describe("ringkasSumber", () => {
  it("menghitung total, per cara, yang belum, dan yang berbatas", () => {
    const r = ringkasSumber(daftarMasukan(f()));
    expect(r.total).toBe(15);
    expect(r.belum).toBe(1);
    expect(r.berbatas).toBe(1);
    // 14 masukan workbook: 9 otomatis · 2 campuran · 3 input — plus baris ke-15
    // yang juga input keuangan.
    expect(r.perCara).toEqual({ otomatis: 9, campuran: 2, input_keuangan: 4 });
  });

  it("daftar cara bisa DIHITUNG, dan tiap cara menyumbang", () => {
    const r = ringkasSumber(daftarMasukan(f()));
    expect(Object.keys(r.perCara).sort()).toEqual([...CARA].sort());
    for (const c of CARA) expect(r.perCara[c], c).toBeGreaterThan(0);
  });

  it("yang 'belum' bertambah saat faktanya memburuk — daya-beda", () => {
    const buruk = ringkasSumber(daftarMasukan(f({ akunKas: 0, adaOpname: false, adaPenjualan: false })));
    expect(buruk.belum).toBeGreaterThan(ringkasSumber(daftarMasukan(f())).belum);
  });
});
