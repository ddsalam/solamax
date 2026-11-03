import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Penulis buku besar (rencana 2026-11-02 K6 U8; KTD3, R13) dengan DB TIRUAN
 * BERKEADAAN: `jurnal`, `jurnal_baris`, `tutup_bulan`, `day_close`, dan
 * `audit_log` disimulasikan; trigger seimbang (saat COMMIT) dan garis beku bulan
 * ikut ditiru. Hasil diuji dari BARIS YANG TERSIMPAN.
 *
 * ⚠️ Batas: SQL tidak dijalankan — tiruan mencocokkan pernyataan lewat potongan
 * teksnya. Constraint dan trigger 0058 yang sesungguhnya dibuktikan
 * `buku-besar.integration.test.ts` (ber-gerbang env).
 */

vi.hoisted(() => {
  // db.ts membuat Pool saat diimpor (tanpa menyambung) — pembaca EasyMax bawaan mengimpornya.
  process.env.DATABASE_URL ??= "postgres://uji@127.0.0.1:1/uji";
});

import type { BarisKas, MasukanHari } from "./buku-besar-model";
import { bentukUlangHari, bentukUlangRentang, bentukUlangSumber } from "./buku-besar-tulis";
import { KUNCI_BULAN_SQL } from "./tutup-bulan-queries";
import type { ScopedUnitId } from "./scope";

type Baris = { posKode: string; debetSen: number; kreditSen: number };
type J = {
  id: string;
  unit_id: number;
  jenis: string;
  aturan: string;
  sumber_tabel: string;
  sumber_id: string;
  tanggal_buku: string;
  tanggal_efektif: string;
  keterangan: string;
  backfill: boolean;
  alasan_maju: string | null;
  baris: Baris[];
};
type Db = {
  jurnal: J[];
  tutupBulan: { bulan: string; bukuBesar: boolean }[];
  hariTertutup: string[];
  audit: { action: string; target: string; detail: Record<string, unknown> }[];
};

const UNIT = 2 as ScopedUnitId;
const AKTOR = { userId: 7, email: "hof@contoh.test" };
let db: Db;
let seq = 0;

const salin = (d: Db): Db => structuredClone(d);

