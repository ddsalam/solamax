import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import {
  ACTIVE_UNITS_SQL,
  SET_ALL_UNITS_SCOPE_SQL,
  SYNC_AGE_BY_UNIT_SQL,
} from "./sync-health.sql.js";

/** Ambang default: 2 jam. Lihat `SyncHealthService.thresholdMinutes`. */
export const DEFAULT_STALE_THRESHOLD_MINUTES = 120;

export type UnitVerdict = "ok" | "stale" | "never_synced";

export type UnitHealth = {
  unitId: number;
  code: string;
  name: string;
  verdict: UnitVerdict;
  lastRunAt: string | null;
  ageSeconds: number | null;
  domainsTotal: number;
};

export type SyncHealthReport = {
  /**
   * `scope_returned_nothing` sengaja BUKAN varian "sehat". Lihat
   * `evaluate()` — nol baris adalah kecurigaan, bukan ketenangan.
   */
  status: "ok" | "stale_units" | "scope_returned_nothing";
  checkedAt: string;
  thresholdMinutes: number;
  activeUnits: number;
  staleCount: number;
  neverSyncedCount: number;
  units: UnitHealth[];
};

type UnitRow = { unit_id: number; code: string; name: string };
type AgeRow = {
  unit_id: number;
  last_run_at: Date | null;
  domains_total: number;
  age_seconds: bigint | number | null;
};

@Injectable()
export class SyncHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ambang diam. Default 120 menit.
   *
   * Dipilih dari pengukuran, bukan dari rasa: pada armada sehat 17-09-2026 unit
   * terbaru berumur 0–2 menit di ketujuh unit, sementara unit yang mati berumur
   * 23 jam. 2 jam berada di tengah jurang itu — cukup longgar untuk menyerap
   * cadence master ±1 jam plus jeda jaringan, cukup ketat untuk memangkas 23 jam
   * menjadi ≤ 2 jam. Bisa ditimpa `SYNC_STALE_THRESHOLD_MINUTES` tanpa deploy.
   */
  get thresholdMinutes(): number {
    const raw = Number(process.env.SYNC_STALE_THRESHOLD_MINUTES);
    return Number.isFinite(raw) && raw > 0
      ? Math.floor(raw)
      : DEFAULT_STALE_THRESHOLD_MINUTES;
  }

  async evaluate(): Promise<SyncHealthReport> {
    const thresholdMinutes = this.thresholdMinutes;
    const thresholdSeconds = thresholdMinutes * 60;

    // Satu transaksi: `set_config(..., true)` transaction-local, jadi scope dan
    // kueri TIDAK BOLEH terpisah — terpisah berarti kueri berjalan tanpa scope
    // dan memulangkan nol baris tanpa error.
    const { units, ages } = await this.prisma.$transaction(async (tx) => {
      const units = await tx.$queryRawUnsafe<UnitRow[]>(ACTIVE_UNITS_SQL);
      const scope = units.map((u) => u.unit_id).join(",");
      await tx.$queryRawUnsafe(SET_ALL_UNITS_SCOPE_SQL, scope);
      const ages = await tx.$queryRawUnsafe<AgeRow[]>(SYNC_AGE_BY_UNIT_SQL);
      return { units, ages };
    });

    const byUnit = new Map(ages.map((a) => [a.unit_id, a]));
    const unitsHealth: UnitHealth[] = units.map((u) => {
      const row = byUnit.get(u.unit_id);
      if (!row || row.last_run_at === null) {
        return {
          unitId: u.unit_id,
          code: u.code,
          name: u.name,
          verdict: "never_synced",
          lastRunAt: null,
          ageSeconds: null,
          domainsTotal: row?.domains_total ?? 0,
        };
      }
      const ageSeconds = Number(row.age_seconds ?? 0);
      return {
        unitId: u.unit_id,
        code: u.code,
        name: u.name,
        verdict: ageSeconds > thresholdSeconds ? "stale" : "ok",
        lastRunAt: row.last_run_at.toISOString(),
        ageSeconds,
        domainsTotal: row.domains_total,
      };
    });

    const staleCount = unitsHealth.filter((u) => u.verdict === "stale").length;
    const neverSyncedCount = unitsHealth.filter(
      (u) => u.verdict === "never_synced",
    ).length;

    return {
      // 🔑 KONTROL POSITIF YANG HIDUP DI PRODUKSI, bukan cuma di tes.
      //
      // Bila ada unit aktif tetapi `sync_state` memulangkan NOL baris, yang
      // paling mungkin terjadi BUKAN "seluruh armada berhenti serentak"
      // melainkan "scope RLS-nya gagal" — dan diam-diam, karena RLS memulangkan
      // nol baris tanpa error. Melaporkannya sebagai `ok` akan menghasilkan
      // alarm yang mustahil berbunyi: persis kelas cacat yang melahirkan alarm
      // ini. Maka nol baris berbunyi, dan namanya sendiri yang membedakan sebab.
      status:
        units.length > 0 && ages.length === 0
          ? "scope_returned_nothing"
          : staleCount + neverSyncedCount > 0
            ? "stale_units"
            : "ok",
      checkedAt: new Date().toISOString(),
      thresholdMinutes,
      activeUnits: units.length,
      staleCount,
      neverSyncedCount,
      units: unitsHealth,
    };
  }
}
