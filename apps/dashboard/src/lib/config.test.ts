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