function klien(): PoolClient {
  let cadangan: Db | null = null;
  let unitIds: string[] = [];
  const ok = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
  const beku = (tanggal: string) => db.tutupBulan.some((t) => t.bukuBesar && t.bulan === tanggal.slice(0, 7));
  const tolakBeku = (tanggal: string) => {
    if (beku(tanggal)) throw new Error(`bulan ${tanggal.slice(0, 7)} sudah ditutup dengan buku besar — jurnalnya beku`);
  };
  const tampil = (j: J) => ({
    id: j.id,
    sumberTabel: j.sumber_tabel,
    sumberId: j.sumber_id,
    aturan: j.aturan,
    tanggalBuku: j.tanggal_buku,
    tanggalEfektif: j.tanggal_efektif,
    keterangan: j.keterangan,
    backfill: j.backfill,
    baris: [...j.baris].sort((a, b) => a.posKode.localeCompare(b.posKode)).map((b) => ({ ...b, debetSen: String(b.debetSen), kreditSen: String(b.kreditSen) })),
  });
  const query = async (sql: string, p: unknown[] = []) => {
    if (sql === "BEGIN") {
      cadangan = salin(db);
      return ok();
    }
    if (sql === "ROLLBACK") {
      if (cadangan) db = cadangan;
      cadangan = null;
      return ok();
    }
    if (sql === "COMMIT") {
      for (const j of db.jurnal) {
        const d = j.baris.reduce((s, b) => s + b.debetSen, 0);
        const k = j.baris.reduce((s, b) => s + b.kreditSen, 0);
        if (j.baris.length < 2 || d !== k) throw new Error(`jurnal ${j.id} tidak seimbang`);
      }
      cadangan = null;
      return ok();
    }
    if (sql.includes("set_config('app.unit_ids'")) {
      unitIds = String(p[0]).split(",");
      return ok();
    }
    if (sql.includes("transaction_isolation")) return ok([{ diScope: unitIds.includes(String(p[0])), isolasi: "read committed" }]);
    if (sql.includes("pg_advisory_xact_lock")) return ok();
    if (sql.includes("FROM app.tutup_bulan")) return ok(db.tutupBulan);
    if (sql.includes("FROM app.cash_ledger") && sql.includes("saldo_awal")) return ok([{ unit: null, akun: null }]);
    if (sql.includes("FROM app.day_close") && sql.includes("FOR SHARE")) {
      return ok(db.hariTertutup.includes(String(p[1])) ? [{ status: "closed" }] : []);
    }
    if (sql.includes("FROM app.day_close")) return ok(db.hariTertutup.filter((d) => d >= String(p[1])).map((d) => ({ d })));
    if (sql.includes("j.jenis = 'koreksi'")) {
      return ok(db.jurnal.filter((j) => j.jenis === "koreksi" && j.sumber_id === p[1]).flatMap((j) => j.baris));
    }
    if (sql.includes("j.tanggal_buku = $2::date")) {
      return ok(db.jurnal.filter((j) => j.jenis === "sumber" && j.tanggal_buku === p[1]).map(tampil));
    }
    if (sql.includes("FROM unnest($2::text[]) AS k")) {
      const k = new Set(p[1] as string[]);
      return ok(db.jurnal.filter((j) => j.jenis === "sumber" && k.has(`${j.sumber_tabel}|${j.sumber_id}`)).map(tampil));
    }
    if (sql.includes("ON CONFLICT (unit_id, sumber_tabel, sumber_id, aturan)")) {
      const [unit, tb, te, aturan, st, sid, backfill, ket] = p as [number, string, string, string, string, string, boolean, string];
      tolakBeku(tb);
      const ada = db.jurnal.find((j) => j.jenis === "sumber" && j.sumber_tabel === st && j.sumber_id === sid && j.aturan === aturan);
      if (ada) {
        tolakBeku(ada.tanggal_buku);
        Object.assign(ada, { tanggal_buku: tb, tanggal_efektif: te, backfill, keterangan: ket });
        return ok([{ id: ada.id }]);
      }
      const id = `j-${++seq}`;
      db.jurnal.push({ id, unit_id: unit, jenis: "sumber", aturan, sumber_tabel: st, sumber_id: sid, tanggal_buku: tb, tanggal_efektif: te, keterangan: ket, backfill, alasan_maju: null, baris: [] });
      return ok([{ id }]);
    }
    if (sql.includes("'koreksi', 'ADJ-FWD'")) {
      const [unit, tb, te, alasan, ket] = p as [number, string, string, string, string];
      tolakBeku(tb);
      const id = `k-${++seq}`;
      db.jurnal.push({ id, unit_id: unit, jenis: "koreksi", aturan: "ADJ-FWD", sumber_tabel: "buku_besar_hari", sumber_id: te, tanggal_buku: tb, tanggal_efektif: te, keterangan: ket, backfill: false, alasan_maju: alasan, baris: [] });
      return ok([{ id }]);
    }
    if (sql.includes("DELETE FROM app.jurnal_baris")) {
      const j = db.jurnal.find((x) => x.id === p[1])!;
      tolakBeku(j.tanggal_buku);
      j.baris = [];
      return ok();
    }
    if (sql.includes("DELETE FROM app.jurnal")) {
      const ids = new Set(p[1] as string[]);
      for (const j of db.jurnal) if (ids.has(j.id)) tolakBeku(j.tanggal_buku);
      db.jurnal = db.jurnal.filter((j) => !(ids.has(j.id) && j.jenis === "sumber"));
      return ok();
    }
    if (sql.includes("INSERT INTO app.jurnal_baris")) {
      const [jid, , pos, d, k] = p as [string, number, string[], number[], number[]];
      const j = db.jurnal.find((x) => x.id === jid)!;
      tolakBeku(j.tanggal_buku);
      pos.forEach((x, i) => j.baris.push({ posKode: x, debetSen: d[i]!, kreditSen: k[i]! }));
      return ok();
    }
    if (sql.includes("INSERT INTO app.audit_log")) {
      db.audit.push({ action: p[2] as string, target: p[3] as string, detail: JSON.parse(p[4] as string) });
      return ok();
    }
    throw new Error(`SQL tak dikenal tiruan: ${sql.slice(0, 80)}`);
  };
  return { query, release: () => {} } as unknown as PoolClient;
}

