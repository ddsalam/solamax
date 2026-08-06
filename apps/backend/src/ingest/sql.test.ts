import { describe, expect, it } from "vitest";
import { buildReplace, buildUpsert } from "./sql.js";
import { TABLE_CONFIG } from "./table-config.js";

describe("buildUpsert", () => {
  it("membangun multi-row upsert dengan parameter terurut", () => {
    const { sql, params } = buildUpsert(TABLE_CONFIG.cash_detail!, 1, [
      { ckdkb: "K1", ckdperk: "5101", njumlah: 50000 },
      { ckdkb: "K1", ckdperk: "5102", njumlah: 7000 },
    ]);
    expect(sql).toContain(
      'INSERT INTO "cash_detail" ("unit_id","ckdkb","ckdperk","njumlah")',
    );
    // njumlah = kolom numeric → param TEKS + cast ::numeric (lihat NUMERIC_COLUMNS)
    expect(sql).toContain("VALUES ($1,$2,$3,$4::numeric),($5,$6,$7,$8::numeric)");
    expect(sql).toContain('ON CONFLICT ("unit_id","ckdkb","ckdperk")');
    expect(sql).toContain('"njumlah" = EXCLUDED."njumlah"');
    expect(sql).toContain('"ingested_at" = now()');
    // ckdkb/ckdperk = bagian conflict → TIDAK di-update
    expect(sql).not.toContain('"ckdkb" = EXCLUDED');
    expect(params).toEqual([1, "K1", "5101", "50000", 1, "K1", "5102", "7000"]);
  });

  it("tebus_detail: dtgltbs ber-cast ::date; sumOnConflict menjumlah dup key (cegah 21000)", () => {
    const hdr = buildUpsert(TABLE_CONFIG.tebus_header!, 1, [
      { ckdtbs: "T1", dtgltbs: "2026-06-24", sbatal: 0 },
    ]);
    expect(hdr.sql).toContain("::date"); // dtgltbs (regresi 42804)
    // Dua baris produk SAMA dalam satu batch → di-agregat jadi SATU tuple, nvolume dijumlah.
    const det = buildUpsert(TABLE_CONFIG.tebus_detail!, 1, [
      { ckdtbs: "T1", ckdbbm: "BB-03", nvolume: 32000 },
      { ckdtbs: "T1", ckdbbm: "BB-03", nvolume: 8000 },
      { ckdtbs: "T1", ckdbbm: "BB-08", nvolume: 8000 },
    ]);
    // 2 tuple (BB-03 ter-merge), bukan 3 → tak ada dup conflict-key.
    expect(det.sql).toContain("VALUES ($1,$2,$3,$4::numeric),($5,$6,$7,$8::numeric)");
    expect(det.sql).not.toContain("$9");
    // sumOnConflict tetap menjumlah sbg number SEBELUM di-teks-kan (32000+8000).
    expect(det.params).toEqual([1, "T1", "BB-03", "40000", 1, "T1", "BB-08", "8000"]);
    expect(det.sql).toContain('ON CONFLICT ("unit_id","ckdtbs","ckdbbm")');
  });

  it("kolom numeric dikirim sbg TEKS ber-cast ::numeric — pagar artefak floating-point", () => {
    // Prisma merender parameter JS `number` ke 16 ANGKA PENTING, bukan
    // shortest-roundtrip: `73867616.46` mendarat sbg `73867616.45999999` di
    // kolom numeric (terbukti di Postgres nyata 2026-08-06; ±243.800 sel mirror
    // 7 unit terkena). `String(v)` shortest-roundtrip memulihkan desimal sumber.
    // Kalau seseorang mengembalikan param numeric jadi `number`, tes ini MERAH.
    const { sql, params } = buildUpsert(TABLE_CONFIG.bppiut!, 1, [
      {
        ckdbppiut: "PP2022100101473", dtgl: "2022-10-01", ckdplg: "PLG2235",
        vcref: null, vcket: null, njumlah: 73867616.46, sjnsbp: 1, sbatal: 0,
      },
    ]);
    expect(params).toContain("73867616.46");
    expect(params).not.toContain(73867616.46);
    expect(sql).toMatch(/\$7::numeric/); // njumlah = kolom ke-6 cfg + unit_id
    // Kolom non-numeric TIDAK ikut di-teks-kan (sjnsbp/sbatal tetap int).
    expect(params).toContain(1);
    expect(params).toContain(0);
    // Nilai bulat & pecahan 2-desimal lain juga lewat sbg teks apa adanya.
    const { params: p2 } = buildUpsert(TABLE_CONFIG.sales_detail!, 1, [
      { ckdjualbbm: "J1", nvolume: 67.26, nsubtotal: 90098.4, nhargajual: 1000 },
    ]);
    expect(p2).toContain("67.26");
    expect(p2).toContain("90098.4");
    expect(p2).toContain("1000");
  });

  it("terra_resmi: ON CONFLICT (unit_id,ckdterra,ckdnozzle) + cast date/timestamptz + sumOnConflict", () => {
    const u = buildUpsert(TABLE_CONFIG.terra_resmi!, 1, [
      {
        business_date: "2026-06-17", ckdterra: "NT1", ckdnozzle: "NZ-18", nshift: 2,
        ckdtangki: "T-06", ckdbbm: "BB-07", nvolume: 41, nharga: 10000, ntotal: 410000,
        dtgljam: "2026-06-17T10:00:23Z", ckdjualbbm: "JB1", sbatal: 0,
      },
      // sesi+nozzle SAMA dalam batch → di-merge; nvolume/ntotal dijumlah (cegah 21000).
      {
        business_date: "2026-06-17", ckdterra: "NT1", ckdnozzle: "NZ-18", nshift: 2,
        ckdtangki: "T-06", ckdbbm: "BB-07", nvolume: 1, nharga: 10000, ntotal: 10000,
        dtgljam: "2026-06-17T10:05:00Z", ckdjualbbm: "JB1", sbatal: 0,
      },
    ]);
    expect(u.sql).toContain('ON CONFLICT ("unit_id","ckdterra","ckdnozzle")');
    expect(u.sql).toContain("::date"); // business_date (regresi 42804)
    expect(u.sql).toContain("::timestamptz"); // dtgljam
    // dua baris ter-merge → SATU tuple (13 param), nvolume 42 / ntotal 420000.
    expect(u.params).toHaveLength(13);
    expect(u.params[7]).toBe("42"); // nvolume (numeric → teks + ::numeric)
    expect(u.params[9]).toBe("420000"); // ntotal
    // kolom natural-key TIDAK di-update; nilai di-refresh.
    expect(u.sql).not.toContain('"ckdterra" = EXCLUDED');
    expect(u.sql).toContain('"nvolume" = EXCLUDED."nvolume"');
  });

  it("nilai hilang → null; objek (jsonb) → string JSON + cast ::jsonb", () => {
    const { sql, params } = buildUpsert(TABLE_CONFIG.product!, 2, [
      { ckdbbm: "P1", perk_map: { CKDPERK1: "x" } }, // vcnmbbm & nhrgjual absen
    ]);
    expect(params).toEqual([2, "P1", null, null, '{"CKDPERK1":"x"}']);
    expect(sql).toContain("$5::jsonb");
  });

  it("kolom date/timestamptz diberi cast eksplisit (Postgres tak coerce text)", () => {
    const sales = buildUpsert(TABLE_CONFIG.sales_header!, 1, [
      { ckdjualbbm: "H1", dtgljual: "2026-06-11", nshift: 1, vcket: null },
    ]);
    expect(sales.sql).toContain("$3::date"); // dtgljual (setelah unit_id, ckdjualbbm)
    const det = buildUpsert(TABLE_CONFIG.sales_detail!, 1, [
      { ckdjualbbm: "H1", ckdnozzle: "N1", nurut: 1, dtgljam: "2026-06-11T07:30:00Z" },
    ]);
    expect(det.sql).toContain("::timestamptz");
    const dlv = buildUpsert(TABLE_CONFIG.delivery!, 1, [{ ckdtrm: "D1", dtgltrm: "2026-06-11", dtgljam: "2026-06-11T07:30:00Z" }]);
    expect(dlv.sql).toContain("::date");
  });

  it("semua kolom = conflict → DO NOTHING (tanpa SET kosong)", () => {
    const cfgAllKey = {
      table: "x",
      columns: ["a"],
      conflict: ["a"],
      hasIngestedAt: false,
    };
    const { sql } = buildUpsert(cfgAllKey, 1, [{ a: "v" }]);
    expect(sql).toContain("DO NOTHING");
  });

  it("rows kosong → error", () => {
    expect(() => buildUpsert(TABLE_CONFIG.opname!, 1, [])).toThrow();
  });

  it("SEMUA tabel target payload punya config dengan conflict ⊆ columns", () => {
    for (const [name, cfg] of Object.entries(TABLE_CONFIG)) {
      expect(cfg.table, name).toBe(name);
      for (const k of cfg.conflict) expect(cfg.columns, name).toContain(k);
    }
  });
});

