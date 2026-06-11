import { describe, expect, it } from "vitest";
import {
  businessDate,
  int,
  num,
  str,
  subtractDays,
  subtractMinutesIso,
  tzOffsetMinutes,
  utcIsoToWibString,
  wibDateTimeToUtcIso,
} from "./transform.js";

const WIB = tzOffsetMinutes("Asia/Pontianak"); // 420

describe("konversi waktu WIB↔UTC", () => {
  it("WIB datetime → UTC ISO (−7 jam)", () => {
    expect(wibDateTimeToUtcIso("2026-06-11 14:30:00", WIB)).toBe(
      "2026-06-11T07:30:00.000Z",
    );
  });

  it("melintasi tengah malam mundur ke hari sebelumnya", () => {
    expect(wibDateTimeToUtcIso("2026-06-11 03:00:00", WIB)).toBe(
      "2026-06-10T20:00:00.000Z",
    );
  });

  it("null/empty → null", () => {
    expect(wibDateTimeToUtcIso(null, WIB)).toBeNull();
    expect(wibDateTimeToUtcIso("", WIB)).toBeNull();
  });

  it("round-trip UTC ISO → WIB string → UTC ISO", () => {
    const iso = "2026-06-11T07:30:00.000Z";
    const wib = utcIsoToWibString(iso, WIB);
    expect(wib).toBe("2026-06-11 14:30:00");
    expect(wibDateTimeToUtcIso(wib, WIB)).toBe(iso);
  });

  it("zona tak dikenal → error", () => {
    expect(() => tzOffsetMinutes("Mars/Phobos")).toThrow();
  });
});

describe("aritmetika watermark", () => {
  it("subtractMinutesIso", () => {
    expect(subtractMinutesIso("2026-06-11T07:30:00.000Z", 60)).toBe(
      "2026-06-11T06:30:00.000Z",
    );
  });
  it("subtractDays melintasi batas bulan", () => {
    expect(subtractDays("2026-06-04", 7)).toBe("2026-05-28");
  });
});

describe("coercion nilai", () => {
  it("num menerima string angka & menolak sampah", () => {
    expect(num("123.5")).toBe(123.5);
    expect(num("")).toBeNull();
    expect(num(null)).toBeNull();
    expect(num("abc")).toBeNull();
  });
  it("int memotong desimal", () => {
    expect(int("3.9")).toBe(3);
  });
  it("str trim & kosong→null", () => {
    expect(str("  x ")).toBe("x");
    expect(str("   ")).toBeNull();
  });
  it("businessDate ambil tanggal saja", () => {
    expect(businessDate("2026-06-11 00:00:00")).toBe("2026-06-11");
  });
});