const rp = (n: number) => n * 100;
const kas = (id: string, accountId: string, amountSen: number, kategori: string): BarisKas => ({
  id,
  accountId,
  amountSen,
  kategori,
  keterangan: kategori,
  tanggalAsal: null,
  edcSettlementId: null,
  pasanganUuid: null,
  pihakLawanJenis: null,
  tertaut: [],
  penebusan: null,
});

function masukan(tanggal: string, k: BarisKas[]): MasukanHari {
  return {
    tanggal,
    produk: [],
    pelanggan: null,
    kas: k,
    pencairan: [],
    manual: [],
    posAkun: { kas: "1101", bank: "1111" },
    saldoPersediaan: { s1131: 0, s1132: 0 },
    memorial1103Sen: 0,
    tutupHari: null,
  };
}

const T = "2026-10-14";
const awal = () => [kas("setor", "kas", rp(20_000_000), "Setoran Hasil Penjualan"), kas("biaya", "bank", -rp(900_000), "Biaya Operasional")];
const koreksi = () => [kas("setor", "kas", rp(19_500_000), "Setoran Hasil Penjualan"), kas("biaya", "bank", -rp(900_000), "Biaya Operasional")];

/** Jalankan satu pembentukan dalam transaksi tiruan. */
async function jalan(tanggal: string, k: BarisKas[], o: { backfill?: boolean } = {}) {
  const c = klien();
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
  try {
    const r = await bentukUlangHari(c, UNIT, tanggal, { aktor: AKTOR, backfill: o.backfill, baca: async () => masukan(tanggal, k) });
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

const saldo = (bs: readonly Baris[]) => {
  const s: Record<string, number> = {};
  for (const b of bs) s[b.posKode] = (s[b.posKode] ?? 0) + b.debetSen - b.kreditSen;
  return s;
};

beforeEach(() => {
  db = { jurnal: [], tutupBulan: [], hariTertutup: [], audit: [] };
  seq = 0;
});

describe("bentukUlangHari — bulan terbuka: tulis ulang idempoten (KTD3)", () => {
  it("pembentukan kedua dengan sumber sama tidak mengubah apa pun", async () => {
    const r1 = await jalan(T, awal());
    expect(r1).toMatchObject({ mode: "langsung", ditulis: 2, dihapus: 0, tetap: 0 });
    const sesudah1 = structuredClone(db.jurnal);
    const r2 = await jalan(T, awal());
    expect(r2).toMatchObject({ ditulis: 0, dihapus: 0, tetap: 2 });
    expect(db.jurnal).toEqual(sesudah1);
  });

  it("sumber berubah → jurnal yang SAMA (id tetap) ditulis ulang; sumber hilang → jurnalnya dihapus", async () => {
    await jalan(T, awal());
    const idSetor = db.jurnal.find((j) => j.sumber_id === "setor")!.id;
    const r = await jalan(T, [kas("setor", "kas", rp(19_500_000), "Setoran Hasil Penjualan")]);
    expect(r).toMatchObject({ ditulis: 1, dihapus: 1 });
    expect(db.jurnal.map((j) => j.id)).toEqual([idSetor]);
    expect(saldo(db.jurnal[0]!.baris)).toEqual({ "1101": rp(19_500_000), "1103": -rp(19_500_000) });
  });

  it("hari yang sudah tutup hari di bulan terbuka tetap ditulis langsung (R13)", async () => {
    db.hariTertutup = [T];
    const r = await jalan(T, awal());
    expect(r.mode).toBe("langsung");
    expect(db.jurnal.every((j) => j.tanggal_buku === T)).toBe(true);
  });

  it("setiap pembentukan tercatat di audit_log", async () => {
    await jalan(T, awal());
    await jalan(T, awal());
    expect(db.audit.map((a) => a.action)).toEqual(["buku_besar.bentuk_ulang", "buku_besar.bentuk_ulang"]);
    expect(db.audit[0]!.detail).toMatchObject({ mode: "langsung", ditulis: 2 });
  });
});

describe("bentukUlangHari — bulan tertutup: satu koreksi maju (KTD3, R13)", () => {
  const hariOkt = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

  it("sumber di bulan tertutup berubah → jurnal lama tak disentuh, satu koreksi bernilai selisihnya di hari buka pertama", async () => {
    await jalan(T, awal());
    const lama = structuredClone(db.jurnal);
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: true }];
    db.hariTertutup = [...hariOkt, "2026-11-01"];

    const r = await jalan(T, koreksi());
    expect(r.mode).toBe("koreksi_maju");
    expect(db.jurnal.filter((j) => j.jenis === "sumber")).toEqual(lama);
    const kor = db.jurnal.filter((j) => j.jenis === "koreksi");
    expect(kor).toHaveLength(1);
    expect(kor[0]).toMatchObject({ tanggal_buku: "2026-11-02", tanggal_efektif: T, alasan_maju: "ADJ-FWD-LEDGER" });
    expect(saldo(kor[0]!.baris)).toEqual({ "1101": -rp(500_000), "1103": rp(500_000) });
  });

  it("pembentukan ulang berikutnya tanpa perubahan tidak menambah koreksi kedua", async () => {
    await jalan(T, awal());
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: true }];
    db.hariTertutup = hariOkt;
    await jalan(T, koreksi());
    await jalan(T, koreksi());
    expect(db.jurnal.filter((j) => j.jenis === "koreksi")).toHaveLength(1);
  });

  it("bulan tertutup tanpa perubahan → tanpa koreksi", async () => {
    await jalan(T, awal());
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: true }];
    const r = await jalan(T, awal());
    expect(r.koreksi).toBeNull();
    expect(db.jurnal.filter((j) => j.jenis === "koreksi")).toEqual([]);
  });
});

