#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { EasyMaxConnection } from "./db/mysql.js";
import { IngestClient } from "./ingest-client.js";
import { log } from "./logger.js";
import {
  runProbe,
  runProbe2,
  runProbe3,
  runProbe4,
  runProbe5,
  runProbe6,
  runProbe7,
  runProbe8,
  runProbe9,
  runProbe10,
  runProbe11,
  runProbe12,
  runProbe13,
  runProbe14,
  runProbe15,
  runProbe16,
} from "./probe.js";
import { StateStore } from "./state/store.js";
import {
  resyncSales,
  runCycle,
  runForever,
  runManualSweep,
  SWEEP_TABLE,
  type SweepDomain,
  type SyncDeps,
} from "./sync.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Args {
  dryRun: boolean;
  once: boolean;
  testConnection: boolean;
  probe: boolean;
  probe2: boolean;
  probe3: boolean;
  probe4: boolean;
  probe5: boolean;
  probe6: boolean;
  probe7: boolean;
  probe8: boolean;
  probe9: boolean;
  probe10: boolean;
  probe11: boolean;
  probe12: boolean;
  probe13: boolean;
  probe14: boolean;
  probe15: boolean;
  probe16: boolean;
  resyncSales: boolean;
  deepSweepDomain?: string;
  deepSweepDays?: number;
  probeDiscoveryOnly: boolean;
  probeDates: string[];
  configPath?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dryRun: false,
    once: false,
    testConnection: false,
    probe: false,
    probe2: false,
    probe3: false,
    probe4: false,
    probe5: false,
    probe6: false,
    probe7: false,
    probe8: false,
    probe9: false,
    probe10: false,
    probe11: false,
    probe12: false,
    probe13: false,
    probe14: false,
    probe15: false,
    probe16: false,
    resyncSales: false,
    probeDiscoveryOnly: false,
    probeDates: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--once") a.once = true;
    else if (arg === "--test-connection") a.testConnection = true;
    else if (arg === "--probe") a.probe = true;
    else if (arg === "--probe2") a.probe2 = true;
    else if (arg === "--probe3") a.probe3 = true;
    else if (arg === "--probe4") a.probe4 = true;
    else if (arg === "--probe5") a.probe5 = true;
    else if (arg === "--probe6") a.probe6 = true;
    else if (arg === "--probe7") a.probe7 = true;
    else if (arg === "--probe8") a.probe8 = true;
    else if (arg === "--probe9") a.probe9 = true;
    else if (arg === "--probe10") a.probe10 = true;
    else if (arg === "--probe11") a.probe11 = true;
    else if (arg === "--probe12") a.probe12 = true;
    else if (arg === "--probe13") a.probe13 = true;
    else if (arg === "--probe14") a.probe14 = true;
    else if (arg === "--probe15") a.probe15 = true;
    else if (arg === "--probe16") a.probe16 = true;
    else if (arg === "--resync-sales") a.resyncSales = true;
    else if (arg === "--deep-sweep") {
      a.deepSweepDomain = argv[++i];
      a.deepSweepDays = Number(argv[++i]);
    } else if (arg === "--discovery") a.probeDiscoveryOnly = true;
    else if (DATE_RE.test(arg!)) a.probeDates.push(arg!);
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
      "  --probe [tgl...]    FASE 0.5: probe SELECT-only utk rekonsiliasi (default 2026-06-14 2026-06-17). Tak mengirim.",
      "  --probe2 [tgl...]   FASE 0.5b: probe ronde 2 (tindak lanjut EDC/Pelanggan/Pengeluaran/PK). Tak mengirim.",
      "  --probe3 [tgl...]   FASE 0.5c: probe ronde 3 (rekon tr_hjualplg + vw_edc + tr_bpbank). Tak mengirim.",
      "  --probe4 [tgl...]   FASE 0.5d: probe ronde 3b (rekon final vw_jualplg by DTGL + vw_edc3 by ctgl). Tak mengirim.",
      "  --probe5 [tgl...]   FASE 0.5d2: probe ronde 3c (kunci query Pelanggan lengkap: union + linkage). Tak mengirim.",
      "  --probe6 [tgl...]   FASE 0.5e: probe ronde 3d (sumber volume penjualan voucher). Tak mengirim.",
      "  --probe7            FASE 0.5f: probe ronde 3e (latensi vw_jualplg vs base-table + delta 15 Jun). Tak mengirim.",
      "  --probe8            FASE 0.5g: diagnosa lock go-live (MyISAM concurrent_insert + Data_free). Read-only.",
      "  --probe9 [tgl...]   FASE 1: rekon SALES EasyMax per DTGLJUAL vs PDF Omset (default 14–18 Jun). Read-only.",
      "  --probe10 [tgl...]  GOLD CHECK: total EasyMax-kini SEMUA seksi (Omset/Pelanggan/EDC/Deposit) per tgl. Read-only.",
      "  --probe11 [tgl...]  FASE 1 SALDO: kunci Piutang/Hutang (tr_bppiut + master pelanggan + tr_deposit). Read-only.",
      "  --probe12 [tgl...]  FASE 1 SALDO (koreksi): master tm_plg + model per-pelanggan + ledger Hutang. Read-only.",
      "  --probe13 [tgl...]  FASE 1 SALDO (decisive): split SJENIS + tr_bphut + view buku resmi. Read-only.",
      "  --probe14 [tgl...]  FASE 0.5h: SUMBER B/Terra Rincian (skema tera penuh + view/proc + dump per hari). Read-only.",
      "  --probe15 [tgl...]  FASE 0.5i: LEDGER terra resmi (tr_hterra/tr_dterra/vw_terra) + rekon B 8-hari. Read-only.",
      "  --probe16 [tgl...]  FASE 0.5j: REKON ledger terra (kolom benar: DTGLTERRA/NVOLUME/NTOTAL) vs oracle B. Read-only.",
      "  --resync-sales <from> <to>  Re-backfill SALES per DTGLJUAL [from..to] (UPSERT idempoten, tangkap NULL-DTGLJAM). MENGIRIM.",
      "  --deep-sweep <domain> <days>  Track 2: sapuan manual SATU domain, N hari terakhir s/d hari ini.",
      "                      <domain> ∈ pelanggan|edc|opname|delivery|tera|cash|tebus. Idempoten (REPLACE/UPSERT). MENGIRIM.",
      "  --discovery         Dengan --probe: hanya jalankan discovery skema (DESCRIBE+sample), berhenti sebelum P1–P6.",
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
    mode: args.testConnection
      ? "test-connection"
      : args.probe16
      ? "probe16"
      : args.probe15
      ? "probe15"
      : args.probe14
      ? "probe14"
      : args.probe13
      ? "probe13"
      : args.probe12
      ? "probe12"
      : args.probe11
      ? "probe11"
      : args.probe10
      ? "probe10"
      : args.probe9
      ? "probe9"
      : args.probe8
        ? "probe8"
        : args.probe7
          ? "probe7"
          : args.probe6
          ? "probe6"
          : args.probe5
          ? "probe5"
          : args.probe4
            ? "probe4"
            : args.probe3
              ? "probe3"
              : args.probe2
                ? "probe2"
                : args.probe
                  ? "probe"
                  : args.once
                    ? "once"
                    : "loop",
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
    if (args.probe16) {
      try {
        await runProbe16(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe15) {
      try {
        await runProbe15(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe14) {
      try {
        await runProbe14(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe13) {
      try {
        await runProbe13(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe12) {
      try {
        await runProbe12(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe11) {
      try {
        await runProbe11(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe10) {
      try {
        await runProbe10(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe9) {
      try {
        await runProbe9(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe8) {
      try {
        await runProbe8(conn);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe7) {
      try {
        await runProbe7(conn);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe6) {
      try {
        await runProbe6(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe5) {
      try {
        await runProbe5(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe4) {
      try {
        await runProbe4(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe3) {
      try {
        await runProbe3(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe2) {
      try {
        await runProbe2(conn, args.probeDates);
      } finally {
        await conn.close();
      }
      return;
    }
    if (args.probe) {
      try {
        await runProbe(conn, args.probeDates, {
          discoveryOnly: args.probeDiscoveryOnly,
        });
      } finally {
        await conn.close();
      }
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
    if (args.resyncSales) {
      const [from, to] = args.probeDates;
      if (!from || !to || args.probeDates.length !== 2) {
        log.error("--resync-sales butuh TEPAT 2 tanggal: --resync-sales <from> <to>", {
          diberikan: args.probeDates,
        });
        process.exitCode = 1;
        return;
      }
      await resyncSales(deps, from, to);
    } else if (args.deepSweepDomain !== undefined) {
      const domain = args.deepSweepDomain as SweepDomain;
      if (!(domain in SWEEP_TABLE) || !args.deepSweepDays || Number.isNaN(args.deepSweepDays)) {
        log.error("--deep-sweep butuh <domain> valid + <days> angka", {
          domain: args.deepSweepDomain,
          days: args.deepSweepDays,
          domainValid: Object.keys(SWEEP_TABLE),
        });
        process.exitCode = 1;
        return;
      }
      await runManualSweep(deps, domain, args.deepSweepDays);
    } else if (args.once || args.dryRun) {
      await runCycle(deps, {
        includeMasters: true,
        includePelanggan: true,
        includeSalesRescan: true,
      });
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
