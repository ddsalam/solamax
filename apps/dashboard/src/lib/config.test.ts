import { describe, expect, it } from "vitest";
import {
  ptLabelForUnits,
  targetBauran,
  targetVolumePerDay,
  TARGET_BAURAN,
  TARGET_VOLUME_PER_DAY,
  UNIT_DISPLAY,
} from "./config";

describe("ptLabelForUnits (label PT multi-tenant)", () => {
  it("satu PT unik → nama PT itu (identik hardcode lama utk unit tenant lama)", () => {
    expect(ptLabelForUnits(["6478111"])).toBe("PT Sola Petra Abadi");
    expect(ptLabelForUnits(["6478111", "6378301"])).toBe("PT Sola Petra Abadi");
    expect(ptLabelForUnits(["6478101"])).toBe("PT Sola Adis Raya");
  });

  it("campuran lintas-PT atau kode tak dikenal → payung SolaGroup", () => {
    expect(ptLabelForUnits(["6478111", "6478101"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["9999999"])).toBe("SolaGroup");
    expect(ptLabelForUnits([])).toBe("SolaGroup");
  });
});

describe("entri Imam Bonjol 6478111 — target 12 bulan (dilengkapi 2026-07-22)", () => {
  // REGRESI KUNCI: bulan 6 adalah entri pilot yang SUDAH ada sebelum backfill.
  // Nilainya WAJIB tak berubah; kalau bergeser, berarti workbook kanonik tidak
  // sepakat dgn config live — itu TEMUAN, bukan sekadar update.
  it("bulan 6 TIDAK berubah dari entri pilot (jangkar regresi, byte-identical)", () => {
    const v = TARGET_VOLUME_PER_DAY["6478111"]![6]!;
    expect(v).toEqual({
      PERTALITE: 30000,
      PERTAMAX: 3500,
      "PERTAMAX TURBO": 150,
      SOLAR: 23000,
      DEXLITE: 3300,
      "PERTAMINA DEX": 5000,
    });
    expect(targetBauran("6478111", "gasoline", 6)).toBe(0.1217);
    expect(targetBauran("6478111", "gasoil", 6)).toBe(0.3609);
  });

  it("12 bulan penuh, 6 produk tiap bulan (dulu HANYA bulan 6)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(Object.keys(TARGET_VOLUME_PER_DAY["6478111"]![m]!)).toHaveLength(6);
      expect(TARGET_BAURAN["6478111"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["6478111"]!.gasoil[m]).toBeTypeOf("number");
    }
    // PERTALITE 30k & SOLAR 23k flat; keduanya TERTINGGI semua unit.
    for (let m = 1; m <= 12; m++) {
      expect(targetVolumePerDay("6478111", m, "PERTALITE")).toBe(30000);
      expect(targetVolumePerDay("6478111", m, "SOLAR")).toBe(23000);
    }
    // Ramp: Pertamax 3000→4100, Turbo 100→210, Dexlite 3200→3420, PDex 4900→5120.
    expect(targetVolumePerDay("6478111", 1, "PERTAMAX")).toBe(3000);
    expect(targetVolumePerDay("6478111", 12, "PERTAMAX")).toBe(4100);
    expect(targetVolumePerDay("6478111", 1, "PERTAMAX TURBO")).toBe(100);
    expect(targetVolumePerDay("6478111", 12, "PERTAMAX TURBO")).toBe(210);
    expect(targetVolumePerDay("6478111", 12, "PERTAMINA DEX")).toBe(5120);
  });

  it("bauran konsisten dgn rasio volume workbook (toleransi pembulatan 4dp)", () => {
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["6478111"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("6478111", "gasoline", m)!).toBeCloseTo(gasoline, 3);
      expect(targetBauran("6478111", "gasoil", m)!).toBeCloseTo(gasoil, 3);
    }
  });

  it("volume harian total IB = TERTINGGI semua unit, 12/12 bulan", () => {
    const total = (code: string, m: number) =>
      Object.values(TARGET_VOLUME_PER_DAY[code]![m]!).reduce((a, b) => a + b, 0);
    for (let m = 1; m <= 12; m++) {
      for (const other of [
        "6378301", "6478101", "6478106", "6478201", "6478311", "63781002",
      ]) {
        expect(total("6478111", m)).toBeGreaterThan(total(other, m));
      }
    }
  });
});