describe("backfill (KTD3) — satu kali, tidak ke bulan yang ditutup dengan buku besar", () => {
  it("bulan ditutup K5, belum ada tutup buku besar → ditulis langsung bertanda backfill", async () => {
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: false }];
    const r = await jalan(T, awal(), { backfill: true });
    expect(r).toMatchObject({ mode: "langsung", backfill: true, ditulis: 2 });
    expect(db.jurnal.every((j) => j.backfill)).toBe(true);
  });

  it("backfill ke bulan yang sudah ditutup dengan buku besar → ditolak, tidak ada yang tertulis", async () => {
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: true }];
    await expect(jalan(T, awal(), { backfill: true })).rejects.toThrow(/ditolak/);
    expect(db.jurnal).toEqual([]);
    expect(db.audit).toEqual([]);
  });

  it("bentukUlangRentang menolak SELURUH rentang yang memuat bulan beku sebelum hari pertama", async () => {
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: true }];
    let dibaca = 0;
    const r = await bentukUlangRentang(async () => klien(), UNIT, "2026-10-30", "2026-11-02", {
      aktor: AKTOR,
      baca: async (_c, _u, t) => {
        dibaca++;
        return masukan(t, awal());
      },
    });
    expect(r.ok).toBe(false);
    expect(dibaca).toBe(0);
    expect(db.jurnal).toEqual([]);
  });

  it("bentukUlangRentang: satu transaksi per hari, urut, idempoten bila diulang", async () => {
    const opsi = { aktor: AKTOR, baca: async (_c: PoolClient, _u: ScopedUnitId, t: string) => masukan(t, awal().map((k) => ({ ...k, id: `${k.id}-${t}` }))) };
    const r1 = await bentukUlangRentang(async () => klien(), UNIT, "2026-10-01", "2026-10-03", opsi);
    expect(r1.ok).toBe(true);
    expect(r1.hari.map((h) => h.tanggal)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(db.jurnal).toHaveLength(6);
    const r2 = await bentukUlangRentang(async () => klien(), UNIT, "2026-10-01", "2026-10-03", opsi);
    expect(r2.hari.every((h) => h.ditulis === 0 && h.tetap === 2)).toBe(true);
    expect(db.jurnal).toHaveLength(6);
  });
});

