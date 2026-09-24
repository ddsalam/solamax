import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope-rule";

/**
 * Pergerakan angka pada tanggal yang SUDAH TERBIT, beserta status pengakuannya.
 *
 * Keputusan pemilik 2026-09-17: angka historis IKUT BERGERAK mengikuti koreksi
 * sumber. Syaratnya, pergerakan pada data BEKU harus TERLIHAT dan harus DIAKUI
 * manusia — itulah yang dibaca modul ini.
 *
 * ⛔ Definisi beku tidak dihitung ulang di sini. Ia sudah dibekukan ke kolom
 * `frozen` saat perekaman, memakai definisi tunggal milik G5
 * (scripts/piutang-verifikasi/01-build-malam.sql).
 */
export interface SaldoShiftEvent {
  asOfDate: string;
  generationId: string;
  previousGenerationId: string;
  sourceCycleSequence: string;
  detectedAt: string;
  frozen: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  geserPiutangLokal: number;
  geserPiutangOnline: number;
  geserHutangLokal: number;
}

/**
 * $1 unit, $2 tanggal.
 *
 * 🔑 Pengakuan dijodohkan lewat `generation_id`, bukan hanya (unit, tanggal).
 * Kalau tanggal yang sudah disetujui bergeser LAGI, generasinya baru, jadi
 * `acknowledged` kembali false dan indikatornya memerah lagi. Kunci (unit,
 * tanggal) akan membungkam pergeseran berikutnya selamanya — dibuktikan bisa
 * merah di `shift-watcher.postgres.test.ts`.
 */
export const READ_SALDO_SHIFT_SQL = `
  SELECT s.as_of_date,
         s.generation_id,
         s.previous_generation_id,
         s.source_cycle_sequence,
         s.detected_at,
         s.frozen,
         a.acknowledged_by_email,
         a.acknowledged_at,
         (COALESCE(s.after_akhir_piutang_lokal, 0)  - COALESCE(s.before_akhir_piutang_lokal, 0))::float8  AS geser_piutang_lokal,
         (COALESCE(s.after_akhir_piutang_online, 0) - COALESCE(s.before_akhir_piutang_online, 0))::float8 AS geser_piutang_online,
         (COALESCE(s.after_akhir_hutang_lokal, 0)   - COALESCE(s.before_akhir_hutang_lokal, 0))::float8   AS geser_hutang_lokal
  FROM app.saldo_pelanggan_shift s
  LEFT JOIN LATERAL (
    SELECT k.acknowledged_by_email, k.acknowledged_at
    FROM app.saldo_pelanggan_shift_ack k
    WHERE k.unit_id = s.unit_id
      AND k.as_of_date = s.as_of_date
      AND k.generation_id = s.generation_id
    ORDER BY k.acknowledged_at
    LIMIT 1
  ) a ON true
  WHERE s.unit_id = $1::smallint
    AND s.as_of_date = $2::date
  ORDER BY s.source_cycle_sequence DESC
`;

type Row = {
  as_of_date: Date | string;
  generation_id: string;
  previous_generation_id: string;
  source_cycle_sequence: string | number | bigint;
  detected_at: Date;
  frozen: boolean;
  acknowledged_by_email: string | null;
  acknowledged_at: Date | null;
  geser_piutang_lokal: number;
  geser_piutang_online: number;
  geser_hutang_lokal: number;
};

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function getSaldoShifts(
  unit: ScopedUnitId,
  asOfDate: string,
): Promise<SaldoShiftEvent[]> {
  const rows = await qScoped<Row>(unit, READ_SALDO_SHIFT_SQL, [unit, asOfDate]);
  return rows.map((r) => ({
    asOfDate: isoDate(r.as_of_date),
    generationId: r.generation_id,
    previousGenerationId: r.previous_generation_id,
    sourceCycleSequence: String(r.source_cycle_sequence),
    detectedAt: r.detected_at.toISOString(),
    frozen: r.frozen,
    acknowledged: r.acknowledged_by_email !== null,
    acknowledgedBy: r.acknowledged_by_email,
    acknowledgedAt: r.acknowledged_at ? r.acknowledged_at.toISOString() : null,
    geserPiutangLokal: r.geser_piutang_lokal,
    geserPiutangOnline: r.geser_piutang_online,
    geserHutangLokal: r.geser_hutang_lokal,
  }));
}

/**
 * Satu KOREKSI sumber menggeser banyak tanggal sekaligus.
 *
 * Koreksi tunggal pada tanggal Agustus menggeser tiap akhir-bulan dan tiap
 * tanggal sesudahnya. Produksi 24-09-2026: 23 peristiwa beku yang belum diakui
 * berasal dari hanya ENAM koreksi — satu di antaranya, cut 424, sendirian
 * melahirkan 8 peristiwa bernilai sama (-1.800.000).
 *
 * 23 klik untuk 6 keputusan bukan ketelitian, melainkan ketekunan yang
 * dipaksakan — dan ketekunan yang dipaksakan berubah jadi klik refleks. Itu
 * persis yang membuat pengakuan berhenti berarti apa-apa.
 */