describe("entri Adisucipto 6478101 (workbook 2026 baris AS)", () => {
  it("UNIT_DISPLAY: dotted/PT/alamat benar", () => {
    const d = UNIT_DISPLAY["6478101"]!;
    expect(d.dotted).toBe("64.781.01");
    expect(d.name).toBe("Adisucipto");
    expect(d.pt).toBe("PT Sola Adis Raya");
    expect(d.address).toContain("Adi Sucipto");
  });

  it("target 12 bulan penuh; TURBO 0 (Jan–Jun) adalah target NYATA, bukan null", () => {
    for (let m = 1; m <= 12; m++) {
      expect(TARGET_BAURAN["6478101"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["6478101"]!.gasoil[m]).toBeTypeOf("number");
      expect(Object.keys(TARGET_VOLUME_PER_DAY["6478101"]![m]!)).toHaveLength(6);
    }
    // 0 harus lolos sebagai angka (konsumen memakai cek `!== null`, bukan falsy).
    expect(targetVolumePerDay("6478101", 1, "PERTAMAX TURBO")).toBe(0);
    expect(targetVolumePerDay("6478101", 7, "PERTAMAX TURBO")).toBe(20);
  });

  it("bauran konsisten dgn rasio volume workbook (toleransi pembulatan 4dp)", () => {
    // gasoline = (Pertamax+Turbo)/Pertalite; gasoil = (Dexlite+Dex)/Solar.
    // Entri disimpan 4dp (konvensi IB/BK) → selisih maks 0.00005; presisi 3
    // (ambang 0.0005) aman tanpa false-negative di batas pembulatan eksak.
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["6478101"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("6478101", "gasoline", m)!).toBeCloseTo(gasoline, 3);
      expect(targetBauran("6478101", "gasoil", m)!).toBeCloseTo(gasoil, 3);
    }
  });
});

