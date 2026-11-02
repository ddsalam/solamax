import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

/**
 * SETTLEMENT EDC di DB nyata (rencana 2026-11-02 U3/U5; R3, R6, R7, R9, R11) —
 * lewat SERVER ACTION ASLI dengan sesi Keuangan tiruan, pola
 * `scripts/uji-ulang-tuntaskan.live.test.ts`. Yang tak bisa dibuktikan penjaga
 * teks: CHECK `edc_settlement_posted_pair` menerima pengosongan persetujuan,
 * kunci hari buku benar-benar menolak hari tertutup, dan Pemantauan membaca
 * pembatalan utuh sebagai SATU kejadian kuning — juga sesudah disetujui ulang.
 *
 * Unit fiktif 8810 (`UJI-8810`), tanggal 2099 yang unik per jalan — tak
 * menyentuh unit nyata, dan tak bertabrakan dengan jalan sebelumnya. Baris
 * dibiarkan (void / hari tertutup 2099): tier testing, unit fiktif.
 *
 * ⛔ Gated & tier TESTING saja (`solamax-pg-rlsstg`), jangan pernah DB pilot:
 *
 *   cd apps/dashboard
 *   EDC_SETTLEMENT_LIVE_DB=1 DATABASE_URL="postgresql://dashboard_app:…@127.0.0.1:PORT/solamax?options=…" \
 *     npx vitest run src/lib/edc-settlement.integration.test.ts
 *
 * Hari tertutup buatan uji dibuka kembali di `afterAll` (DELETE dicabut dari
 * `dashboard_app`, jadi statusnya yang dikembalikan).
 */
const LIVE = process.env.EDC_SETTLEMENT_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const UNIT = { unit_id: 8810, code: "UJI-8810", name: "Uji ulang" };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 0,
    role: "keuangan",
    email: "uji-settlement-edc@sintetis.invalid",
    units: [UNIT],
    requireUnit(code: string) {
      if (code !== UNIT.code) throw new Error("NEXT_NOT_FOUND");
      return UNIT;
    },
  })),
}));

// Diimpor HANYA saat LIVE: `db.ts` menolak dimuat tanpa DATABASE_URL, dan CI
// tidak punya DB — impor statis akan menggagalkan berkas yang mestinya dilewati.
type Aksi = typeof import("./edc-actions");
type Pantau = typeof import("./keuangan-pantau-queries");
const aksi = (LIVE ? await import("./edc-actions") : null) as Aksi;
const pantau = (LIVE ? await import("./keuangan-pantau-queries") : null) as Pantau;
const simpanSettlement: Aksi["simpanSettlement"] = (...a) => aksi.simpanSettlement(...a);
const setujuiPencairan: Aksi["setujuiPencairan"] = (...a) => aksi.setujuiPencairan(...a);
const batalkanPencairan: Aksi["batalkanPencairan"] = (...a) => aksi.batalkanPencairan(...a);
const ubahSettlement: Aksi["ubahSettlement"] = (...a) => aksi.ubahSettlement(...a);
const batalkanSettlement: Aksi["batalkanSettlement"] = (...a) => aksi.batalkanSettlement(...a);
const getBahanPantau: Pantau["getBahanPantau"] = (...a) => pantau.getBahanPantau(...a);

