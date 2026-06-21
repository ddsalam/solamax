import { describe, expect, it } from "vitest";
import { rp } from "./format";

describe("rp() — tanda mata uang", () => {
  it("positif: 'Rp …'", () => {
    expect(rp(5000)).toBe("Rp 5.000");
    expect(rp(1234567)).toBe("Rp 1.234.567");
  });

  it("NEGATIF: '−Rp …' (jangan jatuhkan tanda — Summary H bisa sah negatif)", () => {
    expect(rp(-5000)).toBe("−Rp 5.000");
    expect(rp(-169000)).toBe("−Rp 169.000");
  });

  it("nol: 'Rp 0' (tanpa minus)", () => {
    expect(rp(0)).toBe("Rp 0");
    expect(rp(-0)).toBe("Rp 0");
  });

  it("pembulatan: −0,4 → Rp 0; −0,6 → −Rp 1", () => {
    expect(rp(-0.4)).toBe("Rp 0");
    expect(rp(-0.6)).toBe("−Rp 1");
  });
});
