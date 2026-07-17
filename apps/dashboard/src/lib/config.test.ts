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
