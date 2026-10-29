import type { PoolClient } from "pg";
import { auditKeuangan } from "./keuangan-tx";
import { UUID_RE } from "./validasi";
import { nominalSisiLawan, type JenisPihakLawan, type PihakLawanTerbaca } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS pihak lawan (rencana 2026-10-29 U3) — dipanggil DI DALAM transaksi
 * pemanggil, sesudah `set_config('app.unit_ids', …, true)`. Tanpa gerbang
 * wewenang: gerbangnya milik server action (`pihak-lawan-actions.ts`,
 * `kas-actions.ts`) dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server": setiap fungsi ekspor di berkas seperti
 * itu menjadi endpoint yang bisa dipanggil peramban — termasuk fungsi tanpa
 * gerbang di bawah ini. Dipisah supaya uji DB-live (`pihak-lawan-saldo-awal
 * .integration.test.ts`) menguji SQL yang sama dengan yang dijalankan aksi.
 */

export interface PihakLawanBaris extends PihakLawanTerbaca {
  id: string;
  lawanUnitId: number | null;
}

/**
 * Baca ulang satu pihak lawan milik unit ini, DIKUNCI `FOR SHARE` sampai
 * transaksi selesai: penonaktifan yang bersamaan menunggu, sehingga vonis
 * "aktif" dan tulisan yang menyusul membaca keadaan yang sama.
 */
export async function bacaPihakLawanTerkunci(
  c: PoolClient,
  unitId: ScopedUnitId,
  id: string,
): Promise<PihakLawanBaris | null> {
  if (!UUID_RE.test(id)) return null;
  const r = await c.query<{ id: string; nama: string; jenis: JenisPihakLawan; aktif: boolean; lawanUnitId: number | null }>(
    `SELECT id::text AS id, nama, jenis, aktif, lawan_unit_id AS "lawanUnitId"
       FROM app.pihak_lawan
      WHERE id = $1::uuid AND unit_id = $2
      FOR SHARE`,
    [id, unitId],
  );
  return r.rows[0] ?? null;
}

/**
 * Satu sisi saldo pembuka — pola `tetapkanSaldoAwal` (§10.24 butir 3): yang
 * lama di-VOID, yang baru disisipkan, `audit_log` mencatat keduanya. Indeks
 * unik parsial 0049 menjamin satu baris aktif per (unit, pihak lawan).
 */
async function tulisSatuSisi(
  c: PoolClient,
  s: {
    unitId: ScopedUnitId;
    unitCode: string;
    pihakLawanId: string;
    tanggal: string;
    amount: number;
    sementara: boolean;
    alasan: string;
    aktor: { userId: number; email: string | null };
    pasangan: { unitCode: string; pihakLawanId: string } | null;
  },
): Promise<void> {
  const lama = await c.query<{ id: string; amount: string; tanggal: string; sementara: boolean }>(
    `SELECT id::text AS id, amount::text AS amount, to_char(tanggal,'YYYY-MM-DD') AS tanggal, sementara
       FROM app.pihak_lawan_saldo_awal
      WHERE unit_id = $1 AND pihak_lawan_id = $2::uuid AND NOT void
      FOR UPDATE`,
    [s.unitId, s.pihakLawanId],
  );
  const sebelumnya = lama.rows[0] ?? null;
  if (sebelumnya !== null) {
    await c.query(
      `UPDATE app.pihak_lawan_saldo_awal
          SET void = true, voided_by_user_id = $2, voided_at = now()
        WHERE id = $1::uuid AND unit_id = $3 AND NOT void`,
      [sebelumnya.id, s.aktor.userId, s.unitId],
    );
  }
  await c.query(
    `INSERT INTO app.pihak_lawan_saldo_awal
       (unit_id, pihak_lawan_id, tanggal, amount, sementara, created_by_user_id)
     VALUES ($1, $2::uuid, $3::date, $4, $5, $6)`,
    [s.unitId, s.pihakLawanId, s.tanggal, s.amount, s.sementara, s.aktor.userId],
  );
  await auditKeuangan(
    c,
    s.aktor,
    sebelumnya === null ? "pihak_lawan.saldo_awal.tetapkan" : "pihak_lawan.saldo_awal.ganti",
    `${s.unitCode}/${s.pihakLawanId}`,
    {
      tanggal: s.tanggal,
      nominal: s.amount,
      sementara: s.sementara,
      alasan: s.alasan,
      sebelumnya:
        sebelumnya === null
          ? null
          : { tanggal: sebelumnya.tanggal, nominal: sebelumnya.amount, sementara: sebelumnya.sementara },
      // Sisi lawan dari SATU pengisian pasangan unit (R7) — jejaknya saling menunjuk.
      pasangan: s.pasangan,
    },
  );
}

