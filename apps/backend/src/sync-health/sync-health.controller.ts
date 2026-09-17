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

/**
 * Penanda log yang DIKONSUMSI alarm. Jangan diubah tanpa mengubah
 * log-based metric `solamax_sync_health_incident` — keduanya satu kontrak.
 * `sync-health.controller.test.ts` mengunci nilainya supaya perubahan tak
 * sengaja menjatuhkan uji, bukan menjatuhkan alarm diam-diam.
 */
export const SYNC_HEALTH_INCIDENT_MARKER = "sync_health_incident";
export const SYNC_HEALTH_OK_MARKER = "sync_health_ok";

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

  constructor(private readonly service: SyncHealthService) {}

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
  ): Promise<SyncHealthReport> {
    // Rahasia TERPISAH dari `SNAPSHOT_TRIGGER_SECRET` dengan sengaja. Probe
    // baca-saja tidak boleh memegang kunci yang bisa memicu build produksi —
    // membaca kesehatan dan memicu pekerjaan adalah dua kewenangan berbeda.
    if (!isAuthorized(suppliedSecret, process.env.SYNC_HEALTH_SECRET)) {
      throw new HttpException("unauthorized", HttpStatus.UNAUTHORIZED);
    }

    const report = await this.service.evaluate();

    if (report.status === "ok") {
      // Senyap secara default: satu baris INFO, tak dikonsumsi alarm.
      this.logger.log({
        msg: SYNC_HEALTH_OK_MARKER,
        active_units: report.activeUnits,
        threshold_minutes: report.thresholdMinutes,
      });
      return report;
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
    return report;
  }
}
