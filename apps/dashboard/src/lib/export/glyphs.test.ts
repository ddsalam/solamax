import { describe, expect, it } from "vitest";
import { pdfText } from "./glyphs";

describe("pdfText (shared PDF glyph sanitizer)", () => {
  it("mengganti glyph yang hilang dari Roboto", () => {
    expect(pdfText("RFID/deposit ⊎ voucher")).toBe("RFID/deposit + voucher");
    expect(pdfText("⚠ blank-card")).toBe("! blank-card");
    expect(pdfText("✓ ok")).toBe("OK ok");
    expect(pdfText("✗ / ✘")).toBe("x / x");
    expect(pdfText("tren ▲ / ▼ / ▾")).toBe("tren ^ / v / v");
    expect(pdfText("angka ⟳ dikoreksi")).toBe("angka * dikoreksi");
    expect(pdfText("A ⇒ B, x ↔ y, p ≡ q")).toBe("A => B, x <-> y, p = q");
    expect(pdfText("← → ↑ ↓")).toBe("<- -> ^ v");
  });

  it("mempertahankan glyph yang ADA di Roboto (setia ke layar)", () => {
    const keep = "· − — – Σ ± ≥ ≤ ≠ … × № › δ ÷ • °";
    expect(pdfText(keep)).toBe(keep);
  });

  it("idempoten dan tak menyentuh ASCII biasa", () => {
    expect(pdfText("Rp 1.234.567 · 12,3 KL")).toBe("Rp 1.234.567 · 12,3 KL");
    expect(pdfText(pdfText("⚠ x"))).toBe(pdfText("⚠ x"));
  });
});