export type HasilTulis = { ok: true; sisi: 1 | 2 } | { ok: false; error: string };

/**
 * Tetapkan/ganti saldo pembuka satu pihak lawan (R7). Untuk pihak lawan
 * berjenis `unit`, SATU pengisian menulis KEDUA sisi dengan tanda berlawanan:
 * piutang A ke B = +X ⇔ hutang B ke A = −X (`nominalSisiLawan`).
 *
 * ⛔ Prasyarat sisi kedua (Implementation Constraints "Gerbang dua unit"):
 * pemanggil SUDAH meloloskan `requireUnit` kedua unit + wewenang sebelum BEGIN,
 * dan `app.unit_ids` transaksi memuat keduanya. `lawan` di sini adalah bukti
 * gerbang itu; tanpanya pasangan DITOLAK UTUH — tak ada jalan satu sisi.
 */
export async function tulisSaldoAwalPihakLawan(
  c: PoolClient,
  m: {
    unit: { unitId: ScopedUnitId; code: string };
    /** Unit lawan yang sudah lolos gerbang — wajib untuk jenis `unit`, dilarang untuk lainnya. */
    lawan: { unitId: ScopedUnitId; code: string } | null;
    pihakLawanId: string;
    tanggal: string;
    amount: number;
    sementara: boolean;
    alasan: string;
    aktor: { userId: number; email: string | null };
  },
): Promise<HasilTulis> {
  const pihak = await bacaPihakLawanTerkunci(c, m.unit.unitId, m.pihakLawanId);
  if (pihak === null) return { ok: false, error: "Pihak lawan tak ditemukan di unit ini — muat ulang halaman." };
  const alasan = m.alasan.trim();

  if (pihak.jenis !== "unit") {
    if (m.lawan !== null) return { ok: false, error: "Pihak lawan ini bukan unit SolaMax — tak ada sisi lawan." };
    await tulisSatuSisi(c, {
      unitId: m.unit.unitId,
      unitCode: m.unit.code,
      pihakLawanId: pihak.id,
      tanggal: m.tanggal,
      amount: m.amount,
      sementara: m.sementara,
      alasan,
      aktor: m.aktor,
      pasangan: null,
    });
    return { ok: true, sisi: 1 };
  }

  // Dibaca ulang DI DALAM transaksi: unit lawan yang digerbang harus SAMA
  // dengan yang ditunjuk baris ini sekarang, bukan saat halaman dibuka.
  if (m.lawan === null || pihak.lawanUnitId !== m.lawan.unitId) {
    return {
      ok: false,
      error:
        "Saldo pembuka antar unit berlaku untuk KEDUA sisi, dan unit lawannya tidak lolos gerbang — " +
        "ditolak utuh, tak ada sisi yang tertulis.",
    };
  }
  const cermin = await c.query<{ id: string }>(
    `SELECT id::text AS id
       FROM app.pihak_lawan
      WHERE unit_id = $1 AND jenis = 'unit' AND lawan_unit_id = $2
      FOR SHARE`,
    [m.lawan.unitId, m.unit.unitId],
  );
  const sisiB = cermin.rows[0] ?? null;
  if (sisiB === null) {
    return {
      ok: false,
      error: `Unit ${m.lawan.code} belum punya pihak lawan untuk unit ini — ditolak utuh, tak ada sisi yang tertulis.`,
    };
  }

  await tulisSatuSisi(c, {
    unitId: m.unit.unitId,
    unitCode: m.unit.code,
    pihakLawanId: pihak.id,
    tanggal: m.tanggal,
    amount: m.amount,
    sementara: m.sementara,
    alasan,
    aktor: m.aktor,
    pasangan: { unitCode: m.lawan.code, pihakLawanId: sisiB.id },
  });
  await tulisSatuSisi(c, {
    unitId: m.lawan.unitId,
    unitCode: m.lawan.code,
    pihakLawanId: sisiB.id,
    tanggal: m.tanggal,
    amount: nominalSisiLawan(m.amount),
    sementara: m.sementara,
    alasan,
    aktor: m.aktor,
    pasangan: { unitCode: m.unit.code, pihakLawanId: pihak.id },
  });
  return { ok: true, sisi: 2 };
}
