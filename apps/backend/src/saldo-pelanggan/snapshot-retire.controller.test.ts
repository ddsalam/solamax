import { HttpException, Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  RETIRE_INCIDENT_MARKER,
  SnapshotTriggerController,
} from "./snapshot-trigger.controller.js";
import { StructuredLogger } from "../sync-health/structured-logger.js";
import { SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";
import type { RetirementSummary } from "./source-capture.service.js";
import type { RetirementRun, SnapshotWorkerService } from "./snapshot-worker.service.js";

const SECRET = "rahasia-uji-snapshot-cukup-panjang-32-karakter";

/**
 * Endpoint ini ada karena LAJU, bukan karena kerapian.
 *
 * Penangkapan cut berjalan ±1×/jam (mengikuti masterIntervalMs), sementara
 * penandaan staging->failed hanya terjadi saat snapshot worker berjalan —
 * sekali sehari, terikat cron build 02:05. Terukur di produksi 14-09-2026:
 * 22 cut staging menumpuk dalam ±27 jam dan memegang 97,7% baris
 * `source_bppiut`; 3,38 GB/hari; gerbang 9 GB menutup dan SELURUH publikasi
 * snapshot beku.
 *
 * Yang dijaga uji ini: endpoint memensiunkan TANPA membangun, memulangkan 200
 * supaya job per jam tidak tercatat gagal 20-an kali sehari, dan mengangkat
 * angka lajunya ke log supaya operator tidak perlu membuka psql.
 */
function harness(
  summary: RetirementSummary = { stagingBefore: 3, stagingAfter: 1, rowsDeleted: 711_020, cyclesConsidered: 0, cyclesDrained: 0 },
  run?: RetirementRun,
) {
  const worker = {
    retireOnly: vi.fn(async () => summary),
    retireAllUnits: vi.fn(async () => run ?? { units: [{ unitId: 1, ...summary }], skipped: [] }),
    runBatch: vi.fn(async () => { throw new Error("retire tidak boleh membangun"); }),
  } as unknown as SnapshotWorkerService;
  const prisma = {
    unit: { findFirst: vi.fn(async () => ({ unitId: 1 })) },
  } as unknown as PrismaService;
  return { controller: new SnapshotTriggerController(prisma, worker), worker, prisma };
}

async function rejected(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    throw new Error("expected HttpException");
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return error.getStatus();
  }
}

