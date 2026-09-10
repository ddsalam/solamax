/**
 * Cache rowset snapshot immutable Saldo Piutang/Hutang.
 *
 * Pointer selalu dibaca segar. Hanya rowset exact-generation yang di-cache,
 * dengan kunci `(unit,tanggal,generation_id)`, sehingga swap pointer tidak
 * pernah menghidupkan generasi lama. Wrapper agregat lama boleh jatuh ke query
 * ledger agregat selama rollout; reader rinci snapshot tidak pernah begitu.
 */
import { unstable_cache } from "next/cache";
import { addDays, todayWib } from "./periods";
import { readSaldoPelangganLegacy } from "./queries";
import {
  assembleReadySaldoSnapshot,
  getSaldoSnapshotGeneration,
  getSaldoSnapshotPointer,
  type SaldoPelanggan,
  type SaldoSnapshot,
  type SaldoSnapshotPointer,
  type SaldoSnapshotRow,
} from "./saldo-snapshot";
import type { ScopedUnitId } from "./scope-rule";

/** Revalidate tanggal historis — selaras cadence koreksi back-dated agent. */
export const SALDO_HIST_REVALIDATE_S = 86_400;
/** TTL hari berjalan & H−1. */
export const SALDO_LIVE_REVALIDATE_S = 120;

/**
 * Berapa lama hasil untuk `date` boleh diawetkan, relatif ke `today`. MURNI
 * agar teruji unit tanpa runtime Next. Batas historis = hari-ini − 2.
 */
export function saldoRevalidateSeconds(date: string, today: string): number {
  return date <= addDays(today, -2) ? SALDO_HIST_REVALIDATE_S : SALDO_LIVE_REVALIDATE_S;
}

/**
 * Cache ledger all-zero tidak tepercaya: bisa tercipta ketika backfill unit
 * belum selesai. Sama seperti jalur produksi lama, nol memaksa satu read segar.
 */
export function shouldBypassEmptySaldo(saldo: SaldoPelanggan): boolean {
  return [saldo.awal, saldo.akhir].every(
    (batas) => batas.piutangLokal === 0
      && batas.piutangOnline === 0
      && batas.hutangLokal === 0,
  );
}

export async function resolveSaldo(
  cached: () => Promise<SaldoPelanggan>,
  fresh: () => Promise<SaldoPelanggan>,
  cacheMiss: () => boolean = () => false,
): Promise<SaldoPelanggan> {
  const hit = await cached();
  return cacheMiss() || !shouldBypassEmptySaldo(hit) ? hit : fresh();
}

function readLegacyCached(
  unit: ScopedUnitId,
  date: string,
  revalidate: number,
): Promise<SaldoPelanggan> {
  let producedFresh = false;
  return resolveSaldo(
    unstable_cache(
      () => {
        producedFresh = true;
        return readSaldoPelangganLegacy(unit, date);
      },
      ["saldo-pelanggan-legacy", String(unit), date],
      { revalidate },
    ),
    () => readSaldoPelangganLegacy(unit, date),
    () => producedFresh,
  );
}

type GenerationRead = Awaited<ReturnType<typeof getSaldoSnapshotGeneration>>;

function rowIsAllZero(row: SaldoSnapshotRow): boolean {
  return row.awalPiutangLokal === 0
    && row.akhirPiutangLokal === 0
    && row.awalPiutangOnline === 0
    && row.akhirPiutangOnline === 0
    && row.awalHutangLokal === 0
    && row.akhirHutangLokal === 0;
}

/**
 * Not-ready, empty, and all-six-zero cache hits are never trusted. A fresh
 * generation read revalidates manifest count/checksum before zero is accepted.
 */
export function shouldBypassCachedGeneration(result: GenerationRead): boolean {
  return result.status === "not_ready"
    || result.rows.length === 0
    || result.rows.every(rowIsAllZero);
}

export async function resolveSaldoGeneration(
  cached: () => Promise<GenerationRead>,
  fresh: () => Promise<GenerationRead>,
  cacheMiss: () => boolean = () => false,
): Promise<GenerationRead> {
  const hit = await cached();
  if (cacheMiss() || !shouldBypassCachedGeneration(hit)) return hit;
  return fresh();
}

async function readGenerationCached(
  unit: ScopedUnitId,
  date: string,
  pointer: SaldoSnapshotPointer,
  revalidate: number,
): Promise<GenerationRead> {
  let producedFresh = false;
  return resolveSaldoGeneration(
    unstable_cache(
      () => {
        producedFresh = true;
        return getSaldoSnapshotGeneration(unit, date, pointer);
      },
      ["saldo-pelanggan-snapshot", String(unit), date, pointer.generationId],
      { revalidate },
    ),
    () => getSaldoSnapshotGeneration(unit, date, pointer),
    () => producedFresh,
  );
}

/**
 * Snapshot rinci untuk pemanggil baru. Pointer tidak pernah di-cache; hanya
 * rowset immutable pada exact generation yang diawetkan.
 */
export async function getSaldoSnapshotCached(
  unit: ScopedUnitId,
  date: string,
  today: string = todayWib(),
): Promise<SaldoSnapshot> {
  const revalidate = saldoRevalidateSeconds(date, today);
  let pointer = await getSaldoSnapshotPointer(unit, date);
  if (!pointer) return { status: "not_ready", asOfDate: date, reason: "no_published_snapshot" };

  let generation = await readGenerationCached(unit, date, pointer, revalidate);
  if (generation.status === "ready") return assembleReadySaldoSnapshot(date, pointer, generation);

  // The exact generation may disappear after the pointer read because a newer
  // generation was swapped and cleanup followed. Re-read the pointer once; a
  // changed generation gets one normal cache/fresh attempt of its own.
  const refreshedPointer = await getSaldoSnapshotPointer(unit, date);
  if (!refreshedPointer || refreshedPointer.generationId === pointer.generationId) {
    return { status: "not_ready", asOfDate: date, reason: "incomplete_snapshot" };
  }

  pointer = refreshedPointer;
  generation = await readGenerationCached(unit, date, pointer, revalidate);
  return generation.status === "ready"
    ? assembleReadySaldoSnapshot(date, pointer, generation)
    : { status: "not_ready", asOfDate: date, reason: "incomplete_snapshot" };
}

/**
 * Compatibility totals view for existing callers. Setiap unit/tanggal memakai
 * snapshot begitu complete, dan sebelum itu mempertahankan query agregat lama.
 * Ini bukan fallback per-pelanggan dan tidak dipakai reader rinci baru.
 */
export async function getSaldoPelangganCached(
  unit: ScopedUnitId,
  date: string,
  today: string = todayWib(),
): Promise<SaldoPelanggan> {
  const revalidate = saldoRevalidateSeconds(date, today);
  const snapshot = await getSaldoSnapshotCached(unit, date, today);
  return snapshot.status === "ready"
    ? snapshot.metadata.totals
    : readLegacyCached(unit, date, revalidate);
}
