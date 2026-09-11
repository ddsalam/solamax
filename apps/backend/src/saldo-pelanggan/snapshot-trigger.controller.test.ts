import { HttpException } from "@nestjs/common";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma.service.js";
import {
  SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS,
  SnapshotTriggerController,
} from "./snapshot-trigger.controller.js";
import type {
  SnapshotWorkerResult,
  SnapshotWorkerService,
} from "./snapshot-worker.service.js";

const SECRET = "rahasia-uji-snapshot-cukup-panjang-32-karakter";

function harness(result: SnapshotWorkerResult = {
  status: "done",
  workId: "11111111-1111-4111-8111-111111111111",
  generationId: "22222222-2222-4222-8222-222222222222",
}) {
  const worker = {
    runOnce: vi.fn(async () => result),
  } as unknown as SnapshotWorkerService;
  const prisma = {
    unit: {
      findFirst: vi.fn(async () => ({ unitId: 1 })),
    },
  } as unknown as PrismaService;
  const response = {
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return {
    controller: new SnapshotTriggerController(prisma, worker),
    prisma,
    response,
    worker,
  };
}

async function rejected(call: Promise<unknown>): Promise<{ status: number; response: unknown }> {
  try {
    await call;
    throw new Error("expected HttpException");
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return { status: error.getStatus(), response: error.getResponse() };
  }
}

describe("SnapshotTriggerController", () => {
  it("menolak secret salah dan unit tak dikenal dengan respons identik", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const wrongSecret = harness();
      const wrong = await rejected(
        wrongSecret.controller.trigger("salah", { unit_id: 1 }, wrongSecret.response),
      );
      expect(wrongSecret.worker.runOnce).not.toHaveBeenCalled();

      const unknownUnit = harness();
      vi.mocked(unknownUnit.prisma.unit.findFirst).mockResolvedValueOnce(null);
      const unknown = await rejected(
        unknownUnit.controller.trigger(SECRET, { unit_id: 99 }, unknownUnit.response),
      );
      expect(unknownUnit.worker.runOnce).not.toHaveBeenCalled();

      expect(wrong).toEqual(unknown);
      expect(wrong.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("secret absen dan unit_id invalid memakai penolakan generik yang sama", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const missing = harness();
      const missingResult = await rejected(
        missing.controller.trigger(undefined, { unit_id: 1 }, missing.response),
      );
      const invalid = harness();
      const invalidResult = await rejected(
        invalid.controller.trigger(SECRET, { unit_id: 40_000 }, invalid.response),
      );
      expect(missingResult).toEqual(invalidResult);
      expect(missing.worker.runOnce).not.toHaveBeenCalled();
      expect(invalid.worker.runOnce).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["", "terlalu-pendek"])(
    "fail-closed ketika secret server absen atau pendek (%j)",
    async (configuredSecret) => {
      vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", configuredSecret);
      try {
        const { controller, response, worker } = harness();
        await expect(
          rejected(controller.trigger(SECRET, { unit_id: 1 }, response)),
        ).resolves.toMatchObject({ status: 404 });
        expect(worker.runOnce).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("menutup galat lookup unit tanpa menjalankan worker atau membocorkan detail", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const { controller, prisma, response, worker } = harness();
      vi.mocked(prisma.unit.findFirst).mockRejectedValueOnce(new Error("detail database"));
      await expect(
        rejected(controller.trigger(SECRET, { unit_id: 1 }, response)),
      ).resolves.toEqual({ status: 500, response: { status: "failed" } });
      expect(worker.runOnce).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("menutup galat worker tanpa membocorkan detail internal", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const { controller, response, worker } = harness();
      vi.mocked(worker.runOnce).mockRejectedValueOnce(new Error("detail builder"));
      await expect(
        rejected(controller.trigger(SECRET, { unit_id: 1 }, response)),
      ).resolves.toEqual({ status: 500, response: { status: "failed" } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sukses memicu tepat satu unit dengan deadline sebelum batas Cloud Run", async () => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const { controller, response, worker } = harness();
      const before = Date.now();
      await expect(controller.trigger(SECRET, { unit_id: 1 }, response)).resolves.toEqual({
        status: "done",
        workId: "11111111-1111-4111-8111-111111111111",
        generationId: "22222222-2222-4222-8222-222222222222",
      });
      expect(response.status).toHaveBeenCalledWith(200);
      expect(worker.runOnce).toHaveBeenCalledOnce();
      const [unitId, leaseOwner, options] = vi.mocked(worker.runOnce).mock.calls[0]!;
      expect(unitId).toBe(1);
      expect(leaseOwner).toMatch(/^snapshot-http:/);
      expect(options?.attemptDeadlineEpochMs).toBeGreaterThanOrEqual(
        before + SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS,
      );
      expect(options?.attemptDeadlineEpochMs).toBeLessThanOrEqual(
        Date.now() + SNAPSHOT_TRIGGER_REQUEST_MILLISECONDS,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    [{ status: "idle" } as const, 204],
    [{ status: "busy" } as const, 409],
    [{ status: "skipped", reason: "outside_build_window" } as const, 425],
    [{ status: "superseded", workId: "work-1" } as const, 208],
    [{ status: "retry_wait", workId: "work-1", error: "retry" } as const, 503],
    [{ status: "dead_letter", workId: "work-1", error: "fatal" } as const, 500],
  ])("memetakan hasil worker %s ke HTTP %i", async (result, status) => {
    vi.stubEnv("SNAPSHOT_TRIGGER_SECRET", SECRET);
    try {
      const { controller, response } = harness(result);
      if (status < 400) {
        await controller.trigger(SECRET, { unit_id: 1 }, response);
        expect(response.status).toHaveBeenCalledWith(status);
      } else {
        await expect(
          rejected(controller.trigger(SECRET, { unit_id: 1 }, response)),
        ).resolves.toMatchObject({ status });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