describe("POST /snapshot-worker/retire", () => {
  it("menolak secret salah dan unit tak dikenal dengan respons yang sama", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const a = harness();
      expect(await rejected(a.controller.retire("salah", { unit_id: 1 }))).toBe(404);
      expect(a.worker.retireOnly).not.toHaveBeenCalled();

      const b = harness();
      (b.prisma.unit.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      expect(await rejected(b.controller.retire(SECRET, { unit_id: 99 }))).toBe(404);
      expect(b.worker.retireOnly).not.toHaveBeenCalled();

      const c = harness();
      expect(await rejected(c.controller.retire(SECRET, { unit_id: "satu" }))).toBe(404);
      expect(c.worker.retireOnly).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("memensiunkan TANPA membangun, dan memulangkan angkanya", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const h = harness();
      const body = await h.controller.retire(SECRET, { unit_id: 1 });
      expect(h.worker.retireOnly).toHaveBeenCalledWith(1);
      // Membangun di jalur ini akan mengambil lease global dan bersaing dengan
      // cron 02:05; harness sengaja melempar bila itu terjadi.
      expect(h.worker.runBatch).not.toHaveBeenCalled();
      expect(body).toMatchObject({
        status: "retired", stagingBefore: 3, stagingAfter: 1, rowsDeleted: 711_020, cyclesConsidered: 0, cyclesDrained: 0,
        staging_review: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("mengangkat angka laju ke log — tanpa psql", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const lines: string[] = [];
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation((v: unknown) => { lines.push(JSON.stringify(v)); });
    try {
      await harness().controller.retire(SECRET, { unit_id: 1 });
      const line = lines.find((l) => l.includes(RETIRE_INCIDENT_MARKER));
      expect(line).toBeDefined();
      for (const field of [
        "staging_before", "staging_after", "rows_deleted", "staging_review",
        // Dua angka yang membuat "berjalan tapi tak pernah tuntas" terlihat.
        "cycles_considered", "cycles_drained",
      ]) {
        expect(line, `log kehilangan ${field} — operator kembali harus membuka psql`).toContain(field);
      }
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("BERBUNYI (warn) ketika staging melewati ambang, diam ketika di bawahnya", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const warn = vi.spyOn(StructuredLogger.prototype, "error").mockImplementation(() => {});
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      const over = SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount + 1;
      const loud = await harness({ stagingBefore: 22, stagingAfter: over, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0 })
        .controller.retire(SECRET, { unit_id: 1 });
      expect(loud.staging_review).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockClear();
      // Kontrol negatif: keadaan sehat TIDAK boleh berbunyi, kalau tidak
      // alarmnya selalu menyala dan berhenti dibaca orang.
      const quiet = await harness({
        stagingBefore: 2, stagingAfter: SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0,
      }).controller.retire(SECRET, { unit_id: 1 });
      expect(quiet.staging_review).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("TANPA unit_id memensiunkan SELURUH unit — bukan unit 1 saja", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      const h = harness(undefined, {
        units: [
          { unitId: 4, stagingBefore: 32, stagingAfter: 1, rowsDeleted: 12_717_355, cyclesConsidered: 0, cyclesDrained: 0 },
          { unitId: 1, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0 },
        ],
        skipped: [],
      });
      const body = await h.controller.retire(SECRET, {});
      expect(h.worker.retireAllUnits).toHaveBeenCalledTimes(1);
      expect(h.worker.retireOnly).not.toHaveBeenCalled();
      // Total tetap ada di tingkat atas supaya pemanggilan lama tak berubah arti.
      expect(body).toMatchObject({ status: "retired", stagingBefore: 33, rowsDeleted: 12_717_355, cyclesConsidered: 0, cyclesDrained: 0 });
      expect(body.units.map(u => u.unitId)).toEqual([4, 1]);
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("BERBUNYI untuk SATU unit yang membengkak di antara unit yang bersih", async () => {
    // Inilah kegagalan 14-09-2026: unit 4 menumpuk 32 cut selama berbulan-bulan
    // sementara unit lain bersih. Ambang yang dinilai atas TOTAL akan
    // menenggelamkannya; karena itu ia dinilai per unit lalu di-OR.
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const warn = vi.spyOn(StructuredLogger.prototype, "error").mockImplementation(() => {});
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      const over = SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount + 1;
      const h = harness(undefined, {
        units: [
          { unitId: 4, stagingBefore: 32, stagingAfter: over, rowsDeleted: 1, cyclesConsidered: 0, cyclesDrained: 0 },
          { unitId: 1, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0 },
          { unitId: 2, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0 },
        ],
        skipped: [],
      });
      const body = await h.controller.retire(SECRET, {});
      expect(body.staging_review).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      // KONTROL NEGATIF YANG MEMBEDAKAN per-unit dari total.
      // Tujuh unit yang MASING-MASING sehat (1 cut) berjumlah 7 — melewati
      // ambang 4. Ambang atas total akan menyala di sini setiap jam, selamanya:
      // alarm yang selalu menyala, yang lalu berhenti dibaca. Per-unit harus
      // DIAM. Inilah kasus yang jatuh bila seseorang menggantinya dengan total.
      warn.mockClear();
      const tenang = await harness(undefined, {
        units: [1, 2, 3, 4, 5, 6, 7].map(unitId => (
          { unitId, stagingBefore: 2, stagingAfter: 1, rowsDeleted: 1, cyclesConsidered: 0, cyclesDrained: 0 })),
        skipped: [],
      }).controller.retire(SECRET, {});
      expect(tenang.stagingAfter).toBe(7);
      expect(tenang.stagingAfter).toBeGreaterThan(SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount);
      expect(tenang.staging_review).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("unit yang GAGAL atau TERLEWAT tidak didiamkan", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const warn = vi.spyOn(StructuredLogger.prototype, "error").mockImplementation(() => {});
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      const gagal = await harness(undefined, {
        units: [{ unitId: 4, stagingBefore: 0, stagingAfter: 0, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0, error: "boom" }],
        skipped: [],
      }).controller.retire(SECRET, {});
      expect(gagal.staging_review).toBe(true);

      const terlewat = await harness(undefined, {
        units: [{ unitId: 4, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0 }],
        skipped: [7],
      }).controller.retire(SECRET, {});
      expect(terlewat.staging_review).toBe(true);
      expect(terlewat.skipped).toEqual([7]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("BERBUNYI untuk unit yang kalah balapan cut-vs-build (punya job, selalu idle)", async () => {
    // Batu Layang 16-09-2026: cut seq 7 mulai 02:33:31, build 02:35 saat masih
    // mengunggah, cut berikutnya menggusurnya jadi failed. Nol cut `complete`,
    // nol snapshot — dan endpointnya memulangkan `idle`: sah, tenang, dan tak
    // terlihat. Gerbang cakupan menangkap "unit TANPA job", bukan ini.
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const warn = vi.spyOn(StructuredLogger.prototype, "error").mockImplementation(() => {});
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      const kalah = await harness(undefined, {
        units: [
          { unitId: 5, stagingBefore: 2, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0,
            oldestCutHours: 48, completeAgeHours: null, staleCut: true },
          { unitId: 1, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0,
            oldestCutHours: 200, completeAgeHours: 6, staleCut: false },
        ],
        skipped: [],
      }).controller.retire(SECRET, {});
      expect(kalah.staging_review).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      // KONTROL NEGATIF: unit yang bundle-nya baru ditukar beberapa jam lalu
      // memang belum punya cut complete. Berbunyi untuknya membuat setiap hari
      // penukaran jadi alarm palsu.
      warn.mockClear();
      const baru = await harness(undefined, {
        units: [{ unitId: 6, stagingBefore: 1, stagingAfter: 1, rowsDeleted: 0, cyclesConsidered: 0, cyclesDrained: 0,
                  oldestCutHours: 3, completeAgeHours: null, staleCut: false }],
        skipped: [],
      }).controller.retire(SECRET, {});
      expect(baru.staging_review).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore(); log.mockRestore(); vi.unstubAllEnvs();
    }
  });
});

describe("alarm pemensiunan — rel yang sama, penanda sendiri", () => {
  it("penanda TERKUNCI sebagai kontrak dengan log-based metric", async () => {
    const { FROZEN_SHIFT_INCIDENT_MARKER, SYNC_HEALTH_INCIDENT_MARKER } =
      await import("../sync-health/sync-health.controller.js");
    expect(RETIRE_INCIDENT_MARKER).toBe("retire_incident");
    // Tiga penanggap berbeda: unit diam = operator, angka beku = pemilik,
    // pemensiunan gagal = operator kapasitas. Penandanya tak boleh sama.
    expect(RETIRE_INCIDENT_MARKER).not.toBe(FROZEN_SHIFT_INCIDENT_MARKER);
    expect(RETIRE_INCIDENT_MARKER).not.toBe(SYNC_HEALTH_INCIDENT_MARKER);
  });

  it("🔴 unit yang GAGAL terbit sebagai ERROR — bukan warn yang tak dibaca siapa pun", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const errors: Array<Record<string, unknown>> = [];
    const err = vi.spyOn(StructuredLogger.prototype, "error")
      .mockImplementation((payload) => { errors.push(payload); });
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      await harness(undefined, {
        units: [{
          unitId: 7, stagingBefore: 0, stagingAfter: 0, rowsDeleted: 0,
          cyclesConsidered: 3, cyclesDrained: 0,
          error: "Transaction already closed: timeout 30000 ms, however 36248 ms passed",
        }],
        skipped: [],
      }).controller.retire(SECRET, {});

      expect(errors).toHaveLength(1);
      expect(errors[0]!.msg).toBe(RETIRE_INCIDENT_MARKER);
      expect(errors[0]!.staging_review).toBe(true);
      // Sebabnya ikut ke email supaya bisa ditindak tanpa membuka psql.
      expect(JSON.stringify(errors[0])).toContain("36248 ms");
      expect(JSON.stringify(errors[0])).toContain("cycles_considered");
    } finally { err.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); }
  });

  it("keadaan sehat SENYAP — alarm yang selalu menyala berhenti dibaca", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const err = vi.spyOn(StructuredLogger.prototype, "error").mockImplementation(() => {});
    const log = vi.spyOn(StructuredLogger.prototype, "log").mockImplementation(() => {});
    try {
      await harness({
        stagingBefore: 2, stagingAfter: 1, rowsDeleted: 10,
        cyclesConsidered: 1, cyclesDrained: 1,
      }).controller.retire(SECRET, { unit_id: 1 });
      expect(err).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    } finally { err.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); }
  });
});
