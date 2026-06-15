import { Module } from "@nestjs/common";
import { ApiKeyGuard } from "./auth/api-key.guard.js";
import { IngestController } from "./ingest/ingest.controller.js";
import { IngestService } from "./ingest/ingest.service.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [IngestController],
  providers: [PrismaService, IngestService, ApiKeyGuard],
})
export class AppModule {}
