import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScopedUnitId } from "./scope";
import {
  KODE_PELANGGAN_MAKS,
  TERMIN_HARI_MAKS,
  cabutTerminPelanggan,
  normalKodePelanggan,
  periksaTerminHari,
  tulisTerminPelanggan,
  tulisTerminUnit,
} from "./termin-tulis";

/**
 * Inti tulis termin (rencana 2026-11-13 U4) — validasi murni + urutan
 * pernyataan dengan klien TIRUAN yang mencatat setiap pernyataan, sehingga
 * "tak menulis" dibuktikan sebagai "tak ada UPDATE/INSERT", bukan hanya hasil
 * yang benar.
 *
 * ⚠️ Batas: SQL-nya tidak dijalankan. Penegakan DB (RLS, CHECK, indeks unik
 * parsial 0064) dibuktikan `termin.integration.test.ts` (ber-gerbang env).
 */
type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
const log: { sql: string; params: unknown[] }[] = [];
let jawab: (sql: string, params: unknown[]) => Jawab = () => undefined;
const c = {
  query: async (sql: string, params: unknown[] = []) => {
    log.push({ sql, params });
    const r = jawab(sql, params);
    return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
  },
} as unknown as PoolClient;

const UNIT = { unitId: 6478 as ScopedUnitId, code: "6478111" };
const AKTOR = { userId: 7, email: "staf@solagroup.co" };
const ke = (potongan: string) => log.filter((l) => l.sql.includes(potongan));
const audit = () => ke("INSERT INTO app.audit_log").map((l) => ({ action: l.params[2], target: l.params[3], detail: JSON.parse(l.params[4] as string) }));
const menulis = () => log.filter((l) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(l.sql));

/** Jawaban DB tiruan: baris aktif (bila ada), master pelanggan, dan void yang berhasil. */
const db =
  (o: { aktif?: number | null; master?: { kode: string; nama: string | null } | null; voidRowCount?: number }) =>
  (sql: string): Jawab => {
    if (sql.includes("FROM public.pelanggan_master")) return { rows: o.master ? [o.master] : [] };
    if (/FROM app\.termin_(unit|pelanggan)/.test(sql)) {
      return { rows: o.aktif == null ? [] : [{ id: "lama-1", terminHari: o.aktif }] };
    }
    if (/UPDATE app\.termin_(unit|pelanggan)/.test(sql)) return { rows: [], rowCount: o.voidRowCount ?? 1 };
    return undefined;
  };

beforeEach(() => {
  log.length = 0;
  jawab = () => undefined;
});

describe("periksaTerminHari — bilangan bulat 0..365", () => {
  it("batas bawah & atas sah; nol sah", () => {
    for (const n of [0, 1, 30, TERMIN_HARI_MAKS]) expect(periksaTerminHari(n), String(n)).toBeNull();
  });

  it("🔴 di luar rentang ditolak", () => {
    for (const n of [-1, TERMIN_HARI_MAKS + 1, 1000]) expect(periksaTerminHari(n), String(n)).toMatch(/0 sampai 365/);
  });

  it("🔴 bukan bilangan bulat ditolak — pecahan, NaN, tak hingga, teks, null", () => {
    for (const n of [14.5, Number.NaN, Number.POSITIVE_INFINITY, "30", null, undefined]) {
      expect(periksaTerminHari(n), String(n)).toMatch(/bilangan bulat/);
    }
  });
});

describe("normalKodePelanggan — bentuk kunci btrim(ckdplg)", () => {
  it("memangkas spasi pinggir (pengisi CHAR(12)); isi tak disentuh", () => {
    expect(normalKodePelanggan("NOL/02      ")).toBe("NOL/02");
    expect(normalKodePelanggan("  PLG.0001 ")).toBe("PLG.0001");
    expect(normalKodePelanggan("a b")).toBe("a b");
  });

  it("garis miring, titik, dan huruf besar/kecil APA ADANYA", () => {
    expect(normalKodePelanggan("NOL/02")).toBe("NOL/02");
    expect(normalKodePelanggan("9.1.2")).toBe("9.1.2");
    expect(normalKodePelanggan("abC")).toBe("abC");
  });

  it("🔴 kosong, hanya spasi, bukan teks, atau lebih lebar dari kolom ⇒ null", () => {
    expect(normalKodePelanggan("")).toBeNull();
    expect(normalKodePelanggan("    ")).toBeNull();
    expect(normalKodePelanggan(null)).toBeNull();
    expect(normalKodePelanggan(12)).toBeNull();
    expect(normalKodePelanggan("X".repeat(KODE_PELANGGAN_MAKS))).toBe("X".repeat(KODE_PELANGGAN_MAKS));
    expect(normalKodePelanggan("X".repeat(KODE_PELANGGAN_MAKS + 1))).toBeNull();
  });

  it("hanya spasi ASCII yang dipangkas — sama dengan btrim() Postgres, BUKAN String.trim()", () => {
    expect(normalKodePelanggan(" A1")).toBe(" A1");
  });
});

