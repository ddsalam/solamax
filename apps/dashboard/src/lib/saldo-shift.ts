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
