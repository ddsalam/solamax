import { timingSafeEqual } from "node:crypto";
import {
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from "@nestjs/common";
import {
  type SyncHealthReport,
  SyncHealthService,
} from "./sync-health.service.js";
import {
  type FrozenShiftReport,
  FrozenShiftService,
} from "./frozen-shift.service.js";

/**
 * Penanda log yang DIKONSUMSI alarm. Jangan diubah tanpa mengubah
 * log-based metric `solamax_sync_health_incident` — keduanya satu kontrak.
 * `sync-health.controller.test.ts` mengunci nilainya supaya perubahan tak
 * sengaja menjatuhkan uji, bukan menjatuhkan alarm diam-diam.
 */
export const SYNC_HEALTH_INCIDENT_MARKER = "sync_health_incident";
export const SYNC_HEALTH_OK_MARKER = "sync_health_ok";

/**
 * Penanda kedua di rel yang SAMA: severity ERROR -> log-based metric ->
 * alert policy. Endpoint, job Scheduler, dan rahasianya satu; penandanya dua
 * karena penanggapnya dua — "unit berhenti mengirim" ditangani operator,
 * "angka beku bergerak" ditangani PEMILIK, dan ia hanya padam oleh pengakuan.
 *
 * Dedup tetap urusan alert policy: incident terbuka selama metrik > 0 dan
 * menutup sendiri ketika peristiwa terakhir diakui. Tidak ada state kedua di
 * basis data yang bisa ikut basi.
 */
export const FROZEN_SHIFT_INCIDENT_MARKER = "frozen_shift_incident";

function isAuthorized(
  given: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !given) return false;
  const supplied = Buffer.from(given, "utf8");
  const expected = Buffer.from(secret, "utf8");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

@Controller("sync-health")
export class SyncHealthController {
  private readonly logger = new Logger(SyncHealthController.name);

  constructor(
    private readonly service: SyncHealthService,
    private readonly frozenShift: FrozenShiftService,
  ) {}

  /**
   * Probe kesehatan sinkronisasi, dipicu Cloud Scheduler tiap jam.
   *
   * 🔑 SELALU 200 BILA PROBE-NYA SENDIRI BERHASIL — termasuk saat ia MENEMUKAN
   * unit diam. Ini sengaja berbeda dari `SnapshotTriggerController`, yang
   * memetakan sebab ke status HTTP berbeda, dan alasannya bukan selera:
   *
   *   · Di sana, status menggambarkan nasib PEKERJAAN ITU SENDIRI — build yang
   *     tak bisa jalan memang gagal, dan Scheduler benar bila menganggapnya gagal.
   *   · Di sini, probe yang menemukan masalah justru BEKERJA DENGAN BENAR.
   *     Memulangkan non-2xx membuat Scheduler menandai job gagal lalu MENCOBA
   *     LAGI; tiap percobaan menerbitkan baris insiden baru, sehingga "sekali per
   *     insiden" yang diminta pemilik berubah jadi rentetan.
   *
   * Sinyalnya karena itu dibawa **severity log**, bukan status HTTP — dan itu
   * memang jalur yang dikonsumsi Cloud Monitoring. Satu-satunya non-2xx di sini
   * adalah 401 (rahasia salah) dan 500 (probe-nya sendiri meledak): keduanya
   * benar-benar kegagalan job, dan keduanya memang layak di-retry.
   */
  @Post()
  async check(
    @Headers("x-sync-health-secret") suppliedSecret: string | undefined,
  ): Promise<SyncHealthReport & { frozenShift: FrozenShiftReport }> {
    // Rahasia TERPISAH dari `SNAPSHOT_TRIGGER_SECRET` dengan sengaja. Probe
    // baca-saja tidak boleh memegang kunci yang bisa memicu build produksi —
    // membaca kesehatan dan memicu pekerjaan adalah dua kewenangan berbeda.
    if (!isAuthorized(suppliedSecret, process.env.SYNC_HEALTH_SECRET)) {
      throw new HttpException("unauthorized", HttpStatus.UNAUTHORIZED);
    }

    const report = await this.service.evaluate();
    const frozenShift = await this.reportFrozenShifts();

    if (report.status === "ok") {
      // Senyap secara default: satu baris INFO, tak dikonsumsi alarm.
      this.logger.log({
        msg: SYNC_HEALTH_OK_MARKER,
        active_units: report.activeUnits,
        threshold_minutes: report.thresholdMinutes,
      });
      return { ...report, frozenShift };
    }

    // Satu baris ERROR per probe selama keadaan insiden bertahan. Dedup "sekali
    // per insiden" DIKERJAKAN ALERT POLICY (incident dibuka saat metrik > 0,
    // ditutup sendiri saat berhenti) — bukan oleh state di basis data, supaya
    // tak ada state kedua yang bisa ikut basi.
    this.logger.error({
      msg: SYNC_HEALTH_INCIDENT_MARKER,
      reason: report.status,
      threshold_minutes: report.thresholdMinutes,
      active_units: report.activeUnits,
      stale_count: report.staleCount,
      never_synced_count: report.neverSyncedCount,
      // Nama unit ikut dicetak supaya email alarm bisa langsung ditindak tanpa
      // membuka psql — penerimanya sedang tidak di depan terminal.
      units: report.units
        .filter((u) => u.verdict !== "ok")
        .map((u) => ({
          unit_id: u.unitId,
          name: u.name,
          verdict: u.verdict,
          age_hours:
            u.ageSeconds === null
              ? null
              : Math.round((u.ageSeconds / 3600) * 10) / 10,
          last_run_at: u.lastRunAt,
        })),
    });
    return { ...report, frozenShift };
  }

  /**
   * Pengawas pergerakan angka pada data BEKU — rel yang sama, penanda berbeda.
   *
   * ⚠️ Kegagalannya SENGAJA tidak dilempar. Melempar akan memulangkan 500 dan
   * ikut membungkam alarm unit-diam pada probe yang sama; dua pengawas tak boleh
   * saling menjatuhkan. Tapi ia juga tidak boleh diam: probe yang tidak bisa
   * jalan memulangkan keadaan TIDAK DIKETAHUI, dan itu berbunyi di rel yang
   * sama dengan sebab yang disebut namanya.
   */
  private async reportFrozenShifts(): Promise<FrozenShiftReport> {
    let report: FrozenShiftReport;
    try {
      report = await this.frozenShift.evaluate();
    } catch (error) {
      this.logger.error({
        msg: FROZEN_SHIFT_INCIDENT_MARKER,
        reason: "probe_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "scope_returned_nothing",
        checkedAt: new Date().toISOString(),
        activeUnits: 0,
        shiftRowsVisible: 0,
        unacknowledgedCount: 0,
        shifts: [],
      };
    }

    if (report.status === "ok") return report;

    this.logger.error({
      msg: FROZEN_SHIFT_INCIDENT_MARKER,
      reason: report.status,
      active_units: report.activeUnits,
      shift_rows_visible: report.shiftRowsVisible,
      unacknowledged_count: report.unacknowledgedCount,
      // Tanggal dan selisihnya ikut dicetak supaya email alarm bisa ditindak
      // tanpa membuka psql — dan supaya yang membacanya tahu angka MANA yang
      // bergerak sebelum ia memutuskan mengakuinya.
      shifts: report.shifts.map((s) => ({
        unit_id: s.unitId,
        name: s.unitName,
        as_of_date: s.asOfDate,
        source_cycle_sequence: s.sourceCycleSequence,
        geser_piutang_lokal: s.geserPiutangLokal,
        geser_piutang_online: s.geserPiutangOnline,
        geser_hutang_lokal: s.geserHutangLokal,
      })),
    });
    return report;
  }
}
