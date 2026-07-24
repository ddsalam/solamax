/**
 * Kesegaran data — aturan MURNI (tanpa import server), teruji unit langsung.
 *
 * AKAR MASALAH (insiden 2026-07-24): badge "data terakhir masuk" di shell
 * mengambil **MAX** `last_run_at` lintas SELURUH unit ber-scope. Saat agent SPBU
 * Bakau mati 34 jam, badge tetap hijau "1 menit lalu" — karena enam agent lain
 * hidup. Agregat MAX pada alat PENGAWASAN adalah gagal-SENYAP: makin banyak unit,
 * makin mustahil satu unit mati terlihat.
 *
 * ATURAN BARU: **MIN** dari (max last_run_at per unit) = unit TERBURUK. Gagal-
 * nyaring lebih baik daripada gagal-senyap untuk alat pengawasan.
 *
 * PERTUKARAN YANG DISENGAJA (keputusan owner 2026-07-24, K4): di rute PER-UNIT
 * (Laporan Operasional / Rincian / Usulan / Denah) badge ini menampilkan
 * kesegaran TERBURUK SE-ARMADA, bukan kesegaran unit yang sedang dibuka. Direksi
 * yang membaca laporan IB bisa melihat badge merah karena Bakau — padahal IB
 * baik-baik saja. Itu tetap dipilih karena lebih baik daripada MAX. Membuat rute
 * per-unit menampilkan kesegaran unitnya sendiri = backlog terpisah bernama
 * "badge kesegaran sadar-rute", BUKAN pekerjaan PR ini.
 */
import type { SyncRow } from "./queries";

/**
 * Waktu sinkron unit TERBURUK (ISO) di antara `unitIds`, atau null bila tidak
 * diketahui. null dikembalikan bila ADA unit ber-scope yang belum punya baris
 * sync sama sekali, atau `last_run` nya null — unit yang tak pernah sinkron
 * adalah kasus terburuk, bukan kasus yang boleh diabaikan diam-diam.
 */
export function worstSyncAt(unitIds: readonly number[], rows: readonly SyncRow[]): string | null {
  if (unitIds.length === 0) return null;
  const byUnit = new Map<number, string | null>();
  for (const r of rows) byUnit.set(r.unit_id, r.last_run);

  let worst: string | null = null;
  for (const id of unitIds) {
    const at = byUnit.get(id) ?? null;
    if (at === null) return null; // unit tanpa data sinkron → tak diketahui
    if (worst === null || at < worst) worst = at;
  }
  return worst;
}

/** unit_id dengan sinkron terburuk (untuk menyebut NAMANYA, bukan cuma durasi). */
export function worstSyncUnitId(
  unitIds: readonly number[],
  rows: readonly SyncRow[],
): number | null {
  const byUnit = new Map<number, string | null>();
  for (const r of rows) byUnit.set(r.unit_id, r.last_run);
  let worstId: number | null = null;
  let worstAt: string | null = null;
  for (const id of unitIds) {
    const at = byUnit.get(id) ?? null;
    if (at === null) return id; // belum pernah sinkron = terburuk mutlak
    if (worstAt === null || at < worstAt) {
      worstAt = at;
      worstId = id;
    }
  }
  return worstId;
}
