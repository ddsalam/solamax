import { describe, expect, it } from "vitest";
import { editUsulanInputValue, parseUsulanKl, sanitizeUsulanKl, sumUsulanQuantities, usulanInputValue, usulanLiterToKlInput } from "./usulan-quantities";

describe("Usulan KL input and nullable totals", () => {
  it.each<[string, number | null, string]>([
    ["", null, ""], ["0", 0, "0"], ["0,000", 0, "0"],
    ["8", 8000, "8"], ["8,500", 8500, "8,5"],
    ["8,250", 8250, "8,25"], ["8,125", 8125, "8,125"],
    ["0,001", 1, "0,001"], ["1000,010", 1000010, "1000,01"],
  ])("%s → %s L → %s KL without losing blank/zero", (input, liters, compact) => {
    expect(parseUsulanKl(input)).toBe(liters);
    expect(usulanLiterToKlInput(liters)).toBe(compact);
    expect(parseUsulanKl(usulanLiterToKlInput(liters))).toBe(liters);
    const saved = JSON.parse(JSON.stringify({ quantity: liters }));
    expect(saved.quantity).toBe(liters);
    expect(usulanLiterToKlInput(saved.quantity)).toBe(compact);
  });

  it.each([[8124.49, "8,124"], [8124.5, "8,125"], [8124.51, "8,125"]] as const)(
    "input display keeps shared Intl rounding at %s L without rounding stored data", (liters, text) => {
      expect(usulanInputValue(liters)).toEqual({ text, liters });
    },
  );

  it("opening/blur/no-op save preserves native fractional liters independently of display precision", () => {
    const opened = usulanInputValue(8125.25);
    expect(opened).toEqual({ text: "8,125", liters: 8125.25 });
    const blurred = usulanInputValue(opened.liters);
    expect(blurred.liters).toBe(8125.25);
    expect(JSON.parse(JSON.stringify({ quantity: blurred.liters })).quantity).toBe(8125.25);
    expect(editUsulanInputValue("8,125")).toEqual({ text: "8,125", liters: 8125 });
    expect(editUsulanInputValue("")).toEqual({ text: "", liters: null });
    expect(editUsulanInputValue("0")).toEqual({ text: "0", liters: 0 });
  });

  it("keeps the existing three-decimal sanitizer and whole-liter precision", () => {
    expect(sanitizeUsulanKl("8.1259")).toBe("8,125");
    expect(sanitizeUsulanKl("8,2,5")).toBe("8,25");
    expect(parseUsulanKl("8.125")).toBe(8125);
    expect(parseUsulanKl(",5")).toBe(500);
    expect(parseUsulanKl(",")).toBeNaN();
  });

  it.each<[Array<number | null>, number | null]>([
    [[], null], [[null, null], null], [[null, 0], 0],
    [[0, null, 0], 0], [[8000, null, 125, 0], 8125], [[8000, -8000, null], 0],
  ])("total %j preserves data presence", (values, total) => {
    expect(sumUsulanQuantities(values)).toBe(total);
  });
});