d("settlement EDC — batalkan pencairan, ubah, batalkan batch (DB testing)", () => {
  let pool: Pool;
  const jalan = Date.now().toString(36);
  // Tanggal 2099 unik per jalan: hari ke-1..300 dari angka jalan.
  const hari = (n: number): string => {
    const t = new Date(Date.UTC(2099, 0, 1 + ((Number.parseInt(jalan, 36) + n) % 300)));
    return t.toISOString().slice(0, 10);
  };
  const D1 = hari(0);
  const D2 = hari(150);
  const ACQ = `UJI EDC ${jalan}`.toUpperCase();
  let bank = "";

  const q = async <T,>(sql: string, p: unknown[] = []): Promise<T[]> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(UNIT.unit_id)]);
      const r = await c.query(sql, p);
      await c.query("COMMIT");
      return r.rows as T[];
    } finally {
      c.release();
    }
  };
  const isian = (no: string, tgl: string, gross: number, net: number) => ({
    code: UNIT.code,
    date: tgl,
    acquirer: ACQ,
    settlementNo: no,
    settlementDate: tgl,
    businessDate: tgl,
    toAccountId: bank,
    grossRp: gross,
    netRp: net,
    txnTotalRp: null,
    reasonCode: null,
  });
  const idBatch = async (no: string): Promise<string> =>
    (await q<{ id: string }>(`SELECT id::text AS id FROM app.edc_settlement WHERE unit_id=$1 AND acquirer=$2 AND settlement_no=$3 AND NOT void`, [UNIT.unit_id, ACQ, no]))[0]!.id;
  const kaki = (id: string) =>
    q<{ void: boolean; voidedAt: string | null }>(
      `SELECT void, voided_at::text AS "voidedAt" FROM app.cash_ledger WHERE unit_id=$1 AND edc_settlement_id=$2::uuid ORDER BY created_at`,
      [UNIT.unit_id, id],
    );
  const kejadianBatch = async (id: string) => {
    const b = await getBahanPantau([UNIT.unit_id as never], new Date().toISOString().slice(0, 10));
    const ket = (await q<{ keterangan: string }>(`SELECT DISTINCT keterangan FROM app.cash_ledger WHERE edc_settlement_id=$1::uuid`, [id])).map((r) => r.keterangan);
    return b.kejadian.filter((k) => ket.some((t) => k.keterangan.endsWith(t)) || k.keterangan.includes(ket[0] ?? "§"));
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const akun = await q<{ id: string; kind: string }>(
      `SELECT id::text AS id, kind::text AS kind FROM app.cash_account WHERE unit_id=$1 AND active`,
      [UNIT.unit_id],
    );
    bank = akun.find((a) => a.kind === "bank")?.id ?? "";
    if (bank === "") {
      bank = (await q<{ id: string }>(`INSERT INTO app.cash_account (unit_id, nama, kind) VALUES ($1,'Bank Uji EDC','bank') RETURNING id::text AS id`, [UNIT.unit_id]))[0]!.id;
    }
    if (!akun.some((a) => a.kind === "edc_penampungan")) {
      await q(`INSERT INTO app.cash_account (unit_id, nama, kind) VALUES ($1,'EDC Penampungan','edc_penampungan')`, [UNIT.unit_id]);
    }
  });
  afterAll(async () => {
    if (pool) {
      await q(`UPDATE app.day_close SET status='open' WHERE unit_id=$1 AND business_date=$2::date`, [UNIT.unit_id, D2]);
      await pool.end();
    }
  });

  it("Covers AE1/R3/R11 — setujui → batalkan → setujui ulang; satu kejadian kuning tiap pembatalan", async () => {
    expect(await simpanSettlement(isian(`A-${jalan}`, D1, 1_000_000, 990_000))).toEqual({ ok: true });
    const id = await idBatch(`A-${jalan}`);

    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    expect((await kaki(id)).filter((k) => !k.void)).toHaveLength(2);

    expect(await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    const sesudah = await kaki(id);
    expect(sesudah.every((k) => k.void)).toBe(true);
    expect(new Set(sesudah.map((k) => k.voidedAt)).size).toBe(1); // satu transaksi
    const mdr = await q<{ void: boolean }>(`SELECT void FROM app.noncash_expense WHERE edc_settlement_id=$1::uuid`, [id]);
    expect(mdr).toEqual([{ void: true }]);
    const b = await q<{ posted: boolean }>(`SELECT (posted_at IS NOT NULL) AS posted FROM app.edc_settlement WHERE id=$1::uuid`, [id]);
    expect(b).toEqual([{ posted: false }]);
    // Pembatalan kedua pada batch yang sama tidak menemukan apa pun.
    expect((await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: id })).ok).toBe(false);

    const sebelumUlang = await kejadianBatch(id);
    expect(sebelumUlang.filter((k) => k.jenis === "batal_pencairan_edc")).toHaveLength(1);
    expect(sebelumUlang.filter((k) => k.jenis === "batal_kaki_edc" || k.jenis === "batal_beban_nonkas")).toHaveLength(0);

    // Setujui ulang: tiga kaki baru; pembatalan lama tetap SATU kejadian kuning.
    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    expect((await kaki(id)).filter((k) => !k.void)).toHaveLength(2);
    const sesudahUlang = await kejadianBatch(id);
    expect(sesudahUlang.filter((k) => k.jenis === "batal_pencairan_edc")).toHaveLength(1);
    expect(sesudahUlang.filter((k) => k.jenis === "batal_kaki_edc" || k.jenis === "batal_beban_nonkas")).toHaveLength(0);
  });

  it("R7/R8/R9 — batch belum dicairkan bisa diubah & dibatalkan; yang sudah dicairkan tidak", async () => {
    expect(await simpanSettlement(isian(`B-${jalan}`, D1, 500_000, 495_000))).toEqual({ ok: true });
    const id = await idBatch(`B-${jalan}`);
    expect(await ubahSettlement({ ...isian(`B-${jalan}`, D1, 600_000, 594_000), id })).toEqual({ ok: true });
    const mdr = await q<{ mdr: string }>(`SELECT mdr_rp::text AS mdr FROM app.edc_settlement WHERE id=$1::uuid`, [id]);
    expect(Number(mdr[0]!.mdr)).toBe(6_000);

    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    expect((await ubahSettlement({ ...isian(`B-${jalan}`, D1, 700_000, 690_000), id })).ok).toBe(false);
    expect((await batalkanSettlement({ code: UNIT.code, date: D1, id })).ok).toBe(false);

    expect(await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    expect(await batalkanSettlement({ code: UNIT.code, date: D1, id })).toEqual({ ok: true });
    const v = await q<{ void: boolean }>(`SELECT void FROM app.edc_settlement WHERE id=$1::uuid`, [id]);
    expect(v).toEqual([{ void: true }]);
  });

  it("Covers AE4/R6 — hari tertutup: pembatalan DAN persetujuan ulang ditolak, tak ada baris berubah", async () => {
    expect(await simpanSettlement(isian(`C-${jalan}`, D2, 800_000, 792_000))).toEqual({ ok: true });
    const id = await idBatch(`C-${jalan}`);
    expect(await setujuiPencairan({ code: UNIT.code, date: D2, settlementId: id })).toEqual({ ok: true });

    await q(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier, closed_by_user_id, closed_at)
       VALUES ($1, $2::date, 'closed', 0, 'within_tolerance', 0, now())
       ON CONFLICT (unit_id, business_date) DO UPDATE SET status='closed'`,
      [UNIT.unit_id, D2],
    );
    const r = await batalkanPencairan({ code: UNIT.code, date: D2, settlementId: id });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(D2);
    expect((await kaki(id)).filter((k) => !k.void)).toHaveLength(2);

    // Batch lain, belum dicairkan, ke hari yang sama-sama tertutup: persetujuan ditolak.
    expect(await simpanSettlement(isian(`E-${jalan}`, D2, 300_000, 297_000))).toEqual({ ok: true });
    const id2 = await idBatch(`E-${jalan}`);
    expect((await setujuiPencairan({ code: UNIT.code, date: D2, settlementId: id2 })).ok).toBe(false);
    expect(await kaki(id2)).toHaveLength(0);
  });

  it("nomor settlement ganda untuk EDC yang sama ditolak dengan pesan, saat simpan maupun ubah", async () => {
    expect(await simpanSettlement(isian(`F-${jalan}`, D1, 200_000, 198_000))).toEqual({ ok: true });
    const r = await simpanSettlement(isian(`F-${jalan}`, D1, 210_000, 208_000));
    expect(r.ok ? "" : r.error).toMatch(/sudah dipakai/);
    expect(await simpanSettlement(isian(`G-${jalan}`, D1, 220_000, 218_000))).toEqual({ ok: true });
    const idG = await idBatch(`G-${jalan}`);
    const u = await ubahSettlement({ ...isian(`F-${jalan}`, D1, 220_000, 218_000), id: idG });
    expect(u.ok ? "" : u.error).toMatch(/sudah dipakai/);
  });

  it("Covers AE3/R5 — kaki yang sudah dicocokkan rekening koran menolak pembatalan, tak ada baris berubah", async () => {
    expect(await simpanSettlement(isian(`H-${jalan}`, D1, 400_000, 396_000))).toEqual({ ok: true });
    const id = await idBatch(`H-${jalan}`);
    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: id })).toEqual({ ok: true });
    const leg = (await q<{ id: string }>(`SELECT id::text AS id FROM app.cash_ledger WHERE edc_settlement_id=$1::uuid AND NOT void LIMIT 1`, [id]))[0]!.id;
    const cocok = (await q<{ id: string }>(`INSERT INTO app.cocok_bank (unit_id, cara, dibuat_by_user_id) VALUES ($1,'manual',0) RETURNING id::text AS id`, [UNIT.unit_id]))[0]!.id;
    await q(`INSERT INTO app.cocok_bank_baris (unit_id, cocok_id, cash_ledger_id) VALUES ($1,$2::uuid,$3::uuid)`, [UNIT.unit_id, cocok, leg]);
    const r = await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: id });
    expect(r.ok ? "" : r.error).toMatch(/rekening koran/);
    expect((await kaki(id)).filter((k) => !k.void)).toHaveLength(2);
  });

  it("batalkan pencairan & batch sekaligus: kaki void, batch void; 'saja' meninggalkan batch bertanda pernah dibatalkan", async () => {
    const { getSettlements } = (await import("./keuangan-input-queries")) as typeof import("./keuangan-input-queries");
    expect(await simpanSettlement(isian(`J-${jalan}`, D1, 700_000, 693_000))).toEqual({ ok: true });
    const idJ = await idBatch(`J-${jalan}`);
    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: idJ })).toEqual({ ok: true });
    expect(await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: idJ, jugaBatch: true })).toEqual({ ok: true });
    expect((await kaki(idJ)).every((k) => k.void)).toBe(true);
    const v = await q<{ void: boolean; posted: boolean }>(`SELECT void, (posted_at IS NOT NULL) AS posted FROM app.edc_settlement WHERE id=$1::uuid`, [idJ]);
    expect(v).toEqual([{ void: true, posted: false }]);

    expect(await simpanSettlement(isian(`K-${jalan}`, D1, 710_000, 703_000))).toEqual({ ok: true });
    const idK = await idBatch(`K-${jalan}`);
    expect(await setujuiPencairan({ code: UNIT.code, date: D1, settlementId: idK })).toEqual({ ok: true });
    expect(await batalkanPencairan({ code: UNIT.code, date: D1, settlementId: idK })).toEqual({ ok: true });
    const rows = await getSettlements(UNIT.unit_id as never, D1, D1);
    expect(rows.find((r) => r.id === idK)).toMatchObject({ posted: false, void: false, pernahDibatalkan: true });
    expect(rows.find((r) => r.id === idJ)).toMatchObject({ void: true });
  });
});
