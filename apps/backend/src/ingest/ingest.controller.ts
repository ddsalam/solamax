import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { IngestPayload, type IngestResponse } from "@solamax/shared";
import { ApiKeyGuard, type AuthedRequest } from "../auth/api-key.guard.js";
import { IngestService } from "./ingest.service.js";

@Controller()
export class IngestController {
  constructor(private readonly service: IngestService) {}

  /** Health check (tanpa auth) untuk Cloud Run. */
  @Get("healthz")
  healthz(): { ok: true } {
    return { ok: true };
  }

  @Post("ingest")
  @HttpCode(200)
  @UseGuards(ApiKeyGuard)
  async ingest(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<IngestResponse> {
    // Validasi payload (zod @solamax/shared) → 422 tanpa commit apa pun.
    const parsed = IngestPayload.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException(
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    }
    // API key harus milik unit yang diklaim payload → 403 bila tidak.
    if (parsed.data.unit_code !== req.unit.code) {
      throw new ForbiddenException(
        `unit_code '${parsed.data.unit_code}' tak sesuai API key`,
      );
    }
    return this.service.ingest(req.unit.unitId, parsed.data);
  }
}
