import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json } from "express";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Batch 1000 baris ≈ 300 KB; default 100 KB terlalu kecil.
  app.use(json({ limit: "10mb" }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8080); // Cloud Run injects PORT
  await app.listen(port, "0.0.0.0");
  console.log(JSON.stringify({ msg: "ingest backend listening", port }));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
