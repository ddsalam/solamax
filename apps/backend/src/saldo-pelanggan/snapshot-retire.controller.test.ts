import { HttpException, Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import { SnapshotTriggerController } from "./snapshot-trigger.controller.js";
import { SNAPSHOT_RETIREMENT_LIMITS } from "./snapshot-config.js";
import type { RetirementSummary } from "./source-capture.service.js";
import type { SnapshotWorkerService } from "./snapshot-worker.service.js";

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
function harness(summary: RetirementSummary = { stagingBefore: 3, stagingAfter: 1, rowsDeleted: 711_020 }) {
  const worker = {
    retireOnly: vi.fn(async () => summary),
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
        status: "retired", stagingBefore: 3, stagingAfter: 1, rowsDeleted: 711_020,
        staging_review: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("mengangkat angka laju ke log — tanpa psql", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const lines: string[] = [];
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation((v: unknown) => { lines.push(String(v)); });
    try {
      await harness().controller.retire(SECRET, { unit_id: 1 });
      const line = lines.find(l => l.includes("snapshot-retire finished"));
      expect(line).toBeDefined();
      for (const field of ["staging_before", "staging_after", "rows_deleted", "staging_review"]) {
        expect(line, `log kehilangan ${field} — operator kembali harus membuka psql`).toContain(field);
      }
    } finally {
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("BERBUNYI (warn) ketika staging melewati ambang, diam ketika di bawahnya", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    try {
      const over = SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount + 1;
      const loud = await harness({ stagingBefore: 22, stagingAfter: over, rowsDeleted: 0 })
        .controller.retire(SECRET, { unit_id: 1 });
      expect(loud.staging_review).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockClear();
      // Kontrol negatif: keadaan sehat TIDAK boleh berbunyi, kalau tidak
      // alarmnya selalu menyala dan berhenti dibaca orang.
      const quiet = await harness({
        stagingBefore: 2, stagingAfter: SNAPSHOT_RETIREMENT_LIMITS.stagingReviewCount, rowsDeleted: 0,
      }).controller.retire(SECRET, { unit_id: 1 });
      expect(quiet.staging_review).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