export interface SaldoShiftGroup {
  /** Cut sumber yang menyebabkannya — identitas alami sebuah koreksi. */
  sourceCycleSequence: string;
  /** Tiap tanggal yang digesernya, untuk DITAMPILKAN sebelum ditekan. */
  peristiwa: Array<{ asOfDate: string; generationId: string; selisihAbsolut: number }>;
  selisihAbsolut: number;
}

/** $1 unit. Pergeseran BEKU yang belum diakui, SELURUH tanggal unit ini. */
export const READ_SALDO_SHIFT_GROUPS_SQL = `
  SELECT s.as_of_date,
         s.generation_id,
         s.source_cycle_sequence,
         (COALESCE(s.after_akhir_piutang_lokal, 0)  - COALESCE(s.before_akhir_piutang_lokal, 0))::float8  AS geser_piutang_lokal,
         (COALESCE(s.after_akhir_piutang_online, 0) - COALESCE(s.before_akhir_piutang_online, 0))::float8 AS geser_piutang_online,
         (COALESCE(s.after_akhir_hutang_lokal, 0)   - COALESCE(s.before_akhir_hutang_lokal, 0))::float8   AS geser_hutang_lokal
  FROM app.saldo_pelanggan_shift s
  WHERE s.unit_id = $1::smallint
    AND s.frozen
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_shift_ack a
      WHERE a.unit_id = s.unit_id
        AND a.as_of_date = s.as_of_date
        AND a.generation_id = s.generation_id
    )
  ORDER BY s.source_cycle_sequence DESC, s.as_of_date
`;

type GroupRow = {
  as_of_date: Date | string;
  generation_id: string;
  source_cycle_sequence: string | number | bigint;
  geser_piutang_lokal: number;
  geser_piutang_online: number;
  geser_hutang_lokal: number;
};

export async function getSaldoShiftGroups(unit: ScopedUnitId): Promise<SaldoShiftGroup[]> {
  const rows = await qScoped<GroupRow>(unit, READ_SALDO_SHIFT_GROUPS_SQL, [unit]);
  const byCut = new Map<string, SaldoShiftGroup>();
  for (const r of rows) {
    const cut = String(r.source_cycle_sequence);
    const selisihAbsolut = Math.abs(r.geser_piutang_lokal)
      + Math.abs(r.geser_piutang_online)
      + Math.abs(r.geser_hutang_lokal);
    const group = byCut.get(cut)
      ?? { sourceCycleSequence: cut, peristiwa: [], selisihAbsolut: 0 };
    group.peristiwa.push({
      asOfDate: isoDate(r.as_of_date),
      generationId: r.generation_id,
      selisihAbsolut,
    });
    group.selisihAbsolut += selisihAbsolut;
    byCut.set(cut, group);
  }
  return [...byCut.values()];
}

/**
 * $1 unit, $2 tanggal[], $3 generasi[].
 *
 * Menghitung berapa dari pasangan yang DIAJUKAN benar-benar ada, beku, belum
 * diakui, dan terlihat dalam scope. `unnest` menjodohkan pasangan apa adanya —
 * ia tidak bisa memekar menjadi lebih dari yang diajukan. Pemanggil menolak
 * seluruhnya bila jumlahnya tidak sama persis; selisih satu pun membatalkan.
 */
export const VERIFY_SHIFT_GROUP_SQL = `
  SELECT count(*)::text AS n
    FROM app.saldo_pelanggan_shift s
    JOIN unnest($2::date[], $3::uuid[]) AS diajukan(as_of_date, generation_id)
      ON diajukan.as_of_date = s.as_of_date
     AND diajukan.generation_id = s.generation_id
   WHERE s.unit_id = $1::smallint
     AND s.frozen
     AND NOT EXISTS (
       SELECT 1 FROM app.saldo_pelanggan_shift_ack a
       WHERE a.unit_id = s.unit_id AND a.as_of_date = s.as_of_date
         AND a.generation_id = s.generation_id
     )
`;

/**
 * $1 unit, $2 tanggal[], $3 generasi[], $4 user, $5 email, $6 catatan.
 *
 * SATU BARIS PER PERISTIWA, bukan satu baris kolektif. Kalau kelak satu tanggal
 * perlu ditinjau atau dicabut sendiri, jejaknya harus per tanggal — baris
 * kolektif akan memaksa menebak mana yang dimaksud.
 */
export const INSERT_SHIFT_GROUP_ACK_SQL = `
  INSERT INTO app.saldo_pelanggan_shift_ack
    (unit_id, as_of_date, generation_id, acknowledged_by_user_id, acknowledged_by_email, note)
  SELECT $1::smallint, diajukan.as_of_date, diajukan.generation_id, $4, $5, NULLIF($6, '')
    FROM unnest($2::date[], $3::uuid[]) AS diajukan(as_of_date, generation_id)
`;
