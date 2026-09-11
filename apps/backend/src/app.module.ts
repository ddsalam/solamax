import { Module } from "@nestjs/common";
import { ApiKeyGuard } from "./auth/api-key.guard.js";
import { IngestController } from "./ingest/ingest.controller.js";
import { IngestService } from "./ingest/ingest.service.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotBuilderService } from "./saldo-pelanggan/snapshot-builder.service.js";
import { SnapshotTriggerController } from "./saldo-pelanggan/snapshot-trigger.controller.js";
import { SnapshotWorkerService } from "./saldo-pelanggan/snapshot-worker.service.js";
import { SnapshotSourceCaptureService } from "./saldo-pelanggan/source-capture.service.js";

@Module({
  controllers: [IngestController, SnapshotTriggerController],
  providers: [
    PrismaService,
    IngestService,
    ApiKeyGuard,
    SnapshotBuilderService,
    SnapshotWorkerService,
    SnapshotSourceCaptureService,
  ],
})
export class AppModule {}