describe("tulisTerminUnit — void + insert + audit", () => {
  it("pertama kali: INSERT saja, audit `termin.unit.tetapkan`, sebelumnya null", async () => {
    jawab = db({ aktif: null });
    const r = await tulisTerminUnit(c, { unit: UNIT, terminHari: 30, aktor: AKTOR });
    expect(r).toEqual({ ok: true, berubah: true, sebelumnya: null, terminHari: 30 });
    expect(ke("UPDATE app.termin_unit")).toHaveLength(0);
    expect(ke("INSERT INTO app.termin_unit")[0]!.params).toEqual([UNIT.unitId, 30, 7]);
    expect(audit()).toEqual([
      { action: "termin.unit.tetapkan", target: "6478111", detail: { unit: "6478111", terminHari: 30, sebelumnya: null } },
    ]);
  });

  it("🔴 ganti: baris aktif dikunci, di-VOID, lalu INSERT, lalu audit `ganti` berisi nilai lama & baru", async () => {
    jawab = db({ aktif: 30 });
    const r = await tulisTerminUnit(c, { unit: UNIT, terminHari: 14, aktor: AKTOR });
    expect(r).toEqual({ ok: true, berubah: true, sebelumnya: 30, terminHari: 14 });
    const iKunci = log.findIndex((l) => l.sql.includes("FOR UPDATE"));
    const iVoid = log.findIndex((l) => l.sql.includes("UPDATE app.termin_unit"));
    const iIns = log.findIndex((l) => l.sql.includes("INSERT INTO app.termin_unit"));
    const iAudit = log.findIndex((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(iKunci).toBeGreaterThan(-1);
    expect(iKunci).toBeLessThan(iVoid);
    expect(iVoid).toBeLessThan(iIns);
    expect(iIns).toBeLessThan(iAudit);
    expect(log[iVoid]!.sql).toMatch(/SET void = true, voided_by_user_id = \$2, voided_at = now\(\)/);
    expect(log[iVoid]!.sql).toMatch(/unit_id = \$3 AND NOT void/);
    expect(log[iVoid]!.params).toEqual(["lama-1", 7, UNIT.unitId]);
    expect(audit()).toEqual([
      {
        action: "termin.unit.ganti",
        target: "6478111",
        detail: { unit: "6478111", terminHari: 14, sebelumnya: { terminHari: 30 } },
      },
    ]);
  });

  it("🔴 nilai SAMA = tak menulis apa pun: tanpa void, tanpa insert, tanpa audit", async () => {
    jawab = db({ aktif: 30 });
    const r = await tulisTerminUnit(c, { unit: UNIT, terminHari: 30, aktor: AKTOR });
    expect(r).toEqual({ ok: true, berubah: false, sebelumnya: 30, terminHari: 30 });
    expect(menulis()).toEqual([]);
  });

  it("🔴 di luar rentang ditolak SEBELUM pernyataan apa pun", async () => {
    for (const n of [-1, 366, 1.5]) {
      expect((await tulisTerminUnit(c, { unit: UNIT, terminHari: n, aktor: AKTOR })).ok).toBe(false);
    }
    expect(log).toEqual([]);
  });

  it("void tak mengenai baris (berubah bersamaan) ⇒ ditolak, tanpa INSERT & audit", async () => {
    jawab = db({ aktif: 30, voidRowCount: 0 });
    const r = await tulisTerminUnit(c, { unit: UNIT, terminHari: 14, aktor: AKTOR });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/bersamaan/) });
    expect(ke("INSERT INTO")).toEqual([]);
  });

  it("tak ada DELETE di inti tulis", async () => {
    jawab = db({ aktif: 30 });
    await tulisTerminUnit(c, { unit: UNIT, terminHari: 14, aktor: AKTOR });
    expect(log.some((l) => /\bDELETE\b/.test(l.sql))).toBe(false);
  });
});

