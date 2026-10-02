import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fmtKL } from "@/lib/format";
import { formatUsulanKl } from "./format";

describe("formatUsulanKl — tampilan empat kolom DO", () => {
  it.each<[number, string]>([
    [8000, "8 KL"],
    [8500, "8,5 KL"],
    [8250, "8,25 KL"],
    [8125, "8,125 KL"],
    [8100, "8,1 KL"],
    [8010, "8,01 KL"],
    [8001, "8,001 KL"],
    [0, "0 KL"],
    [1, "0,001 KL"],
    [1000, "1 KL"],
    [10_000, "10 KL"],
    [1_000_000, "1.000 KL"],
    [1_000_010, "1.000,01 KL"],
    [-8500, "-8,5 KL"],
  ])("%i liter tetap bernilai %s", (liters, expected) => {
    expect(formatUsulanKl(liters)).toBe(expected);
  });

  it("formatter bersama/ekspor tetap tiga desimal", () => {
    expect(fmtKL(8000, 3)).toBe("8,000 KL");
    expect(fmtKL(8500, 3)).toBe("8,500 KL");
    expect(fmtKL(8250, 3)).toBe("8,250 KL");
    expect(fmtKL(8125, 3)).toBe("8,125 KL");
  });

  it("dipakai pada Sisa DO dan empat total saja; Sisa Stock tetap", () => {
    const source = readFileSync(new URL("./UsulanForm.tsx", import.meta.url), "utf8");
    for (const value of [
      "r.sisaDo", "tot.sisaDo", "tot.penerimaanHari", "tot.permintaanBesok", "tot.usulanPenebusan",
    ]) expect(source).toContain(`{formatUsulanKl(${value})}`);
    expect(source.match(/formatUsulanKl\(/g)).toHaveLength(5);
    expect(source).toContain("fmtKL(r.sisaStock, 3)");
    expect(source).toContain("fmtKL(tot.sisaStock, 3)");
  });
});
