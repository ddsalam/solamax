import {
  IngestResponse,
  type IngestPayload,
} from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import { log } from "./logger.js";

export class IngestError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

/** Klien POST /ingest. 5xx & error jaringan = retriable; 4xx = fatal (jangan retry). */
export class IngestClient {
  constructor(private readonly cfg: AgentConfig) {}

  async send(payload: IngestPayload): Promise<IngestResponse> {
    const url = new URL("/ingest", this.cfg.backend.baseUrl).toString();
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      this.cfg.backend.requestTimeoutMs,
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.backend.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const retriable = res.status >= 500 || res.status === 429;
        throw new IngestError(
          `ingest ${res.status}: ${body.slice(0, 300)}`,
          retriable,
          res.status,
        );
      }
      return IngestResponse.parse(await res.json());
    } catch (err) {
      if (err instanceof IngestError) throw err;
      // fetch abort / DNS / connection refused → retriable (backend offline).
      throw new IngestError(`koneksi backend gagal: ${String(err)}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Kirim dengan retry+backoff untuk error retriable; lempar bila habis/fatal. */
  async sendWithRetry(
    payload: IngestPayload,
    opts: { retries: number; baseDelayMs: number },
  ): Promise<IngestResponse> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.send(payload);
      } catch (err) {
        if (!(err instanceof IngestError) || !err.retriable) throw err;
        if (attempt >= opts.retries) throw err;
        const delay = opts.baseDelayMs * 2 ** attempt;
        log.warn("ingest retriable, mundur sejenak", {
          attempt,
          delay,
          err: err.message,
        });
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }
  }
}
