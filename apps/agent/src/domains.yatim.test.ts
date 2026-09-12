import { describe, expect, it } from "vitest";
import { PELANGGAN_DOMAIN } from "./domains.js";
import { jrnKeyToBusinessDate, jrnKeyToShift } from "./transform.js";

/**
 * BARIS DETAIL YATIM — `tr_djualplg.CKDJUALPLG IS NULL`.
 *
 * Regresi 2026-09-12: membatalkan/menyunting transaksi pelanggan di EasyMax
 * memutus tautan detail→header tanpa menghapus barisnya, sehingga `vw_jualplg`
 * menjatuhkannya dan seksi Pelanggan SolaMax KURANG CATAT. Kasus penemunya
 * Bundaran Kotabaru 31-08-2026, Rp 675.054 / 56,69 L.
 */
describe("JrnKey → tanggal bisnis + shift", () => {
  it("membaca YYYYMMDD + digit shift", () => {
    expect(jrnKeyToBusinessDate(202608311)).toBe("2026-08-31");
    expect(jrnKeyToShift(202608311)).toBe(1);
    expect(jrnKeyToBusinessDate("202608312")).toBe("2026-08-31");
    expect(jrnKeyToShift("202608312")).toBe(2);
  });

  it("menolak bentuk yang tak dikenal — TIDAK menebak", () => {
    for (const bad of [null, undefined, "", "abc", 12345, 20260831, "202613311", "202608321"]) {
      expect(jrnKeyToBusinessDate(bad as unknown)).toBeNull();
    }
    // bulan 13 dan hari 32 ditolak walau panjangnya benar
    expect(jrnKeyToBusinessDate("202613311")).toBeNull();
    expect(jrnKeyToBusinessDate("202608321")).toBeNull();
  });
});

describe("PELANGGAN.orphanSql + mapOrphan", () => {
  it("hanya baris tanpa tautan header, TANPA join ke header", () => {
    const sql = PELANGGAN_DOMAIN.orphanSql;
    expect(sql).toContain("FROM tr_djualplg");
    expect(sql).toMatch(/CKDJUALPLG IS NULL OR CKDJUALPLG = ''/);
    // Join ke tr_hjualplg pernah di-revert karena lock (probe FASE05f):
    // `tr_djualplg` tak punya index CKDJUALPLG. Jangan dikembalikan.
    expect(sql).not.toContain("tr_hjualplg");
    expect(sql).not.toMatch(/\bJOIN\b/i);
  });

  it("memetakan baris yatim ke pelanggan_sale ber-ckdplg NULL", () => {
    const { rows } = PELANGGAN_DOMAIN.mapOrphan([
      // tiga baris nyata KB 31-08-2026
      { TanggalJam: "2026-08-31 12:47:14", CRFID: "002040E004", CKDBBM: "BB-03",
        HargaSatuan: 6800, Liter: 35, TotalHarga: 238000, JrnKey: 202608311, NoNozle: "4" },
      { TanggalJam: "2026-08-31 12:47:58", CRFID: "002040E004", CKDBBM: "BB-06",
        HargaSatuan: 20150, Liter: 10, TotalHarga: 201500, JrnKey: 202608311, NoNozle: "1" },
      { TanggalJam: "2026-08-31 06:15:40", CRFID: "0020481002", CKDBBM: "BB-06",
        HargaSatuan: 20150, Liter: 11.69, TotalHarga: 235554, JrnKey: 202608311, NoNozle: "9" },
    ]);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.business_date).toBe("2026-08-31");
      expect(r.ckdplg).toBeNull(); // pelanggan hidup di header — yatim tak punya
      expect(r.ckdjualplg).toBeNull();
      expect(r.sbatal).toBe(0); // SBATAL juga milik header; 0 = ikut dihitung
      expect(r.nshift).toBe(1);
    }
    expect(rows.reduce((s, r) => s + (r.total ?? 0), 0)).toBe(675054);
    expect(rows.reduce((s, r) => s + (r.liter ?? 0), 0)).toBeCloseTo(56.69, 2);
  });

  it("jatuh ke TanggalJam bila JrnKey tak terbaca, dan membuang yang tak bertanggal", () => {
    const { rows } = PELANGGAN_DOMAIN.mapOrphan([
      { TanggalJam: "2026-08-31 06:15:40", CKDBBM: "BB-06", Liter: 1, TotalHarga: 1, JrnKey: null },
      { TanggalJam: null, CKDBBM: "BB-06", Liter: 1, TotalHarga: 1, JrnKey: "rusak" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.business_date).toBe("2026-08-31");
    expect(rows[0]!.nshift).toBeNull();
  });
});
