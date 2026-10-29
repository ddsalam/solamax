import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { auditKeuangan, kodeAlasanKoreksiSah, PESAN_KODE_ALASAN_TAK_DIKENAL, type Aktor } from "./keuangan-tx";
import {
  KATEGORI_ANTAR_UNIT,
  KODE_MAJU_ANTAR_UNIT,
  KODE_MAJU_PEMBALIK,
  barisPembalik,
  kakiAntarUnit,
  keteranganKaki,
  rencanaBalik,
  senKeTeks,
  type BarisPasangan,
  type JenisAntarUnit,
} from "./antar-unit-model";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { periksaPihakLawanMutasi, teksKeSen, type JenisPihakLawan } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS pasangan antar unit (rencana 2026-10-29 U4; R3, R28, R31; KTD4,
 * KTD5) — dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', '<A>,<B>', true)`. Tanpa gerbang wewenang:
 * gerbangnya (`canCatatAntarUnit`/`canBalikPasanganAntarUnit` + `requireUnit`
 * KEDUA unit) milik `antar-unit-actions.ts` dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `pihak-lawan-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang di bawah. Dipisah supaya uji DB-live (`antar-unit.integration.test.ts`)
 * menguji SQL yang sama dengan yang dijalankan aksi.
 *
 * Tak ada tabel pasangan lintas unit (KTD4): tiap kaki adalah baris
 * `cash_ledger` di unitnya sendiri, RLS & FK komposit apa adanya, terikat satu
 * `pasangan_uuid`. Bila `app.unit_ids` transaksi tidak memuat salah satu unit,
 * RLS menyembunyikan rekening/pihak lawannya dan `hariBukuTerkunci` melempar —
 * pasangan DITOLAK UTUH, tak ada kaki yang tertulis.
 */

export interface UnitTergerbang {
  unitId: ScopedUnitId;
  code: string;
  name: string;
}

const INSERT_KAS = `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, pihak_lawan_id,
          pasangan_uuid, tanggal_asal, alasan_maju, alasan_maju_applies_to, lahir_dari_cocok_id)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8::numeric,$9,$10::uuid,
               $11::uuid,$12::date,$13,$14,$15::uuid)
       RETURNING id::text AS id`;

export type HasilCatat =
  | { ok: true; pasanganUuid: string; kaki: { unit: string; id: string; hariBuku: string; maju: boolean }[] }
  | { ok: false; error: string };

/**
 * Dua kaki dalam transaksi pemanggil: pemberi = kredit −X, penerima = debet +X,
 * kategori Hutang Piutang, pihak lawan = baris berjenis `unit` milik unit itu
 * yang menunjuk unit lawannya, `pasangan_uuid` sama. Hari buku PER KAKI (R28):
 * hari unit penerima bisa tertutup sementara hari pemberi terbuka.
 */
export async function tulisPasanganAntarUnit(
  c: PoolClient,
  m: {
    pemberi: UnitTergerbang;
    penerima: UnitTergerbang;
    pemberiAccountId: string;
    penerimaAccountId: string;
    nominalSen: number;
    tanggal: string;
    jenis: JenisAntarUnit;
    catatan: string;
    aktor: Aktor;
    /**
     * U11 — pasangan yang lahir dari klasifikasi baris rekening koran: kaki di
     * unit ini ditandai `lahir_dari_cocok_id` (FK komposit ke kelompok unit yang
     * SAMA, 0052). Kaki unit lawan tidak — ia menunggu impor unit itu sendiri.
     */
    lahirDariCocok?: { unitId: ScopedUnitId; cocokId: string };
  },
): Promise<HasilCatat> {
  const kakiNominal = kakiAntarUnit(m.nominalSen);
  const sisi = [
    { peran: "pemberi" as const, unit: m.pemberi, lawan: m.penerima, accountId: m.pemberiAccountId, ...kakiNominal.pemberi },
    { peran: "penerima" as const, unit: m.penerima, lawan: m.pemberi, accountId: m.penerimaAccountId, ...kakiNominal.penerima },
  ];

  // 1. Rekening & pihak lawan tiap kaki — dibaca ulang & dikunci di transaksi.
  const siap: { pihakLawanId: string }[] = [];
  for (const s of sisi) {
    const akun = await c.query<{ id: string; nama: string; active: boolean }>(
      `SELECT id::text AS id, nama, active
         FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2
        FOR SHARE`,
      [s.accountId, s.unit.unitId],
    );
    const a = akun.rows[0];
    if (!a) return { ok: false, error: `Rekening ${s.peran} tak ditemukan di ${s.unit.name} — pilih rekening milik unit itu.` };
    if (!a.active) return { ok: false, error: `Rekening “${a.nama}” di ${s.unit.name} sudah ditutup — pilih rekening aktif.` };

    const pl = await c.query<{ id: string; nama: string; jenis: JenisPihakLawan; aktif: boolean }>(
      `SELECT id::text AS id, nama, jenis, aktif
         FROM app.pihak_lawan
        WHERE unit_id = $1 AND jenis = 'unit' AND lawan_unit_id = $2
        FOR SHARE`,
      [s.unit.unitId, s.lawan.unitId],
    );
    const pihak = pl.rows[0] ?? null;
    const salah = periksaPihakLawanMutasi({ categoryLabel: KATEGORI_ANTAR_UNIT, pihakLawanId: pihak?.id ?? "?", pihak });
    if (salah !== null) return { ok: false, error: `${s.unit.name}: ${salah}` };
    siap.push({ pihakLawanId: pihak!.id });
  }

  // 2. Hari buku per kaki (U2, KTD5) — unit & rekening kaki itu sendiri.
  const hari = [];
  for (const s of sisi) {
    const h = await hariBukuTerkunci(c, s.unit.unitId, m.tanggal, { accountId: s.accountId });
    if (h.status === "pra-cut-over") {
      return {
        ok: false,
        error:
          `Tanggal ${m.tanggal} mendahului saldo pembuka ${s.unit.name} (${h.cutOver}) — sudah termuat di saldo ` +
          `pembukanya. Ditolak utuh, tak ada kaki yang tertulis.`,
      };
    }
    hari.push(h);
  }

  // 3. Dua kaki, satu kunci pasangan.
  const pasanganUuid = randomUUID();
  const kaki: { unit: string; id: string; hariBuku: string; maju: boolean }[] = [];
  for (const [i, s] of sisi.entries()) {
    const h = hari[i]!;
    const maju = h.perluKodeAlasan;
    const r = await c.query<{ id: string }>(INSERT_KAS, [
      s.unit.unitId,
      s.accountId,
      h.hariBuku,
      keteranganKaki({ jenis: m.jenis, peran: s.peran, namaLawan: s.lawan.name, catatan: m.catatan }),
      s.jenis,
      s.jenis,
      KATEGORI_ANTAR_UNIT,
      senKeTeks(s.amountSen),
      m.aktor.userId,
      siap[i]!.pihakLawanId,
      pasanganUuid,
      maju ? m.tanggal : null,
      maju ? KODE_MAJU_ANTAR_UNIT : null,
      maju ? "adjustment" : null,
      m.lahirDariCocok && m.lahirDariCocok.unitId === s.unit.unitId ? m.lahirDariCocok.cocokId : null,
    ]);
    kaki.push({ unit: s.unit.code, id: r.rows[0]?.id ?? "?", hariBuku: h.hariBuku, maju });
  }

  await auditKeuangan(c, m.aktor, "antar_unit.catat", `${m.pemberi.code}->${m.penerima.code}/${pasanganUuid}`, {
    jenis: m.jenis,
    tanggal: m.tanggal,
    nominal: senKeTeks(m.nominalSen),
    catatan: m.catatan,
    pemberi: { unit: m.pemberi.code, rekening: m.pemberiAccountId },
    penerima: { unit: m.penerima.code, rekening: m.penerimaAccountId },
    kaki,
  });
  return { ok: true, pasanganUuid, kaki };
}

/** Akses id kaki unit tertentu dari hasil catat (dipakai klasifikasi U11). */
export function kakiUnit(h: Extract<HasilCatat, { ok: true }>, code: string): { id: string; hariBuku: string; maju: boolean } | null {
  return h.kaki.find((k) => k.unit === code) ?? null;
}

export type HasilBalik =
  | { ok: true; kaki: { unit: string; id: string; tindakan: "void" | "pembalik"; hariBuku: string }[] }
  | { ok: false; error: string };

/**
 * Balik satu pasangan (R31) — KEDUA kaki, tak pernah satu. Per kaki: hari
 * bukunya masih terbuka ⇒ VOID (jejak `voided_by_user_id`); sudah tertutup ⇒
 * baris pembalik MAJU di hari terbuka pertama (R28, `ADJ-FWD-REVERSAL`,
 * `tanggal_asal` = hari buku kaki aslinya), `pasangan_uuid` sama. Alasan
 * (`reason_code` adjustment yang dipilih HoF) + catatan hidup di `audit_log`.
 */
export async function tulisBalikPasangan(
  c: PoolClient,
  m: {
    unit: UnitTergerbang;
    lawan: UnitTergerbang;
    pasanganUuid: string;
    reasonCode: string;
    catatan: string;
    aktor: Aktor;
  },
): Promise<HasilBalik> {
  if (!(await kodeAlasanKoreksiSah(c, m.reasonCode))) return { ok: false, error: PESAN_KODE_ALASAN_TAK_DIKENAL };

  const r = await c.query<{
    id: string;
    unitId: number;
    accountId: string;
    businessDate: string;
    amount: string;
    jenis: BarisPasangan["jenis"];
    categorySide: BarisPasangan["categorySide"];
    categoryLabel: string | null;
    pihakLawanId: string | null;
    keterangan: string;
    void: boolean;
    alasanMaju: string | null;
  }>(
    `SELECT id::text AS id, unit_id AS "unitId", account_id::text AS "accountId",
            to_char(business_date,'YYYY-MM-DD') AS "businessDate", amount::text AS amount,
            jenis::text AS jenis, category_side::text AS "categorySide", category_label AS "categoryLabel",
            pihak_lawan_id::text AS "pihakLawanId", keterangan, void, alasan_maju AS "alasanMaju"
       FROM app.cash_ledger
      WHERE pasangan_uuid = $1::uuid AND unit_id = ANY($2::int[])
      ORDER BY (unit_id = $3) DESC, created_at
      FOR UPDATE`,
    [m.pasanganUuid, [m.unit.unitId, m.lawan.unitId], m.unit.unitId],
  );
  const rows: BarisPasangan[] = r.rows.map((x) => ({ ...x, amountSen: teksKeSen(x.amount) }));
  const rencana = rencanaBalik(rows, [m.unit.unitId, m.lawan.unitId]);
  if (!rencana.ok) return rencana;

  // U10 (U4 butir 4) — kaki di kelompok cocok AKTIF ⇒ "batalkan cocok dulu".
  // Kedua kaki sudah dikunci FOR UPDATE di atas; pencocok mengunci baris kas
  // sebelum menautkannya, jadi periksa ini tidak bisa disalip.
  const cocok = await c.query<{ unit: number }>(
    `SELECT b.unit_id AS unit
       FROM app.cocok_bank_baris b
      WHERE b.aktif AND b.cash_ledger_id = ANY($1::uuid[]) AND b.unit_id = ANY($2::int[])`,
    [rencana.kaki.map((k) => k.id), [m.unit.unitId, m.lawan.unitId]],
  );
  if (cocok.rows.length > 0) {
    const di = [...new Set(cocok.rows.map((r) => (Number(r.unit) === Number(m.unit.unitId) ? m.unit.name : m.lawan.name)))];
    return {
      ok: false,
      error:
        `Kaki pasangan ini sudah dicocokkan dengan rekening koran di ${di.join(" & ")} — batalkan cocok dulu, ` +
        "baru pasangan bisa dibalik. Tak ada kaki yang dibalik.",
    };
  }

  const kaki: { unit: string; id: string; tindakan: "void" | "pembalik"; hariBuku: string }[] = [];
  for (const k of rencana.kaki) {
    const u = k.unitId === m.unit.unitId ? m.unit : m.lawan;
    const h = await hariBukuTerkunci(c, u.unitId, k.businessDate, { accountId: k.accountId });
    if (h.status === "pra-cut-over") {
      return {
        ok: false,
        error: `Kaki di ${u.name} (${k.businessDate}) mendahului saldo pembuka (${h.cutOver}) — balik ditolak utuh.`,
      };
    }
    if (h.hariBuku === k.businessDate) {
      const v = await c.query(
        `UPDATE app.cash_ledger
            SET void = true, voided_by_user_id = $1, voided_at = now()
          WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
        [m.aktor.userId, k.id, u.unitId],
      );
      if (v.rowCount !== 1) return { ok: false, error: "Kaki pasangan berubah bersamaan — muat ulang halaman." };
      kaki.push({ unit: u.code, id: k.id, tindakan: "void", hariBuku: k.businessDate });
      continue;
    }
    const b = barisPembalik(k);
    const ins = await c.query<{ id: string }>(INSERT_KAS, [
      u.unitId,
      k.accountId,
      h.hariBuku,
      b.keterangan,
      b.jenis,
      b.categorySide,
      k.categoryLabel,
      senKeTeks(b.amountSen),
      m.aktor.userId,
      k.pihakLawanId,
      m.pasanganUuid,
      k.businessDate,
      KODE_MAJU_PEMBALIK,
      "adjustment",
      null,
    ]);
    kaki.push({ unit: u.code, id: ins.rows[0]?.id ?? "?", tindakan: "pembalik", hariBuku: h.hariBuku });
  }

  await auditKeuangan(c, m.aktor, "antar_unit.balik", `${m.unit.code}/${m.pasanganUuid}`, {
    reasonCode: m.reasonCode,
    catatan: m.catatan,
    lawan: m.lawan.code,
    kakiAsli: rencana.kaki.map((k) => ({ id: k.id, unitId: k.unitId, hariBuku: k.businessDate, nominal: senKeTeks(k.amountSen) })),
    kaki,
  });
  return { ok: true, kaki };
}
