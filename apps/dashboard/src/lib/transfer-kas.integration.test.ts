import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ScopedUnitId } from "./scope";
import type { KonfirmasiJadikan } from "./transfer-kas-model";

type Tulis = typeof import("./transfer-kas-tulis");

/**
 * TRANSFER KAS BESAR → BANK di Postgres NYATA (rencana 2026-11-11 U1/U3/U6) —
 * inti tulis yang SAMA dengan `catatTransferKeBank` / `batalkanTransfer` /
 * `jadikanTransfer`, plus pembentuk jurnal, di dalam transaksi yang SELALU
 * di-ROLLBACK (kecuali uji kiriman bersamaan, yang memang butuh dua COMMIT).
 *
 * Yang dibuktikan, dan tak bisa dibuktikan tiruan: CHECK & indeks unik 0062,
 * RLS `unit_scope` atas rekening unit lain, penjaga hari tertutup
 * (`hariBukuTerkunci`), dan jurnal P6 nyata (1190 nol, tanpa 1103).
 *
 * ⛔ HANYA Postgres LOKAL SEKALI PAKAI yang sudah dimigrasi sampai 0062 —
 * JANGAN arahkan ke DB tier mana pun (testing maupun pilot). Fixture unit uji
 * (unit_id 9901/9902, kode `UJI-TF*`) di-COMMIT sekali ke DB lokal itu.
 *
 *   TRANSFER_LIVE_DB=1 TRANSFER_DB_URL=postgresql://ingest:…@127.0.0.1:<port>/<db_lokal> \
 *     pnpm --filter @solamax/dashboard exec vitest run src/lib/transfer-kas.integration.test.ts
 */
const LIVE = process.env.TRANSFER_LIVE_DB === "1" && !!process.env.TRANSFER_DB_URL;
const d = LIVE ? describe : describe.skip;

const AKTOR = { userId: 24, email: "uji-transfer@contoh.test" };
const A = 9901;
const B = 9902;
const HARI = "2026-10-14";
const BESOK = "2026-10-15";