describe("entri Bundaran Kotabaru 6478106 (workbook 2026 baris KB, tenant BARU PT Merita Abadi Sukses)", () => {
  it("UNIT_DISPLAY: dotted/PT/alamat benar", () => {
    const d = UNIT_DISPLAY["6478106"]!;
    expect(d.dotted).toBe("64.781.06");
    expect(d.name).toBe("Bundaran Kotabaru");
    expect(d.pt).toBe("PT Merita Abadi Sukses");
    expect(d.address).toContain("Kota Baru");
  });

  it("target 12 bulan penuh; semua produk (termasuk TURBO) aktif sejak Jan (≠ AS)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(TARGET_BAURAN["6478106"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["6478106"]!.gasoil[m]).toBeTypeOf("number");
      expect(Object.keys(TARGET_VOLUME_PER_DAY["6478106"]![m]!)).toHaveLength(6);
    }
    // TURBO tak pernah 0 di KB (dijual penuh sejak Jan) — beda dgn AS.
    expect(targetVolumePerDay("6478106", 1, "PERTAMAX TURBO")).toBe(240);
    expect(targetVolumePerDay("6478106", 12, "PERTAMAX TURBO")).toBe(350);
    // PERTALITE 35k / SOLAR 10k flat (karakteristik KB).
    expect(targetVolumePerDay("6478106", 6, "PERTALITE")).toBe(35000);
    expect(targetVolumePerDay("6478106", 6, "SOLAR")).toBe(10000);
  });

  it("bauran konsisten dgn rasio volume workbook (toleransi pembulatan 4dp)", () => {
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["6478106"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("6478106", "gasoline", m)!).toBeCloseTo(gasoline, 3);
      expect(targetBauran("6478106", "gasoil", m)!).toBeCloseTo(gasoil, 3);
    }
  });

  it("label PT ekspor: unit KB → PT Merita Abadi Sukses; campuran lintas-PT → SolaGroup", () => {
    expect(ptLabelForUnits(["6478106"])).toBe("PT Merita Abadi Sukses");
    expect(ptLabelForUnits(["6478106", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478106", "6478101"])).toBe("SolaGroup");
  });
});

describe("entri Batu Layang 6478201 (workbook 2026 baris BL, tenant BARU PT Batu Layang Jaya)", () => {
  it("UNIT_DISPLAY: dotted/PT/alamat benar", () => {
    const d = UNIT_DISPLAY["6478201"]!;
    expect(d.dotted).toBe("64.782.01");
    expect(d.name).toBe("Batu Layang");
    expect(d.pt).toBe("PT Batu Layang Jaya");
    expect(d.address).toContain("Pontianak Utara");
  });

  it("target 12 bulan penuh; semua produk (termasuk TURBO) aktif sejak Jan (≠ AS)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(TARGET_BAURAN["6478201"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["6478201"]!.gasoil[m]).toBeTypeOf("number");
      expect(Object.keys(TARGET_VOLUME_PER_DAY["6478201"]![m]!)).toHaveLength(6);
    }
    // TURBO tak pernah 0 di BL (dijual penuh sejak Jan) — beda dgn AS.
    expect(targetVolumePerDay("6478201", 1, "PERTAMAX TURBO")).toBe(50);
    expect(targetVolumePerDay("6478201", 12, "PERTAMAX TURBO")).toBe(160);
    // PERTALITE 20k / SOLAR 17k flat (karakteristik BL).
    expect(targetVolumePerDay("6478201", 6, "PERTALITE")).toBe(20000);
    expect(targetVolumePerDay("6478201", 6, "SOLAR")).toBe(17000);
  });

  it("profil DIESEL-HEAVY: gasoil TERTINGGI semua unit, 12/12 bulan", () => {
    for (let m = 1; m <= 12; m++) {
      const bl = targetBauran("6478201", "gasoil", m)!;
      expect(bl).toBeGreaterThan(0.5); // ~0,51 — satu-satunya unit di atas 0,5
      // Loop DILENGKAPI jadi 6/6 unit lain (dulu hanya 4 — KR & 28 Oktober
      // belum ada saat tes ini ditulis). Superlatif "TERTINGGI semua unit"
      // hanya sah bila diuji thd SELURUH armada, 12/12 bulan.
      for (const other of [
        "6478111", "6378301", "6478101", "6478106", "6478311", "63781002",
      ]) {
        expect(bl).toBeGreaterThan(targetBauran(other, "gasoil", m)!);
      }
    }
    // PERTAMINA DEX BL = tertinggi semua unit (5.600 L/hari di Jan).
    expect(targetVolumePerDay("6478201", 1, "PERTAMINA DEX")).toBe(5600);
  });

  it("gasoline terendah vs IB/Bakau/KB 12/12; vs AS baru menyalip turun sejak Jul (ramp AS lebih curam)", () => {
    for (let m = 1; m <= 12; m++) {
      const bl = targetBauran("6478201", "gasoline", m)!;
      for (const other of ["6478111", "6378301", "6478106"]) {
        expect(bl).toBeLessThan(targetBauran(other, "gasoline", m)!);
      }
      // AS mulai lebih rendah (Jan 0,0375) lalu naik lebih cepat → silang di Jul.
      const as = targetBauran("6478101", "gasoline", m)!;
      if (m <= 6) expect(bl).toBeGreaterThan(as);
      else expect(bl).toBeLessThan(as);
    }
  });

  it("bauran konsisten dgn rasio volume workbook (toleransi pembulatan 4dp)", () => {
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["6478201"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("6478201", "gasoline", m)!).toBeCloseTo(gasoline, 3);
      expect(targetBauran("6478201", "gasoil", m)!).toBeCloseTo(gasoil, 3);
    }
  });

  it("label PT ekspor: unit BL → PT Batu Layang Jaya; campuran lintas-PT → SolaGroup", () => {
    expect(ptLabelForUnits(["6478201"])).toBe("PT Batu Layang Jaya");
    expect(ptLabelForUnits(["6478201", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478201", "6478106"])).toBe("SolaGroup");
  });
});

describe("entri Korek 6478311 (workbook 2026 baris KR, tenant BARU PT Mitra Indah Lestari Oil Pratama)", () => {
  it("UNIT_DISPLAY: dotted/PT/alamat benar", () => {
    const d = UNIT_DISPLAY["6478311"]!;
    expect(d.dotted).toBe("64.783.11");
    expect(d.name).toBe("Korek");
    expect(d.pt).toBe("PT Mitra Indah Lestari Oil Pratama");
    // Satu-satunya unit di luar kota Pontianak.
    expect(d.address).toContain("Kubu Raya");
  });

  it("target 12 bulan penuh; semua produk (termasuk TURBO) aktif sejak Jan (≠ AS)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(TARGET_BAURAN["6478311"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["6478311"]!.gasoil[m]).toBeTypeOf("number");
      expect(Object.keys(TARGET_VOLUME_PER_DAY["6478311"]![m]!)).toHaveLength(6);
    }
    expect(targetVolumePerDay("6478311", 1, "PERTAMAX TURBO")).toBe(80);
    expect(targetVolumePerDay("6478311", 12, "PERTAMAX TURBO")).toBe(190);
    // PERTALITE 28k / SOLAR 10k flat (karakteristik KR).
    expect(targetVolumePerDay("6478311", 6, "PERTALITE")).toBe(28000);
    expect(targetVolumePerDay("6478311", 6, "SOLAR")).toBe(10000);
  });

  it("DEXLITE 1.750 FLAT 12/12 — satu-satunya unit tanpa ramp Dexlite", () => {
    for (let m = 1; m <= 12; m++) {
      expect(targetVolumePerDay("6478311", m, "DEXLITE")).toBe(1750);
    }
    // Semua unit lain MENAIK dari Jan ke Des (ramp) — KR tidak. IB kini ikut
    // dibandingkan: entri 12-bulannya dilengkapi 2026-07-22 (dulu hanya bulan 6,
    // sehingga sengaja dikecualikan di sini).
    for (const other of [
      "6478111", "6378301", "6478101", "6478106", "6478201", "63781002",
    ]) {
      expect(targetVolumePerDay(other, 12, "DEXLITE")!).toBeGreaterThan(
        targetVolumePerDay(other, 1, "DEXLITE")!,
      );
    }
  });

  it("gasoil rendah: di BAWAH IB/AS/KB/BL 12/12, tetapi DI ATAS Bakau 12/12 (Bakau-lah yg terendah)", () => {
    // Catatan: KR BUKAN gasoil terendah — Bakau (0,1235–0,1688) lebih rendah.
    // Superlatif lintas-unit hanya sah bila terverifikasi 12/12 thd SEMUA unit.
    for (let m = 1; m <= 12; m++) {
      const kr = targetBauran("6478311", "gasoil", m)!;
      for (const other of [
        "6478111", "6478101", "6478106", "6478201", "63781002",
      ]) {
        expect(kr).toBeLessThan(targetBauran(other, "gasoil", m)!);
      }
      expect(kr).toBeGreaterThan(targetBauran("6378301", "gasoil", m)!);
    }
  });

  it("gasoline: di bawah IB/Bakau/KB 12/12; MENYILANG AS & BL di bulan 5 (KR lebih tinggi Jan–Apr)", () => {
    for (let m = 1; m <= 12; m++) {
      const kr = targetBauran("6478311", "gasoline", m)!;
      for (const other of ["6478111", "6378301", "6478106", "63781002"]) {
        expect(kr).toBeLessThan(targetBauran(other, "gasoline", m)!);
      }
      // AS & BL mulai lebih rendah (Jan 0,0375 / 0,0425) lalu naik lebih curam
      // → KR menyalip ke bawah sejak Mei.
      for (const crossing of ["6478101", "6478201"]) {
        const o = targetBauran(crossing, "gasoline", m)!;
        if (m <= 4) expect(kr).toBeGreaterThan(o);
        else expect(kr).toBeLessThan(o);
      }
    }
  });

  it("bauran konsisten dgn rasio volume workbook (toleransi pembulatan 4dp)", () => {
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["6478311"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("6478311", "gasoline", m)!).toBeCloseTo(gasoline, 3);
      expect(targetBauran("6478311", "gasoil", m)!).toBeCloseTo(gasoil, 3);
    }
  });

  it("label PT ekspor: unit KR → PT Mitra Indah Lestari Oil Pratama; campuran lintas-PT → SolaGroup", () => {
    expect(ptLabelForUnits(["6478311"])).toBe("PT Mitra Indah Lestari Oil Pratama");
    expect(ptLabelForUnits(["6478311", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["6478311", "6478201"])).toBe("SolaGroup");
  });
});