describe("bentukUlangSumber — hanya kunci yang disebut (KTD3 pemicu 1)", () => {
  it("jurnal sumber lain di hari itu tidak dihapus walau tak terlihat di bacaan", async () => {
    await jalan(T, awal());
    const c = klien();
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
    // Bacaan hanya memuat setoran (baris biaya "milik penulis lain").
    const r = await bentukUlangSumber(c, UNIT, T, [{ sumberTabel: "cash_ledger", sumberId: "setor" }], {
      aktor: AKTOR,
      baca: async () => masukan(T, [kas("setor", "kas", rp(19_500_000), "Setoran Hasil Penjualan")]),
    });
    expect(r).toMatchObject({ ditulis: 1, dihapus: 0 });
    expect(db.jurnal.map((j) => j.sumber_id).sort()).toEqual(["biaya", "setor"]);
    expect(saldo(db.jurnal.find((j) => j.sumber_id === "setor")!.baris)["1101"]).toBe(rp(19_500_000));
  });

  it("sumber yang dibatalkan → jurnalnya dihapus", async () => {
    await jalan(T, awal());
    const c = klien();
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
    await bentukUlangSumber(c, UNIT, T, [{ sumberTabel: "cash_ledger", sumberId: "biaya" }], {
      aktor: AKTOR,
      baca: async () => masukan(T, [kas("setor", "kas", rp(20_000_000), "Setoran Hasil Penjualan")]),
    });
    expect(db.jurnal.map((j) => j.sumber_id)).toEqual(["setor"]);
  });

  it("bulan tertutup → ditolak", async () => {
    db.tutupBulan = [{ bulan: "2026-10", bukuBesar: false }];
    const c = klien();
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
    await expect(
      bentukUlangSumber(c, UNIT, T, [{ sumberTabel: "cash_ledger", sumberId: "setor" }], { aktor: AKTOR, baca: async () => masukan(T, awal()) }),
    ).rejects.toThrow(/tertutup/);
  });
});

describe("prasyarat", () => {
  it("tanpa app.unit_ids berisi unit → menolak sebelum menulis", async () => {
    const c = klien();
    await expect(bentukUlangHari(c, UNIT, T, { aktor: AKTOR, baca: async () => masukan(T, awal()) })).rejects.toThrow(/app\.unit_ids/);
    expect(db.jurnal).toEqual([]);
  });

  it("sebelum 1 Okt 2026 → menolak", async () => {
    await expect(jalan("2026-09-30", awal())).rejects.toThrow(/dimulai/);
  });

  it("kunci bulan BERSAMA memakai ekspresi kunci tutupBulan yang sama (KUNCI_BULAN_SQL, satu salinan)", async () => {
    const c = klien();
    const asli = c.query.bind(c) as (s: string, p?: unknown[]) => Promise<unknown>;
    const kunci: { sql: string; params: unknown[] }[] = [];
    (c as unknown as { query: typeof asli }).query = (s, p = []) => {
      if (s.includes("pg_advisory_xact_lock_shared")) kunci.push({ sql: s, params: p });
      return asli(s, p);
    };
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT)]);
    await bentukUlangHari(c, UNIT, T, { aktor: AKTOR, baca: async () => masukan(T, awal()) });
    expect(kunci).toContainEqual({ sql: `SELECT pg_advisory_xact_lock_shared(${KUNCI_BULAN_SQL})`, params: [UNIT, "2026-10"] });
  });
});
