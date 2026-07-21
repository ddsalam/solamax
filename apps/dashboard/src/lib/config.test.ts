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
      for (const other of ["6478111", "6378301", "6478101", "6478106"]) {
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
