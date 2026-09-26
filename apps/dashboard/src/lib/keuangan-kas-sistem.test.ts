import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { barisBuku, barisSistemDari } from "./keuangan-kas-model";

describe("baris SISTEM di buku kas tidak bisa dibatalkan", () => {
  it("satu pembuat vonis", () => {
    expect(barisSistemDari({ saldoAwal: true })).toBe("saldo_awal");
    expect(barisSistemDari({ saldoAwal: false, dariPencairanEdc: true })).toBe("pencairan_edc");
    expect(barisSistemDari({ saldoAwal: false, dariPencairanEdc: false })).toBeNull();
  });

  it("barisBuku menandai baris sistem, baris biasa tetap null", () => {
    const m = (id: string, o: object) => ({
      id,
      keterangan: id,
      accountId: "A",
      businessDate: "2026-09-24",
      jenis: "debet" as const,
      categorySide: null,
      categoryLabel: null,
      amount: 100,
      saldoAwal: false,
      void: false,
      ...o,
    });
    const b = barisBuku(
      [m("pembuka", { saldoAwal: true, jenis: "adjustment" }), m("edc", { dariPencairanEdc: true }), m("biasa", {})],
      "A",
      "2026-09-24",
      "2026-09-23",
    );
    expect(b.map((x) => [x.id, x.barisSistem])).toEqual([
      ["pembuka", "saldo_awal"],
      ["edc", "pencairan_edc"],
      ["biasa", null],
    ]);
  });

  it("🔴 dijaga DI SERVER, bukan hanya dengan menyembunyikan tombol", () => {
    const s = readFileSync(resolve(__dirname, "kas-actions.ts"), "utf8");
    const fn = s.slice(s.indexOf("export async function voidMutasiKas"));
    const badan = fn.slice(0, fn.indexOf("\nexport "));
    expect(badan).toMatch(/barisSistemDari\(/);
    expect(badan).toMatch(/FOR UPDATE/);
    // Sabuk kedua: UPDATE-nya sendiri tak bisa menyentuh baris sistem.
    expect(badan).toMatch(/AND NOT saldo_awal AND edc_settlement_id IS NULL/);
  });
});