describe("buildReplace", () => {
  const edcRow = {
    business_date: "2026-06-22", cshift: "1",
    tanggaljam: "2026-06-22T08:00:00.000Z", ckdkartu: "QR01", total: 1000,
    liter: 0, jenis: 5, cnotrace: "T1", nonozle: "3", jrnkey: 202606221,
  };

  it("edc: [DELETE, INSERT … ON CONFLICT(kunci natural) DO UPDATE] — jaring kembar", () => {
    const [del, ins] = buildReplace(TABLE_CONFIG.edc!, 1, [edcRow]);
    // 1) DELETE per (unit_id, business_date)
    expect(del!.sql).toContain(
      'DELETE FROM "edc" WHERE "unit_id" = $1 AND "business_date" = ANY($2::date[])',
    );
    expect(del!.params).toEqual([1, ["2026-06-22"]]);
    // 2) INSERT dgn ON CONFLICT pada kunci natural (unit_id + 7 kolom)
    expect(ins!.sql).toContain('INSERT INTO "edc"');
    expect(ins!.sql).toContain(
      'ON CONFLICT ("unit_id","business_date","cshift","tanggaljam","nonozle","cnotrace","ckdkartu","total")',
    );
    // kolom non-key di-refresh; kolom key TIDAK
    expect(ins!.sql).toContain(
      'DO UPDATE SET "liter" = EXCLUDED."liter", "jenis" = EXCLUDED."jenis", "jrnkey" = EXCLUDED."jrnkey", "ingested_at" = now()',
    );
    expect(ins!.sql).not.toContain('"total" = EXCLUDED');
    expect(ins!.sql).not.toContain('"cshift" = EXCLUDED');
    // cast eksplisit tetap di VALUES (business_date ::date, tanggaljam ::timestamptz)
    expect(ins!.sql).toContain("::date");
    expect(ins!.sql).toContain("::timestamptz");
  });

  it("edc: kembar intra-batch (natural-key sama) → 1 tuple keep-last (cegah 21000)", () => {
    // Dua baris edc dgn kunci natural IDENTIK tapi kolom non-key beda (kasus Bakau):
    // tanpa dedup, INSERT … ON CONFLICT kena Postgres 21000.
    const later = { ...edcRow, liter: 99, jenis: 7 };
    const [, ins] = buildReplace(TABLE_CONFIG.edc!, 1, [edcRow, later]);
    // Hanya 1 tuple VALUES → batch tak punya conflict-key kembar.
    const tuples = (ins!.sql.match(/\(\$\d/g) ?? []).length;
    expect(tuples).toBe(1);
    // keep-last (= EXCLUDED): baris terakhir menang (liter 99, jenis 7).
    expect(ins!.params).toContain("99"); // liter = numeric → teks
    expect(ins!.params).toContain(7); // jenis = int → tetap number
  });

  it("pelanggan_sale: REPLACE polos — TANPA ON CONFLICT (conflict kosong)", () => {
    const [, ins] = buildReplace(TABLE_CONFIG.pelanggan_sale!, 1, [
      { business_date: "2026-06-16", ckdplg: "PLG1", vcnmplg: "A",
        ckdjualplg: "JP1", ckdbbm: "BB-07", nshift: 1, liter: 10, total: 100, sbatal: 0 },
    ]);
    expect(ins!.sql).toContain('INSERT INTO "pelanggan_sale"');
    expect(ins!.sql).not.toContain("ON CONFLICT");
  });

  it("rows kosong → error", () => {
    expect(() => buildReplace(TABLE_CONFIG.edc!, 1, [])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// E — DO UPDATE dilewati bila baris tak berubah (skipUnchanged)
// ---------------------------------------------------------------------------
describe("skipUnchanged — jangan tulis ulang baris yang sama", () => {
  /** Kolom yang benar-benar di-SET oleh buildUpsert, dibaca dari SQL-nya. */
  function setCols(sql: string): string[] {
    const m = sql.match(/DO UPDATE SET (.*?)(?: WHERE |$)/);
    return [...(m?.[1] ?? "").matchAll(/"([^"]+)" = EXCLUDED/g)].map((x) => x[1]!);
  }
  /** Kolom yang muncul di sisi kiri predikat IS DISTINCT FROM. */
  function guardCols(sql: string): string[] {
    const m = sql.match(/ WHERE \((.*?)\) IS DISTINCT FROM/);
    return [...(m?.[1] ?? "").matchAll(/\."([^"]+)"/g)].map((x) => x[1]!);
  }

  const row = {
    ckdbppiut: "P1", dtgl: "2026-08-04", ckdplg: "PLG1", vcref: null,
    vcket: null, njumlah: 1000, sjnsbp: 1, sbatal: 0,
  };

  it("PREDIKAT MENCAKUP SEMUA KOLOM YANG DI-SET — inilah pagar korektnessnya", () => {
    // Kolom yang di-SET tapi tak ikut dijaga = perubahan nyata pada kolom itu
    // DIAM-DIAM berhenti mendarat di mirror. Kegagalan senyap, bukan error.
    for (const key of ["bppiut", "bphut", "deposit", "terra_resmi"]) {
      const cfg = TABLE_CONFIG[key]!;
      const { sql } = buildUpsert(cfg, 4, [
        Object.fromEntries(cfg.columns.map((c) => [c, null])),
      ]);
      expect(guardCols(sql), `${key}: predikat ≠ kolom yang di-SET`).toEqual(setCols(sql));
      expect(guardCols(sql).length, `${key}: predikat kosong`).toBeGreaterThan(0);
      // ingested_at DI LUAR predikat — kalau ikut, tiap baris selalu "berbeda".
      expect(guardCols(sql)).not.toContain("ingested_at");
      expect(sql).toContain(`"ingested_at" = now()`);
    }
  });

  it("memakai IS DISTINCT FROM, bukan <> (kolom NULLABLE)", () => {
    // `NULL <> NULL` → NULL → WHERE tak pernah benar → baris ber-NULL berhenti
    // diperbarui SELAMANYA. Kolom vcref/vcket memang sering NULL.
    const { sql } = buildUpsert(TABLE_CONFIG.bppiut!, 4, [row]);
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).not.toMatch(/WHERE \([^)]*\) <>/);
  });

  it("tabel TANPA flag tetap seperti semula (blast radius terbatas)", () => {
    for (const key of ["sales_detail", "delivery", "opname", "product"]) {
      const cfg = TABLE_CONFIG[key];
      if (!cfg || cfg.conflict.length === 0) continue;
      const { sql } = buildUpsert(cfg, 4, [
        Object.fromEntries(cfg.columns.map((c) => [c, null])),
      ]);
      expect(sql, `${key} tak boleh ikut terpengaruh`).not.toContain("IS DISTINCT FROM");
    }
  });

  it("detektornya sendiri bisa MERAH (kontrol non-vakum)", () => {
    // Tanpa ini, regex yang meleset menghasilkan dua array kosong yang "sama".
    const bocor =
      'DO UPDATE SET "a" = EXCLUDED."a", "b" = EXCLUDED."b", "ingested_at" = now()' +
      ' WHERE ("t"."a") IS DISTINCT FROM (EXCLUDED."a")';
    expect(setCols(bocor)).toEqual(["a", "b"]);
    expect(guardCols(bocor)).toEqual(["a"]); // "b" hilang → beda → MERAH
    expect(guardCols(bocor)).not.toEqual(setCols(bocor));
    const utuh =
      'DO UPDATE SET "a" = EXCLUDED."a", "b" = EXCLUDED."b"' +
      ' WHERE ("t"."a", "t"."b") IS DISTINCT FROM (EXCLUDED."a", EXCLUDED."b")';
    expect(guardCols(utuh)).toEqual(setCols(utuh));
  });
});