describe("tulisTerminPelanggan — pelanggan wajib ada di master", () => {
  const MASTER = { kode: "NOL/02", nama: "PT Contoh Ilustrasi" };

  it("kode yang DISIMPAN adalah kode master terpangkas; audit menyebut kode & nama", async () => {
    jawab = db({ aktif: null, master: MASTER });
    const r = await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "NOL/02      ", terminHari: 14, aktor: AKTOR });
    expect(r).toEqual({ ok: true, berubah: true, sebelumnya: null, terminHari: 14 });
    const cari = ke("FROM public.pelanggan_master")[0]!;
    expect(cari.sql).toMatch(/btrim\(ckdplg\) = \$2/);
    expect(cari.params).toEqual([UNIT.unitId, "NOL/02"]);
    expect(ke("INSERT INTO app.termin_pelanggan")[0]!.params).toEqual([UNIT.unitId, "NOL/02", 14, 7]);
    expect(audit()).toEqual([
      {
        action: "termin.pelanggan.tetapkan",
        target: "6478111/NOL/02",
        detail: {
          unit: "6478111",
          kodePelanggan: "NOL/02",
          namaPelanggan: "PT Contoh Ilustrasi",
          terminHari: 14,
          sebelumnya: null,
        },
      },
    ]);
  });

  it("🔴 pelanggan tak ada di master unit ini ⇒ ditolak, tak ada yang ditulis", async () => {
    jawab = db({ aktif: null, master: null });
    const r = await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "TAKADA", terminHari: 14, aktor: AKTOR });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/tak ada di master/) });
    expect(menulis()).toEqual([]);
  });

  it("ganti = void + insert + audit `ganti`; nilai sama = tak menulis", async () => {
    jawab = db({ aktif: 14, master: MASTER });
    expect(await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "NOL/02", terminHari: 45, aktor: AKTOR })).toEqual({
      ok: true,
      berubah: true,
      sebelumnya: 14,
      terminHari: 45,
    });
    expect(ke("UPDATE app.termin_pelanggan")).toHaveLength(1);
    expect(audit()[0]!.action).toBe("termin.pelanggan.ganti");
    expect(audit()[0]!.detail.sebelumnya).toEqual({ terminHari: 14 });

    log.length = 0;
    expect(
      (await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "NOL/02", terminHari: 14, aktor: AKTOR })),
    ).toEqual({ ok: true, berubah: false, sebelumnya: 14, terminHari: 14 });
    expect(menulis()).toEqual([]);
  });

  it("🔴 kode kosong / terlalu lebar & termin di luar rentang ditolak SEBELUM pernyataan apa pun", async () => {
    expect((await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "   ", terminHari: 14, aktor: AKTOR })).ok).toBe(false);
    expect((await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "X".repeat(13), terminHari: 14, aktor: AKTOR })).ok).toBe(false);
    expect((await tulisTerminPelanggan(c, { unit: UNIT, kodePelanggan: "NOL/02", terminHari: 366, aktor: AKTOR })).ok).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("cabutTerminPelanggan — void TANPA pengganti", () => {
  it("🔴 void saja, tanpa INSERT ke tabel termin; audit `hapus` dengan nilai lama, baru = null", async () => {
    jawab = db({ aktif: 14 });
    const r = await cabutTerminPelanggan(c, { unit: UNIT, kodePelanggan: " NOL/02 ", aktor: AKTOR });
    expect(r).toEqual({ ok: true, berubah: true, sebelumnya: 14, terminHari: null });
    expect(ke("UPDATE app.termin_pelanggan")).toHaveLength(1);
    expect(ke("INSERT INTO app.termin_pelanggan")).toEqual([]);
    expect(audit()).toEqual([
      {
        action: "termin.pelanggan.hapus",
        target: "6478111/NOL/02",
        detail: { unit: "6478111", kodePelanggan: "NOL/02", terminHari: null, sebelumnya: { terminHari: 14 } },
      },
    ]);
  });

  it("master TIDAK diperiksa — pengecualian yatim tetap bisa dihapus", async () => {
    jawab = db({ aktif: 14, master: null });
    expect((await cabutTerminPelanggan(c, { unit: UNIT, kodePelanggan: "LENYAP", aktor: AKTOR })).ok).toBe(true);
    expect(ke("pelanggan_master")).toEqual([]);
  });

  it("tanpa pengecualian aktif ⇒ ditolak, tak ada yang ditulis", async () => {
    jawab = db({ aktif: null });
    const r = await cabutTerminPelanggan(c, { unit: UNIT, kodePelanggan: "NOL/02", aktor: AKTOR });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/tidak punya pengecualian/) });
    expect(menulis()).toEqual([]);
  });
});
