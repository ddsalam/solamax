import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../prisma.service.js";

export interface AuthedUnit {
  unitId: number;
  code: string;
}

/** Request dengan unit hasil auth API key (diisi guard). */
export type AuthedRequest = Request & { unit: AuthedUnit };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Auth API key per-unit: `Authorization: Bearer <key>` → sha256 → lookup
 * `unit.api_key_hash`. Key plaintext tak pernah disimpan; cabut akses =
 * ganti hash di tabel unit.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const [scheme, key] = header.split(" ");
    if (scheme !== "Bearer" || !key) {
      throw new UnauthorizedException("API key tidak ada");
    }
    const unit = await this.prisma.unit.findUnique({
      where: { apiKeyHash: hashApiKey(key) },
      select: { unitId: true, code: true, active: true },
    });
    if (!unit || !unit.active) {
      throw new UnauthorizedException("API key tidak dikenal / unit nonaktif");
    }
    req.unit = { unitId: unit.unitId, code: unit.code };
    return true;
  }
}