describe("entri 28 Oktober 63781002 (workbook 2026 baris 28, tenant BARU PT Sola Petra Energi)", () => {
  it("kode POS DELAPAN digit — satu-satunya di armada (bukan 7)", () => {
    // Regresi terhadap asumsi "kode SPBU selalu 7 digit" yang beredar di prosa
    // brief/runbook. Kode adalah string OPAQUE; tak ada kode runtime yang
    // memotong/mem-pad/mencocokkan panjangnya.
    expect("63781002").toHaveLength(8);
    expect(UNIT_DISPLAY["63781002"]).toBeDefined();
    const sevens = Object.keys(UNIT_DISPLAY).filter((c) => c.length === 7);
    expect(sevens).toHaveLength(6); // enam unit lain tetap 7 digit
    expect(Object.keys(UNIT_DISPLAY)).toHaveLength(7); // armada LENGKAP 7/7
  });

  it("UNIT_DISPLAY: dotted/PT/alamat benar", () => {
    const d = UNIT_DISPLAY["63781002"]!;
    expect(d.dotted).toBe("63.781.002");
    expect(d.name).toBe("28 Oktober");
    expect(d.pt).toBe("PT Sola Petra Energi");
    expect(d.address).toContain("28 Oktober");
    expect(d.address).toContain("Siantan Hulu");
  });

  it("⚠️ PT Sola Petra ENERGI ≠ PT Sola Petra ABADI (near-collision, beda satu kata)", () => {
    // Jebakan paling berbahaya di seri ini: memasang 28 Oktober di bawah tenant
    // IB/Bakau akan membocorkan datanya ke direksi mereka SECARA SAH — scope-rule
    // tak akan menyalak karena ia memang bekerja benar. Karena itu label PT diuji
    // sebagai string EKSAK, dan campurannya WAJIB jatuh ke payung SolaGroup.
    expect(UNIT_DISPLAY["63781002"]!.pt).not.toBe(UNIT_DISPLAY["6478111"]!.pt);
    expect(UNIT_DISPLAY["63781002"]!.pt).not.toBe(UNIT_DISPLAY["6378301"]!.pt);
    expect(ptLabelForUnits(["63781002"])).toBe("PT Sola Petra Energi");
    // IB & Bakau bersama tetap "PT Sola Petra Abadi"; begitu 28 Oktober ikut,
    // labelnya HARUS runtuh jadi SolaGroup (bukan diam-diam "Sola Petra …").
    expect(ptLabelForUnits(["6478111", "6378301"])).toBe("PT Sola Petra Abadi");
    expect(ptLabelForUnits(["63781002", "6478111"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["63781002", "6378301"])).toBe("SolaGroup");
    expect(ptLabelForUnits(["63781002", "6478111", "6378301"])).toBe("SolaGroup");
  });

  it("target 12 bulan penuh; semua produk (termasuk TURBO) aktif sejak Jan (≠ AS)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(TARGET_BAURAN["63781002"]!.gasoline[m]).toBeTypeOf("number");
      expect(TARGET_BAURAN["63781002"]!.gasoil[m]).toBeTypeOf("number");
      expect(Object.keys(TARGET_VOLUME_PER_DAY["63781002"]![m]!)).toHaveLength(6);
    }
    expect(targetVolumePerDay("63781002", 1, "PERTAMAX TURBO")).toBe(90);
    expect(targetVolumePerDay("63781002", 12, "PERTAMAX TURBO")).toBe(200);
    // PERTALITE 21k / SOLAR 17k flat (karakteristik 28 Oktober).
    for (let m = 1; m <= 12; m++) {
      expect(targetVolumePerDay("63781002", m, "PERTALITE")).toBe(21000);
      expect(targetVolumePerDay("63781002", m, "SOLAR")).toBe(17000);
    }
  });

  it("gasoil PERINGKAT 2 dari 7, 12/12 — di bawah BL saja, di atas lima unit lain", () => {
    // Superlatif diuji thd SELURUH armada 12/12 (aturan pasca-KR), bukan slogan.
    for (let m = 1; m <= 12; m++) {
      const o28 = targetBauran("63781002", "gasoil", m)!;
      expect(o28).toBeLessThan(targetBauran("6478201", "gasoil", m)!); // BL saja
      for (const lower of ["6478111", "6378301", "6478101", "6478106", "6478311"]) {
        expect(o28).toBeGreaterThan(targetBauran(lower, "gasoil", m)!);
      }
    }
    // Pemisahan rentang bersih — tak bergantung bulan: BL min > 28 max > IB max.
    const span = (code: string) => {
      const v = Array.from({ length: 12 }, (_, i) => targetBauran(code, "gasoil", i + 1)!);
      return { min: Math.min(...v), max: Math.max(...v) };
    };
    expect(span("6478201").min).toBeGreaterThan(span("63781002").max);
    expect(span("63781002").min).toBeGreaterThan(span("6478111").max);
  });

  it("gasoline PERINGKAT 4 dari 7, 12/12 — di bawah IB/Bakau/KB, di atas AS/BL/KR", () => {
    for (let m = 1; m <= 12; m++) {
      const o28 = targetBauran("63781002", "gasoline", m)!;
      for (const higher of ["6478111", "6378301", "6478106"]) {
        expect(o28).toBeLessThan(targetBauran(higher, "gasoline", m)!);
      }
      for (const lower of ["6478101", "6478201", "6478311"]) {
        expect(o28).toBeGreaterThan(targetBauran(lower, "gasoline", m)!);
      }
    }
  });

  it("satu-satunya unit TANPA persilangan di kedua sumbu (peringkat tetap 12/12)", () => {
    // KR menyilang AS & BL di bulan 5; BL menyilang AS di bulan 7. 28 Oktober
    // tidak menyilang siapa pun — peringkatnya konstan sepanjang tahun.
    const fleet = ["6478111", "6378301", "6478101", "6478106", "6478201", "6478311", "63781002"];
    for (const kind of ["gasoline", "gasoil"] as const) {
      const ranks = Array.from({ length: 12 }, (_, i) =>
        fleet
          .slice()
          .sort((a, b) => targetBauran(b, kind, i + 1)! - targetBauran(a, kind, i + 1)!)
          .indexOf("63781002") + 1,
      );
      expect(new Set(ranks).size).toBe(1); // peringkat identik 12 bulan
      expect(ranks[0]).toBe(kind === "gasoil" ? 2 : 4);
    }
  });

  it("bauran TERDERIVASI eksak dari volume 12/12 (4dp round-half-up, bukan sekadar dekat)", () => {
    // Uji konsistensi internal yang lebih kuat dari toBeCloseTo unit lain:
    // tiap sel bauran HARUS sama persis dgn pembulatan 4dp rasio volumenya.
    for (let m = 1; m <= 12; m++) {
      const v = TARGET_VOLUME_PER_DAY["63781002"]![m]!;
      const gasoline = (v["PERTAMAX"]! + v["PERTAMAX TURBO"]!) / v["PERTALITE"]!;
      const gasoil = (v["DEXLITE"]! + v["PERTAMINA DEX"]!) / v["SOLAR"]!;
      expect(targetBauran("63781002", "gasoline", m)).toBe(Math.round(gasoline * 1e4) / 1e4);
      expect(targetBauran("63781002", "gasoil", m)).toBe(Math.round(gasoil * 1e4) / 1e4);
    }
  });
});