d("transfer Kas Besar → bank — dua kaki, DB nyata", () => {
  let pool: Pool;
  let applied = false;
  // Diimpor sesudah DATABASE_URL di-set: modul itu menarik `db.ts` lewat `tutup-bulan-queries`.
  let tulisTransferKeBank: Tulis["tulisTransferKeBank"];
  let tulisBatalTransfer: Tulis["tulisBatalTransfer"];
  let tulisJadikanTransfer: Tulis["tulisJadikanTransfer"];
  let galatKunciGanda: Tulis["galatKunciGanda"];
  const akun = { kas: "", bank: "", bankB: "" };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= process.env.TRANSFER_DB_URL;
    ({ tulisTransferKeBank, tulisBatalTransfer, tulisJadikanTransfer, galatKunciGanda } = await import("./transfer-kas-tulis"));
    pool = new Pool({ connectionString: process.env.TRANSFER_DB_URL, max: 4 });
    const db = await pool.query<{ db: string; ada: boolean }>(
      `SELECT current_database() AS db,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='app' AND table_name='cash_ledger' AND column_name='transfer_uuid') AS ada`,
    );
    applied = db.rows[0]?.ada === true;
    if (!applied) return;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [`${A},${B}`]);
      const t = await c.query<{ id: string }>(
        `INSERT INTO app.tenant (name, slug) VALUES ('Uji transfer', 'uji-transfer')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id::text AS id`,
      );
      for (const [u, kode] of [[A, "UJI-TF-A"], [B, "UJI-TF-B"]] as const) {
        await c.query(
          `INSERT INTO public.unit (unit_id, code, name, api_key_hash, tenant_id)
           VALUES ($1, $2, $2, 'tanpa-kunci-' || $2, $3::uuid) ON CONFLICT (unit_id) DO NOTHING`,
          [u, kode, t.rows[0]!.id],
        );
      }
      const pastikan = async (unit: number, nama: string, kind: string): Promise<string> => {
        const ada = await c.query<{ id: string }>(`SELECT id::text AS id FROM app.cash_account WHERE unit_id=$1 AND nama=$2`, [unit, nama]);
        if (ada.rows[0]) return ada.rows[0].id;
        return (
          await c.query<{ id: string }>(
            `INSERT INTO app.cash_account (unit_id, nama, kind) VALUES ($1, $2, $3::app.cash_account_kind) RETURNING id::text AS id`,
            [unit, nama, kind],
          )
        ).rows[0]!.id;
      };
      akun.kas = await pastikan(A, "Kas Besar", "kas");
      akun.bank = await pastikan(A, "Bank UJI …0001", "bank");
      akun.bankB = await pastikan(B, "Bank UJI B …0002", "bank");
      await c.query(
        `INSERT INTO app.pos_unit (unit_id, kode, nama, kode_induk, cash_account_id)
         SELECT $1, '1111', 'Bank UJI', '1110', $2::uuid
          WHERE NOT EXISTS (SELECT 1 FROM app.pos_unit WHERE unit_id = $1 AND kode = '1111')`,
        [A, akun.bank],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  const tx = async (fn: (c: PoolClient) => Promise<void>, scope = String(A)): Promise<void> => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      await c.query("SELECT set_config('app.unit_ids', $1, true)", [scope]);
      await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };
  const unit = A as ScopedUnitId;
  const catat = (c: PoolClient, o: Partial<{ tanggal: string; bankAccountId: string; amount: number; kunci: string }> = {}) =>
    tulisTransferKeBank(c, {
      unitId: unit,
      unitCode: "UJI-TF-A",
      aktor: AKTOR,
      tanggal: HARI,
      bankAccountId: akun.bank,
      amount: 399_979_000,
      keterangan: `Setoran ke Bank ${HARI}`,
      kunci: randomUUID(),
      ...o,
    });
  const kaki = async (c: PoolClient, kunci: string) =>
    (
      await c.query<{ id: string; account: string; hari: string; kategori: string; amount: string; void: boolean; asal: string | null; alasan: string | null; oleh: number }>(
        `SELECT id::text AS id, account_id::text AS account, to_char(business_date,'YYYY-MM-DD') AS hari,
                category_label AS kategori, amount::text AS amount, void,
                to_char(tanggal_asal,'YYYY-MM-DD') AS asal, alasan_maju AS alasan, created_by_user_id AS oleh
           FROM app.cash_ledger WHERE unit_id = $1 AND transfer_uuid = $2::uuid ORDER BY amount`,
        [A, kunci],
      )
    ).rows;
  const jurnalPos = async (c: PoolClient, ids: string[]) =>
    (
      await c.query<{ pos: string; net: string }>(
        `SELECT b.pos_kode AS pos, sum(b.debet_sen - b.kredit_sen)::text AS net
           FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
          WHERE j.unit_id = $1 AND j.sumber_tabel = 'cash_ledger' AND j.sumber_id = ANY($2::text[])
          GROUP BY b.pos_kode ORDER BY b.pos_kode`,
        [A, ids],
      )
    ).rows;
  const bentuk = async (c: PoolClient) => {
    const { bentukJurnalSesudahTulis } = await import("./buku-besar-tulis");
    return bentukJurnalSesudahTulis(c, unit, AKTOR);
  };
  const tutupHari = (c: PoolClient, hari: string) =>
    c.query(
      `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier, closed_by_user_id, closed_at)
       VALUES ($1, $2::date, 'closed', 0, 'within_tolerance', 2, now())`,
      [A, hari],
    );
  const cocokkan = async (c: PoolClient, kasId: string) => {
    const g = await c.query<{ id: string }>(
      `INSERT INTO app.cocok_bank (unit_id, cara, dibuat_by_user_id) VALUES ($1, 'manual', 2) RETURNING id::text AS id`,
      [A],
    );
    await c.query(`INSERT INTO app.cocok_bank_baris (unit_id, cocok_id, cash_ledger_id) VALUES ($1, $2::uuid, $3::uuid)`, [A, g.rows[0]!.id, kasId]);
  };
  const audit = async (c: PoolClient, action: string, target: string) =>
    (await c.query<{ detail: Record<string, unknown> }>(`SELECT detail FROM app.audit_log WHERE action = $1 AND target = $2`, [action, target])).rows;

  it("prasyarat: DB lokal sudah dimigrasi sampai 0062 dan fixture ada", () => {
    expect(applied).toBe(true);
    expect(akun.kas && akun.bank && akun.bankB).toBeTruthy();
  });

  describe("U1 · skema 0062", () => {
    const sisip = (c: PoolClient, kategori: string, sisi: "debet" | "kredit", amount: number, o: { transfer?: string; pasangan?: string } = {}) =>
      c.query(
        `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount,
                                      created_by_user_id, transfer_uuid, pasangan_uuid)
         VALUES ($1, $2::uuid, $3::date, 'uji', $4::app.cash_mutation_jenis, $4::text::app.cash_mutation_side, $5, $6, 1, $7::uuid, $8::uuid)`,
        [A, sisi === "debet" ? akun.bank : akun.kas, HARI, sisi, kategori, amount, o.transfer ?? null, o.pasangan ?? null],
      );
    const gagal = async (c: PoolClient, f: () => Promise<unknown>): Promise<string> => {
      await c.query("SAVEPOINT s");
      try {
        await f();
        await c.query("RELEASE SAVEPOINT s");
        return "";
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT s");
        return (e as { constraint?: string }).constraint ?? String(e);
      }
    };

    it("CHECK: transfer_uuid + pasangan_uuid sekaligus ditolak", () =>
      tx(async (c) => {
        expect(await gagal(c, () => sisip(c, "Pindah Buku", "debet", 10, { transfer: randomUUID(), pasangan: randomUUID() }))).toBe(
          "cash_ledger_transfer_bukan_antar_unit",
        );
      }));
    it("CHECK: transfer_uuid berkategori 'Pembelian BBM' ditolak", () =>
      tx(async (c) => {
        expect(await gagal(c, () => sisip(c, "Pembelian BBM", "kredit", -10, { transfer: randomUUID() }))).toBe("cash_ledger_transfer_kategori");
      }));
    it("UNIQUE: (transfer_uuid, account_id) ganda ditolak", () =>
      tx(async (c) => {
        const k = randomUUID();
        expect(await gagal(c, () => sisip(c, "Pindah Buku", "debet", 10, { transfer: k }))).toBe("");
        expect(await gagal(c, () => sisip(c, "Pindah Buku", "debet", 10, { transfer: k }))).toBe("cash_ledger_transfer_akun_uq");
      }));
    it("ADJ-FWD-TRANSFER ada, applies_to = adjustment", async () => {
      const r = await pool.query(`SELECT applies_to FROM app.reason_code WHERE code = 'ADJ-FWD-TRANSFER'`);
      expect(r.rows).toEqual([{ applies_to: "adjustment" }]);
    });
  });

  describe("U3 · catat transfer", () => {
    it("Covers AE1. Hari terbuka: dua kaki, satu kunci, jurnal P6 — 1190 net 0, TANPA 1103; audit tercatat", () =>
      tx(async (c) => {
        const kunci = randomUUID();
        const r = await catat(c, { kunci });
        expect(r).toMatchObject({ ok: true, sudahAda: false, hariBuku: HARI, maju: false });
        const k = await kaki(c, kunci);
        expect(k.map((x) => [x.account, x.kategori, x.amount, x.hari, x.oleh])).toEqual([
          [akun.kas, "Setoran ke Bank", "-399979000.00", HARI, 24],
          [akun.bank, "Pindah Buku", "399979000.00", HARI, 24],
        ]);
        expect((await bentuk(c)).gagal).toEqual([]);
        expect(await jurnalPos(c, k.map((x) => x.id))).toEqual([
          { pos: "1101", net: "-39997900000" },
          { pos: "1111", net: "39997900000" },
          { pos: "1190", net: "0" },
        ]);
        const semua = await c.query<{ pos: string }>(
          `SELECT DISTINCT b.pos_kode AS pos FROM app.jurnal j JOIN app.jurnal_baris b ON b.jurnal_id = j.id
            WHERE j.unit_id = $1 AND j.sumber_id = ANY($2::text[]) ORDER BY 1`,
          [A, k.map((x) => x.id)],
        );
        expect(semua.rows.map((x) => x.pos)).toEqual(["1101", "1111", "1190"]);
        const a = await audit(c, "kas.transfer.catat", `UJI-TF-A/${kunci}`);
        expect(a).toHaveLength(1);
        expect(a[0]!.detail).toMatchObject({ kas: k[0]!.id, bank: k[1]!.id, hariBuku: HARI });
      }));

    it("idempoten: kunci yang sama dua kali ⇒ satu pasangan, panggilan kedua 'sudahAda'", () =>
      tx(async (c) => {
        const kunci = randomUUID();
        expect((await catat(c, { kunci })).ok).toBe(true);
        expect(await catat(c, { kunci })).toEqual({ ok: true, sudahAda: true });
        expect(await kaki(c, kunci)).toHaveLength(2);
      }));

    it("Covers AE2. Hari tertutup ⇒ kedua kaki di hari terbuka berikutnya, tanggal_asal + ADJ-FWD-TRANSFER", () =>
      tx(async (c) => {
        await tutupHari(c, HARI);
        const kunci = randomUUID();
        const r = await catat(c, { kunci });
        expect(r).toMatchObject({ ok: true, hariBuku: BESOK, maju: true });
        expect((await kaki(c, kunci)).map((x) => [x.hari, x.asal, x.alasan])).toEqual([
          [BESOK, HARI, "ADJ-FWD-TRANSFER"],
          [BESOK, HARI, "ADJ-FWD-TRANSFER"],
        ]);
      }));

    it("bulan tertutup ⇒ ditolak, tak ada baris", () =>
      tx(async (c) => {
        await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id) VALUES ($1, '2026-10-01', 2)`, [A]);
        const kunci = randomUUID();
        const r = await catat(c, { kunci });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/Bulan tanggal ini sudah ditutup/);
        expect(await kaki(c, kunci)).toEqual([]);
      }));

    it("pra-cut-over ⇒ ditolak", () =>
      tx(async (c) => {
        await c.query(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, amount, saldo_awal, created_by_user_id)
           VALUES ($1, $2::uuid, '2026-10-20', 'Saldo pembuka', 'adjustment', 1000, true, 2)`,
          [A, akun.kas],
        );
        const r = await catat(c);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/mendahului saldo pembuka \(2026-10-20\)/);
      }));

    it("tujuan salah: rekening bank unit LAIN (RLS) dan Kas Besar sendiri ⇒ ditolak", () =>
      tx(async (c) => {
        const lain = await catat(c, { bankAccountId: akun.bankB });
        expect(lain.ok).toBe(false);
        if (!lain.ok) expect(lain.error).toMatch(/harus rekening bank unit ini/);
        const kas = await catat(c, { bankAccountId: akun.kas });
        expect(kas.ok).toBe(false);
      }));

    it("atomik: kaki bank gagal ⇒ kaki Kas Besar ikut batal (tak ada baris tersisa)", () =>
      tx(async (c) => {
        // Penolak sementara HANYA untuk kaki bank, di transaksi uji yang di-ROLLBACK.
        await c.query(
          `ALTER TABLE app.cash_ledger ADD CONSTRAINT uji_tolak_kaki_bank CHECK (transfer_uuid IS NULL OR category_label <> 'Pindah Buku') NOT VALID`,
        );
        const kunci = randomUUID();
        await c.query("SAVEPOINT aksi");
        await expect(catat(c, { kunci })).rejects.toThrow(/uji_tolak_kaki_bank/);
        await c.query("ROLLBACK TO SAVEPOINT aksi");
        expect(await kaki(c, kunci)).toEqual([]);
      }));
  });

  it("KTD5: dua kiriman BERSAMAAN dengan kunci sama ⇒ satu pasangan; yang kalah memetakan galat indeks unik", async () => {
    if (!applied) return;
    const kunci = randomUUID();
    const tanggal = "2026-10-05";
    const satu = async (): Promise<string> => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.unit_ids', $1, true)", [String(A)]);
        const r = await catat(c, { kunci, tanggal, amount: 1_000 });
        await new Promise((s) => setTimeout(s, 150));
        await c.query("COMMIT");
        return r.ok ? (r.sudahAda ? "sudahAda" : "tulis") : r.error;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        return galatKunciGanda(e) ? "kunci-ganda" : String(e);
      } finally {
        c.release();
      }
    };
    const hasil = (await Promise.all([satu(), satu()])).sort();
    expect(hasil[1]).toBe("tulis");
    expect(["kunci-ganda", "sudahAda"]).toContain(hasil[0]);
    const n = await tx(async (c) => {
      expect(await kaki(c, kunci)).toHaveLength(2);
    });
    void n;
  });

  describe("U3 · batalkan transfer (KTD6)", () => {
    it("Covers AE3. Kedua kaki void bersama; jurnalnya hilang; audit tercatat", () =>
      tx(async (c) => {
        const kunci = randomUUID();
        await catat(c, { kunci });
        await bentuk(c);
        const ids = (await kaki(c, kunci)).map((x) => x.id);
        const r = await tulisBatalTransfer(c, { unitId: unit, unitCode: "UJI-TF-A", aktor: AKTOR, transferUuid: kunci });
        expect(r).toMatchObject({ ok: true });
        expect((await kaki(c, kunci)).map((x) => x.void)).toEqual([true, true]);
        await bentuk(c);
        expect(await jurnalPos(c, ids)).toEqual([]);
        expect(await audit(c, "kas.transfer.batal", `UJI-TF-A/${kunci}`)).toHaveLength(1);
      }));

    it("kaki di kelompok cocok aktif ⇒ ditolak, tak ada yang berubah", () =>
      tx(async (c) => {
        const kunci = randomUUID();
        await catat(c, { kunci });
        await cocokkan(c, (await kaki(c, kunci))[1]!.id);
        const r = await tulisBatalTransfer(c, { unitId: unit, unitCode: "UJI-TF-A", aktor: AKTOR, transferUuid: kunci });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/dicocokkan/);
        expect((await kaki(c, kunci)).map((x) => x.void)).toEqual([false, false]);
      }));

    it("hari buku tertutup ⇒ ditolak", () =>
      tx(async (c) => {
        const kunci = randomUUID();
        await catat(c, { kunci });
        await tutupHari(c, HARI);
        const r = await tulisBatalTransfer(c, { unitId: unit, unitCode: "UJI-TF-A", aktor: AKTOR, transferUuid: kunci });
        expect(r.ok).toBe(false);
        expect((await kaki(c, kunci)).map((x) => x.void)).toEqual([false, false]);
      }));
  });

  describe("U6 · jadikan transfer (KTD9)", () => {
    type Pasangan = { bank: string; kas: string; tanggal: string; nominal: number };
    const pasanganLama = async (c: PoolClient, tanggal = HARI, nominal = 399_979_000): Promise<Pasangan> => {
      const ins = async (account: string, jenis: string, kategori: string, amount: number) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
             VALUES ($1, $2::uuid, $3::date, 'setoran penjualan dari kas besar', $4::app.cash_mutation_jenis, $4::text::app.cash_mutation_side, $5, $6, 24)
             RETURNING id::text AS id`,
            [A, account, tanggal, jenis, kategori, amount],
          )
        ).rows[0]!.id;
      const kas = await ins(akun.kas, "kredit", "Setoran ke Bank", -nominal);
      const bank = await ins(akun.bank, "debet", "Setoran Hasil Penjualan", nominal);
      return { bank, kas, tanggal, nominal };
    };
    // Konfirmasi = apa yang ditampilkan langkah konfirmasi untuk pasangan itu.
    const yakin = (p: Pasangan): KonfirmasiJadikan => ({ yakin: true, tanggal: p.tanggal, nominalSen: p.nominal * 100, rekening4: "0001" });
    const jadikan = (
      c: PoolClient,
      p: Pasangan,
      o: { bolehHariTutup?: boolean; alasan?: string; konfirmasi?: KonfirmasiJadikan } = {},
    ) =>
      tulisJadikanTransfer(c, {
        unitId: unit,
        unitCode: "UJI-TF-A",
        aktor: AKTOR,
        bankId: p.bank,
        kasId: p.kas,
        alasan: o.alasan ?? "",
        bolehHariTutup: o.bolehHariTutup ?? false,
        konfirmasi: o.konfirmasi ?? yakin(p),
      });
    const pos1103 = async (c: PoolClient, ids: string[]) =>
      (await jurnalPos(c, ids)).find((x) => x.pos === "1103")?.net ?? "0";

    it("hari terbuka (keuangan): baris lama void, baris baru 'Pindah Buku' tanggal & nominal sama, kaki Kas Besar tertaut; 1103 kembali, 1190 nol", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        await bentuk(c);
        expect(await pos1103(c, [p.bank, p.kas])).toBe("-39997900000");
        const r = await jadikan(c, p);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const k = await kaki(c, r.transferUuid);
        expect(k.map((x) => [x.id === p.kas, x.kategori, x.amount, x.hari])).toEqual([
          [true, "Setoran ke Bank", "-399979000.00", HARI],
          [false, "Pindah Buku", "399979000.00", HARI],
        ]);
        const lama = await c.query(`SELECT void, category_label FROM app.cash_ledger WHERE id = $1::uuid`, [p.bank]);
        expect(lama.rows[0]).toEqual({ void: true, category_label: "Setoran Hasil Penjualan" });
        await bentuk(c);
        const ids = [p.kas, r.baru];
        expect(await pos1103(c, [...ids, p.bank])).toBe("0");
        expect((await jurnalPos(c, ids)).find((x) => x.pos === "1190")).toEqual({ pos: "1190", net: "0" });
        expect(await audit(c, "kas.transfer.koreksi", `UJI-TF-A/${r.transferUuid}`)).toEqual([
          {
            detail: expect.objectContaining({
              lama: p.bank,
              baru: r.baru,
              kas: p.kas,
              hariTutup: false,
              // Konfirmasi eksplisit + kedua kaki yang ditampilkan ikut tercatat.
              konfirmasi: { yakin: true, ditampilkan: { tanggal: HARI, nominalSen: 39_997_900_000, rekening4: "0001" } },
              kaki: {
                unit: "UJI-TF-A",
                tanggal: HARI,
                nominalSen: 39_997_900_000,
                kasBesar: { sisi: "kredit", kategori: "Setoran ke Bank", baris: p.kas.slice(0, 8) },
                bank: { sisi: "debet", kategori: "Pindah Buku", rekening: "…0001", barisLama: p.bank.slice(0, 8) },
              },
            }),
          },
        ]);
        // Pasangan hasil koreksi bisa dibatalkan berdua di hari terbuka.
        expect((await tulisBatalTransfer(c, { unitId: unit, unitCode: "UJI-TF-A", aktor: AKTOR, transferUuid: r.transferUuid })).ok).toBe(true);
        // Dijalankan lagi pada baris lama ⇒ tak ada calon.
        expect((await jadikan(c, p)).ok).toBe(false);
      }));

    it("Covers AE4. Hari tertutup: keuangan ditolak; HoF tanpa alasan ditolak; HoF beralasan berhasil; selisih day_close tak berubah", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        await tutupHari(c, HARI);
        const r1 = await jadikan(c, p);
        expect(r1.ok).toBe(false);
        if (!r1.ok) expect(r1.error).toMatch(/Head of Finance/);
        expect((await jadikan(c, p, { bolehHariTutup: true })).ok).toBe(false);
        const r = await jadikan(c, p, { bolehHariTutup: true, alasan: "Kaki bank transfer salah kategori. Ref REPORT6/7B." });
        expect(r.ok).toBe(true);
        if (r.ok) expect((await kaki(c, r.transferUuid)).every((x) => x.hari === HARI)).toBe(true);
        const dc = await c.query(`SELECT difference_rp::text AS d, status::text AS s FROM app.day_close WHERE unit_id=$1 AND business_date=$2::date`, [A, HARI]);
        expect(dc.rows[0]).toEqual({ d: "0.00", s: "closed" });
      }));

    it("konfirmasi yang tak sama dengan baris terkunci (nominal / tanggal / rekening lain) ⇒ ditolak, tak ada yang berubah", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        const r1 = await jadikan(c, p, { konfirmasi: { ...yakin(p), nominalSen: 1 } });
        expect(r1.ok).toBe(false);
        if (!r1.ok) expect(r1.error).toMatch(/Yang dikonfirmasi tidak sama/);
        expect((await jadikan(c, p, { konfirmasi: { ...yakin(p), tanggal: BESOK } })).ok).toBe(false);
        // Rekening yang dikonfirmasi (4 digit) juga harus sama — audit tak boleh mencatat rekening lain.
        const r4 = await jadikan(c, p, { konfirmasi: { ...yakin(p), rekening4: "9999" } });
        expect(r4.ok).toBe(false);
        if (!r4.ok) expect(r4.error).toMatch(/rekening/);
        expect((await jadikan(c, p, { konfirmasi: { ...yakin(p), rekening4: null } })).ok).toBe(false);
        // Inti tulis juga menolak tanpa centang (pertahanan berlapis di bawah aksi).
        const r3 = await jadikan(c, p, { konfirmasi: { ...yakin(p), yakin: false } as unknown as KonfirmasiJadikan });
        expect(r3.ok).toBe(false);
        const lama = await c.query(`SELECT void FROM app.cash_ledger WHERE id = $1::uuid`, [p.bank]);
        expect(lama.rows[0]).toEqual({ void: false });
      }));

    /**
     * CERMIN KASUS NYATA Bakau 22 Okt (`28e717f3`, BCA …6811, Rp 399.979.000,
     * hari TERTUTUP, selisih day_close −470). Keputusan Dion D3 (11 Nov 2026
     * 17:54 WIB): HANYA "Jadikan transfer", TANPA jurnal memorial.
     * Hasil yang diharapkan, eksak:
     *   · kedua kaki tetap bertanggal 2026-10-22 (koreksi tidak dibukukan maju —
     *     D1 "maju" hanya untuk transfer BARU; `tanggal_asal` tetap NULL);
     *   · baris bank lama void (kategori lama tersimpan sebagai bukti), baris baru
     *     "Pindah Buku" bernominal sama, tertaut ke kaki Kas Besar;
     *   · jurnal: 1103 TIDAK lagi dikredit kaki bank (−399.979.000 dari baris itu
     *     hilang), 1190 kedua kaki net 0;
     *   · day_close: status 'closed', difference_rp −470 TIDAK berubah;
     *   · tak ada jurnal memorial yang dibuat.
     */
    it("Bakau 22 Okt (hari tertutup, D3): HoF + alasan + konfirmasi ⇒ dua kaki tetap 22 Okt, 1103 lepas dari kaki bank, 1190 nol, selisih −470 tetap, tanpa memorial", () =>
      tx(async (c) => {
        const T22 = "2026-10-22";
        const p = await pasanganLama(c, T22, 399_979_000);
        await bentuk(c);
        expect(await pos1103(c, [p.bank])).toBe("-39997900000"); // P2: kaki bank mengkredit 1103
        await c.query(
          `INSERT INTO app.day_close (unit_id, business_date, status, difference_rp, tier, reason_code, reason_requires_target, closed_by_user_id, closed_at)
           VALUES ($1, $2::date, 'closed', -470, 'within_tolerance', 'CLS-ROUND', false, 2, now())`,
          [A, T22],
        );
        const memorialSebelum = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.jurnal WHERE unit_id = $1 AND jenis = 'memorial'`, [A]);

        // Keuangan (bukan HoF) ditolak, bahkan dengan konfirmasi.
        expect((await jadikan(c, p)).ok).toBe(false);
        const r = await jadikan(c, p, {
          bolehHariTutup: true,
          alasan: "Kaki bank transfer Kas Besar → BCA …6811 salah kategori (Setoran Hasil Penjualan → Pindah Buku); 1103 terkredit dua kali. Ref REPORT6/7B.",
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.tanggal).toBe(T22);

        const k = await kaki(c, r.transferUuid);
        expect(k.map((x) => [x.id === p.kas, x.kategori, x.amount, x.hari, x.asal])).toEqual([
          [true, "Setoran ke Bank", "-399979000.00", T22, null],
          [false, "Pindah Buku", "399979000.00", T22, null],
        ]);
        const lama = await c.query(`SELECT void, category_label FROM app.cash_ledger WHERE id = $1::uuid`, [p.bank]);
        expect(lama.rows[0]).toEqual({ void: true, category_label: "Setoran Hasil Penjualan" });

        await bentuk(c);
        expect(await pos1103(c, [p.bank, r.baru, p.kas])).toBe("0");
        expect((await jurnalPos(c, [p.kas, r.baru])).find((x) => x.pos === "1190")).toEqual({ pos: "1190", net: "0" });

        const dc = await c.query(`SELECT difference_rp::text AS d, status::text AS s FROM app.day_close WHERE unit_id=$1 AND business_date=$2::date`, [A, T22]);
        expect(dc.rows[0]).toEqual({ d: "-470.00", s: "closed" });
        const memorialSesudah = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.jurnal WHERE unit_id = $1 AND jenis = 'memorial'`, [A]);
        expect(memorialSesudah.rows[0]).toEqual(memorialSebelum.rows[0]);
        expect(memorialSesudah.rows[0]).toEqual({ n: "0" });

        const a = await audit(c, "kas.transfer.koreksi", `UJI-TF-A/${r.transferUuid}`);
        expect(a).toEqual([
          {
            detail: expect.objectContaining({
              hariTutup: true,
              alasan: expect.stringMatching(/Ref REPORT6\/7B/),
              konfirmasi: { yakin: true, ditampilkan: { tanggal: T22, nominalSen: 39_997_900_000, rekening4: "0001" } },
            }),
          },
        ]);
      }));

    it("bulan tertutup ⇒ ditolak", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        await c.query(`INSERT INTO app.tutup_bulan (unit_id, bulan, ditutup_by_user_id) VALUES ($1, '2026-10-01', 2)`, [A]);
        expect((await jadikan(c, p, { bolehHariTutup: true, alasan: "x" })).ok).toBe(false);
      }));

    it("baris bank di kelompok cocok aktif ⇒ ditolak, tak ada yang berubah", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        await cocokkan(c, p.bank);
        const r = await jadikan(c, p);
        expect(r.ok).toBe(false);
        const lama = await c.query(`SELECT void FROM app.cash_ledger WHERE id = $1::uuid`, [p.bank]);
        expect(lama.rows[0]).toEqual({ void: false });
      }));

    it("calon basi (baris bank sudah dibatalkan) ⇒ ditolak 'muat ulang'", () =>
      tx(async (c) => {
        const p = await pasanganLama(c);
        await c.query(`UPDATE app.cash_ledger SET void = true, voided_by_user_id = 2, voided_at = now() WHERE id = $1::uuid`, [p.bank]);
        const r = await jadikan(c, p);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/muat ulang/);
      }));

    it("satu kaki Kas Besar diperebutkan dua baris bank ⇒ ditolak di server (sama dengan daftar)", () =>
      tx(async (c) => {
        const p = await pasanganLama(c, "2026-10-17", 2_000_000);
        await c.query(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
           VALUES ($1, $2::uuid, '2026-10-17', 'bank kedua', 'debet', 'debet', 'Setoran Hasil Penjualan', 2000000, 24)`,
          [A, akun.bank],
        );
        expect((await jadikan(c, p)).ok).toBe(false);
      }));

    it("dua kaki Kas Besar bernominal sama di hari itu ⇒ ditolak (periksa manual)", () =>
      tx(async (c) => {
        const p = await pasanganLama(c, "2026-10-16", 1_000_000);
        await c.query(
          `INSERT INTO app.cash_ledger (unit_id, account_id, business_date, keterangan, jenis, category_side, category_label, amount, created_by_user_id)
           VALUES ($1, $2::uuid, '2026-10-16', 'kedua', 'kredit', 'kredit', 'Setoran ke Bank', -1000000, 24)`,
          [A, akun.kas],
        );
        expect((await jadikan(c, p)).ok).toBe(false);
      }));
  });
});
