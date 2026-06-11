#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { EasyMaxConnection } from "./db/mysql.js";
import { IngestClient } from "./ingest-client.js";
import { log } from "./logger.js";
import { StateStore } from "./state/store.js";
import { runCycle, runForever, type SyncDeps } from "./sync.js";

interface Args {
  dryRun: boolean;
  once: boolean;
  testConnection: boolean;
  configPath?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, once: false, testConnection: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--once") a.once = true;
    else if (arg === "--test-connection") a.testConnection = true;
    else if (arg === "--config") a.configPath = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      log.error("argumen tak dikenal", { arg });
      printHelp();
      process.exit(2);
    }
  }
  return a;
}

function printHelp(): void {
  process.stdout.write(
    [
      "SolaMax sync agent",
      "",
      "Penggunaan: solamax-agent [opsi]",
      "  --test-connection   Hanya tes koneksi read-only ke MySQL (versi, tz). Tak mengirim.",
      "  --dry-run           Tarik data & cetak ringkasan payload, TANPA kirim ke backend.",
      "  --once              Jalankan satu siklus lalu keluar (default: loop berkala).",
      "  --config <path>     Path file config (default: env SOLAMAX_AGENT_CONFIG / config.local.json).",
      "  -h, --help          Tampilkan bantuan ini.",
      "",
      "Secret via env: SOLAMAX_MYSQL_PASSWORD, SOLAMAX_API_KEY.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig({ configPath: args.configPath });
  log.info("agent start", {
    unit: cfg.unitCode,
    dryRun: args.dryRun,
    mode: args.testConnection ? "test-connection" : args.once ? "once" : "loop",
  });

  const conn = await EasyMaxConnection.open(cfg);

  // 🔌 Selalu buktikan koneksi read-only + versi server dulu (temuan #3: MySQL 5.0.67).
  try {
    const ping = await conn.ping();
    log.info("koneksi MySQL OK", ping);
    if (!ping.version.startsWith("5.0")) {
      log.warn("versi MySQL bukan 5.0 seperti diharapkan", { version: ping.version });
    }
    if (args.testConnection) {
      await conn.close();
      return;
    }
  } catch (err) {
    await conn.close();
    log.error("koneksi/handshake MySQL gagal — cek driver/auth lawas (5.0)", {
      err: String(err),
    });
    process.exitCode = 1;
    return;
  }

  const deps: SyncDeps = {
    conn,
    client: new IngestClient(cfg),
    store: new StateStore(cfg.dataDir),
    cfg,
    dryRun: args.dryRun,
  };

  try {
    if (args.once || args.dryRun) {
      await runCycle(deps, { includeMasters: true });
    } else {
      await runForever(deps);
    }
  } finally {
    await conn.close();
  }
}

main().catch((err) => {
  log.error("agent crash", { err: String(err) });
  process.exit(1);
});
