import { Module } from "@nestjs/common";
import { ApiKeyGuard } from "./auth/api-key.guard.js";
import { IngestController } from "./ingest/ingest.controller.js";
import { IngestService } from "./ingest/ingest.service.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotBuilderService } from "./saldo-pelanggan/snapshot-builder.service.js";
import { SnapshotWorkerService } from "./saldo-pelanggan/snapshot-worker.service.js";

@Module({
  controllers: [IngestController],
  providers: [
    PrismaService,
    IngestService,
    ApiKeyGuard,
    SnapshotBuilderService,
    SnapshotWorkerService,
  ],
})
export class AppModule {}
