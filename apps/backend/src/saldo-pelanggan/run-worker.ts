import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { SnapshotWorkerService } from "./snapshot-worker.service.js";

function parseUnitId(raw: string | undefined): number {
  if (!raw || !/^-?\d+$/.test(raw)) {
    throw new Error("usage: pnpm snapshot:worker -- <unit-id>");
  }
  const unitId = Number(raw);
  if (!Number.isInteger(unitId) || unitId < -32_768 || unitId > 32_767) {
    throw new Error("unit-id must fit PostgreSQL SMALLINT");
  }
  return unitId;
}

const unitId = parseUnitId(process.argv[2]);
const leaseOwner = `${hostname()}:${process.pid}:${randomUUID()}`;
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ["error", "warn"],
});

try {
  const result = await app.get(SnapshotWorkerService).runOnce(unitId, leaseOwner);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "dead_letter") process.exitCode = 1;
} finally {
  await app.close();
}
