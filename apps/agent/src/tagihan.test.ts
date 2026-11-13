import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IngestPayload,
  MAX_ROWS_PER_TABLE,
  MAX_TAGIHAN_MANIFEST_KEYS,
  type IngestResponse,
} from "@solamax/shared";
import type { AgentConfig } from "./config.js";
import type { EasyMaxConnection } from "./db/mysql.js";
import { assertSelectOnly } from "./db/readonly-guard.js";
import { TAGIHAN_DOMAIN, tanggalAtauNull } from "./domains.js";
import { IngestClient, IngestError } from "./ingest-client.js";
import { log } from "./logger.js";
import { StateStore } from "./state/store.js";
import {
  chunkTagihanByInvoice,
  runCycle,
  type SweepJob,
  type SyncDeps,
} from "./sync.js";

// Semua nilai di berkas ini ILUSTRATIF (repo publik): kode faktur, pelanggan,
// nomor bukti dan nominal tidak berasal dari unit mana pun.

const hdr = (kode: string, extra: Record<string, unknown> = {}) => ({
  CKDTAGIH: kode, DTGL: "2026-03-01", DTGLJT: "2026-03-15", CKDPLG: "PLG-A",
  VCKET: "contoh", NTOTAL: "1000000", NADM: "0", NGATOT: "1000000",
  NSTATUS: "0", SBATAL: "0", VCALASAN: null, NLASTSALDO: "1000000",
  SJENISTAG: "1", ...extra,
});
const link = (faktur: string, dok: string) => ({ CKDTAGIH: faktur, CKDJUALPLG: dok });
const byr = (kode: string, faktur: string | null, extra: Record<string, unknown> = {}) => ({
  CKDBYR: kode, DTGL: "2026-03-10", CKDTAGIH: faktur, VCBUKTI: "BKT-1",
  VCKET: null, CTMPKAS: "K1", NTOTAL: "400000", SBATAL: "0", VCALASAN: null,
  CAPPROVECODE: null, CNAMEREQ: null, ...extra,
});

interface Sumber {
  header?: unknown[] | Error;
  detail?: unknown[] | Error;
  bayar?: unknown[] | Error;
  /** Baris sales agar ada domain LAIN yang terkirim (uji isolasi). */
  sales?: boolean;
}

function fakeConn(src: Sumber): { conn: EasyMaxConnection; queries: string[] } {
  const queries: string[] = [];
  let salesServed = false;
  const serve = (v: unknown[] | Error | undefined): unknown[] => {
    if (v instanceof Error) throw v;
    return v ?? [];
  };
  const conn = {
    async roQuery(sql: string) {
      assertSelectOnly(sql); // pintu asli menegakkan ini; fake ikut menegakkan
      queries.push(sql);
      if (sql.includes("FROM tr_htagihan")) return serve(src.header);
      if (sql.includes("FROM tr_dtagihan")) return serve(src.detail);
      if (sql.includes("FROM tr_byrtagih")) return serve(src.bayar);
      if (src.sales && sql.includes("tr_djualbbm") && !salesServed) {
        salesServed = true;
        return [{
          CKDJUALBBM: "H1", CKDNOZZLE: "N1", NURUT: 1, NVOLUME: "50",
          NHARGAJUAL: "10000", NSUBTOTAL: "500000", CKDBBM: "P1", CKDTANGKI: "T1",
          NSTANDAWAL: "100", NSTANDAKHIR: "150", VCOPEATOR: "-",
          DTGLJAM: "2026-06-11 14:30:00", SUBAH: "0", SEDIT: "0",
          DTGLJUAL: "2026-06-11 00:00:00", NSHIFT: "2", VCKET: null,
        }];
      }
      if (sql.includes("vw_edc3")) {
        return [{
          TanggalJam: "2026-06-20 08:00:00", ctgl: "20260620", cshift: "1",
          CKDKARTU: "QR1", TotalHarga: "1000", Liter: "0", Jenis: "5",
          CNOTRACE: "T1", NoNozle: "3", JrnKey: "1",
        }];
      }
      return [];
    },
  } as unknown as EasyMaxConnection;
  return { conn, queries };
}

/**
 * `gagal(payload)` → lempar galat itu untuk payload tsb.; selain itu terima.
 * Seperti backend, balasan payload domain tagihan membawa `tagihan_token` yang
 * BERBEDA tiap payload (`tok-<n>`); `tanpaToken` meniru backend yang belum
 * mengenalnya. `tokens[i]` = token balasan untuk `sent[i]`.
 */
function fakeClient(
  gagal?: (p: IngestPayload) => IngestError | null,
  opts: { tanpaToken?: boolean } = {},
): { client: IngestClient; sent: IngestPayload[]; attempts: IngestPayload[]; tokens: Array<string | undefined> } {
  const sent: IngestPayload[] = [];
  const attempts: IngestPayload[] = [];
  const tokens: Array<string | undefined> = [];
  const client = {
    async sendWithRetry(payload: IngestPayload): Promise<IngestResponse> {
      attempts.push(payload);
      const err = gagal?.(payload) ?? null;
      if (err) throw err;
      sent.push(payload);
      const token = payload.domain === "tagihan" && !opts.tanpaToken
        ? `tok-${sent.length}` : undefined;
      tokens.push(token);
      return { upserted: {}, new_watermark: payload.watermark_high,
        ...(token ? { tagihan_token: token } : {}) };
    },
  } as unknown as IngestClient;
  return { client, sent, attempts, tokens };
}

const CFG = {
  unitCode: "0000001",
  timezone: "Asia/Pontianak",
  sync: {
    pollIntervalMs: 1, masterIntervalMs: 1, safetyWindowMin: 60,
    terraResmiReplaceDays: 7, terraResmiAutoSweepEnabled: false,
    terraResmiDeepRescanDays: 30, terraResmiDeepRescanIntervalMs: 86_400_000,
    cashRescanDays: 7, batchSize: 1000,
    salesRescanDays: 7, salesResyncChunkDays: 3, salesRescanIntervalMs: 0,
  },
} as unknown as AgentConfig;
const cfgBatch = (batchSize: number): AgentConfig =>
  ({ ...CFG, sync: { ...CFG.sync, batchSize } }) as AgentConfig;

const MASTERS = { includeMasters: true, includePelanggan: false, includeSalesRescan: false };
const tagihan = (ps: IngestPayload[]) => ps.filter((p) => p.domain === "tagihan");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "solamax-tagihan-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TAGIHAN_DOMAIN — SQL", () => {
  const sqls = [
    TAGIHAN_DOMAIN.headerSql,
    TAGIHAN_DOMAIN.detailSql,
    TAGIHAN_DOMAIN.bayarSql,
  ];

  it("ketiga kueri lolos guard read-only dan hanya SELECT", () => {
    for (const sql of sqls) {
      expect(() => assertSelectOnly(sql)).not.toThrow();
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql.match(/\bSELECT\b/gi)).toHaveLength(1); // tanpa subquery
    }
  });

  it("kolom disebut eksplisit — tanpa SELECT *, tanpa WHERE/JOIN (snapshot penuh)", () => {
    for (const sql of sqls) {
      expect(sql).not.toContain("*");
      expect(sql).not.toMatch(/\b(WHERE|JOIN|LIMIT)\b/i);
    }
    const cols = (sql: string) =>
      sql.slice(sql.toUpperCase().indexOf("SELECT") + 6, sql.toUpperCase().indexOf("FROM"))
        .split(",").map((c) => c.trim());
    expect(cols(TAGIHAN_DOMAIN.headerSql)).toEqual([
      "CKDTAGIH", "DTGL", "DTGLJT", "CKDPLG", "VCKET", "NTOTAL", "NADM", "NGATOT",
      "NSTATUS", "SBATAL", "VCALASAN", "NLASTSALDO", "SJENISTAG",
    ]);
    expect(cols(TAGIHAN_DOMAIN.detailSql)).toEqual(["CKDTAGIH", "CKDJUALPLG"]);
    expect(cols(TAGIHAN_DOMAIN.bayarSql)).toEqual([
      "CKDBYR", "DTGL", "CKDTAGIH", "VCBUKTI", "VCKET", "CTMPKAS", "NTOTAL", "SBATAL",
      "VCALASAN", "CAPPROVECODE", "CNAMEREQ",
    ]);
    expect(TAGIHAN_DOMAIN.headerSql).toContain("FROM tr_htagihan");
    expect(TAGIHAN_DOMAIN.detailSql).toContain("FROM tr_dtagihan");
    expect(TAGIHAN_DOMAIN.bayarSql).toContain("FROM tr_byrtagih");
  });

  it("jalan di MySQL 5.0.67 — tanpa CTE & window function", () => {
    for (const sql of sqls) {
      expect(sql).not.toMatch(/\bWITH\b/i);
      expect(sql).not.toMatch(/\bOVER\s*\(/i);
    }
  });
});

describe("TAGIHAN_DOMAIN — map", () => {
  it("tanggalAtauNull: tanggal nol / separuh-nol / mustahil → null", () => {
    expect(tanggalAtauNull("0000-00-00")).toBeNull();
    expect(tanggalAtauNull("0000-00-00 00:00:00")).toBeNull();
    expect(tanggalAtauNull("2026-00-00")).toBeNull();
    expect(tanggalAtauNull("2026-02-30")).toBeNull();
    expect(tanggalAtauNull(null)).toBeNull();
    expect(tanggalAtauNull("")).toBeNull();
    expect(tanggalAtauNull("bukan tanggal")).toBeNull();
    expect(tanggalAtauNull("2026-03-15")).toBe("2026-03-15");
    expect(tanggalAtauNull("2026-03-15 00:00:00")).toBe("2026-03-15");
    expect(tanggalAtauNull("2024-02-29")).toBe("2024-02-29");
  });

  it("header: tanggal nol → null, kolom dicerminkan apa adanya (termasuk batal)", () => {
    const rows = TAGIHAN_DOMAIN.mapHeader([
      hdr("TG-001  ", {
        DTGLJT: "0000-00-00", SBATAL: "1", VCALASAN: "salah input",
        NSTATUS: "1", NLASTSALDO: "-50000",
      }),
      hdr("TG-002", { DTGL: "0000-00-00", DTGLJT: null }),
    ]);
    expect(rows[0]).toEqual({
      ckdtagih: "TG-001", dtgl: "2026-03-01", dtgljt: null, ckdplg: "PLG-A",
      vcket: "contoh", ntotal: 1_000_000, nadm: 0, ngatot: 1_000_000, nstatus: 1,
      sbatal: 1, vcalasan: "salah input", nlastsaldo: -50_000, sjenistag: 1,
    });
    expect(rows[1]).toMatchObject({ ckdtagih: "TG-002", dtgl: null, dtgljt: null });
  });

  it("header/pembayaran: kunci kosong atau kembar → lempar (hasil tak layak jadi manifest)", () => {
    expect(() => TAGIHAN_DOMAIN.mapHeader([hdr("  ")])).toThrow(/CKDTAGIH kosong/);
    expect(() => TAGIHAN_DOMAIN.mapHeader([hdr("TG-001"), hdr("TG-001 ")])).toThrow(/kembar/);
    expect(() => TAGIHAN_DOMAIN.mapBayar([byr("", "TG-001")])).toThrow(/CKDBYR kosong/);
    expect(() => TAGIHAN_DOMAIN.mapBayar([byr("BY-1", "TG-001"), byr("BY-1", "TG-002")]))
      .toThrow(/kembar/);
  });

  it("tautan: pasangan kembar dilebur, baris tanpa kunci dihitung — bukan senyap", () => {
    const out = TAGIHAN_DOMAIN.mapDetail([
      link("TG-001", "JP-1"), link("TG-001 ", "JP-1"), link("TG-001", "JP-2"),
      link("TG-001", null as unknown as string), link(null as unknown as string, "JP-9"),
    ]);
    expect(out.rows).toEqual([
      { ckdtagih: "TG-001", ckdjualplg: "JP-1" },
      { ckdtagih: "TG-001", ckdjualplg: "JP-2" },
    ]);
    expect(out.kembar).toBe(1);
    expect(out.tanpaKunci).toBe(2);
  });

  it("pembayaran: tanggal nol → null; baris batal & faktur kosong ikut dicerminkan", () => {
    const rows = TAGIHAN_DOMAIN.mapBayar([
      byr("BY-1", "TG-001 ", { DTGL: "0000-00-00", SBATAL: "1", VCALASAN: "dobel" }),
      byr("BY-2", null),
    ]);
    expect(rows[0]).toEqual({
      ckdbyr: "BY-1", dtgl: null, ckdtagih: "TG-001", vcbukti: "BKT-1", vcket: null,
      ctmpkas: "K1", ntotal: 400_000, sbatal: 1, vcalasan: "dobel",
      capprovecode: null, cnamereq: null,
    });
    expect(rows[1]).toMatchObject({ ckdbyr: "BY-2", ckdtagih: null });
  });
});

describe("chunkTagihanByInvoice (faktur tak pernah dipecah)", () => {
  const H = (k: string) => TAGIHAN_DOMAIN.mapHeader([hdr(k)])[0]!;
  const D = (f: string, n: number, awal = 0) =>
    Array.from({ length: n }, (_, i) => ({ ckdtagih: f, ckdjualplg: `JP-${f}-${awal + i}` }));
  const B = (k: string, f: string | null) => TAGIHAN_DOMAIN.mapBayar([byr(k, f)])[0]!;

  it("faktur dengan tautan > batchSize tetap SATU payload, bersama seluruh pembayarannya", () => {
    const plan = chunkTagihanByInvoice(
      [H("TG-001"), H("TG-002"), H("TG-003")],
      [...D("TG-001", 1), ...D("TG-002", 7), ...D("TG-003", 1)],
      [B("BY-1", "TG-002"), B("BY-2", "TG-002"), B("BY-3", "TG-003")],
      3,
    );
    const besar = plan.chunks.filter((c) =>
      c.tagihan_header?.some((h) => h.ckdtagih === "TG-002"));
    expect(besar).toHaveLength(1);
    expect(besar[0]!.tagihan_detail!.filter((l) => l.ckdtagih === "TG-002")).toHaveLength(7);
    expect(besar[0]!.tagihan_bayar!.map((b) => b.ckdbyr)).toEqual(["BY-1", "BY-2"]);
    // Tiap tautan & pembayaran sepayload dengan header fakturnya — di semua potongan.
    for (const c of plan.chunks) {
      const kode = new Set(c.tagihan_header!.map((h) => h.ckdtagih));
      expect(c.tagihan_detail!.every((l) => kode.has(l.ckdtagih))).toBe(true);
      expect(c.tagihan_bayar!.every((b) => kode.has(b.ckdtagih!))).toBe(true);
    }
    // Tak ada yang hilang atau terduplikasi.
    expect(plan.chunks.flatMap((c) => c.tagihan_header!).map((h) => h.ckdtagih))
      .toEqual(["TG-001", "TG-002", "TG-003"]);
    expect(plan.chunks.flatMap((c) => c.tagihan_detail!)).toHaveLength(9);
    expect(plan.chunks.flatMap((c) => c.tagihan_bayar!)).toHaveLength(3);
  });

  it("header dipotong per batchSize bila tautannya sedikit", () => {
    const plan = chunkTagihanByInvoice(
      [H("TG-001"), H("TG-002"), H("TG-003"), H("TG-004"), H("TG-005")], [], [], 2,
    );
    expect(plan.chunks.map((c) => c.tagihan_header!.length)).toEqual([2, 2, 1]);
  });

  it("GUARD: satu faktur > cap payload → error keras sebelum ada yang dikirim", () => {
    expect(() =>
      chunkTagihanByInvoice([H("TG-001")], D("TG-001", MAX_ROWS_PER_TABLE + 1), [], 1000),
    ).toThrow(/tak boleh dipecah/);
  });

  it("yatim: tautan tak dikirim (dihitung); pembayaran dikirim di potongan tersendiri", () => {
    const plan = chunkTagihanByInvoice(
      [H("TG-001")],
      [...D("TG-001", 1), ...D("TG-HILANG", 2), ...D("TG-LENYAP", 1)],
      [B("BY-1", "TG-001"), B("BY-2", "TG-HILANG"), B("BY-3", null)],
      1000,
    );
    expect(plan.tautanYatim).toEqual({ baris: 3, faktur: 2 });
    expect(plan.bayarYatim).toBe(2);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0]!.tagihan_detail).toEqual(D("TG-001", 1));
    expect(plan.chunks[1]).toEqual({ tagihan_bayar: [B("BY-2", "TG-HILANG"), B("BY-3", null)] });
  });
});

describe("runCycle — domain tagihan", () => {
  const deps = (
    conn: EasyMaxConnection, client: IngestClient, cfg: AgentConfig = CFG, dryRun = false,
  ): SyncDeps => ({ conn, client, store: new StateStore(dir), cfg, dryRun });

  it("potongan dulu, manifest PALING AKHIR; daftar kunci = kunci yang dibaca", async () => {
    const { conn } = fakeConn({
      header: [hdr("TG-001"), hdr("TG-002", { SBATAL: "1" }), hdr("TG-003")],
      detail: [
        link("TG-001", "JP-1"), link("TG-002", "JP-2"), link("TG-002", "JP-3"),
        link("TG-002", "JP-4"), link("TG-003", "JP-5"),
      ],
      bayar: [byr("BY-1", "TG-001"), byr("BY-2", "TG-003", { SBATAL: "1" })],
    });
    const { client, sent, tokens } = fakeClient();
    await runCycle(deps(conn, client, cfgBatch(2)), MASTERS);

    const t = tagihan(sent);
    for (const p of t) expect(() => IngestPayload.parse(p)).not.toThrow();
    const manifests = t.filter((p) => p.tagihan_manifest);
    expect(manifests).toHaveLength(1);
    expect(t[t.length - 1]).toBe(manifests[0]); // penutup siklus
    expect(manifests[0]!.tables).toEqual({}); // manifest tak membawa baris
    expect(manifests[0]!.watermark_high).toBeNull();
    expect(manifests[0]!.tagihan_manifest!.cycle_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifests[0]!.tagihan_manifest!.header_keys).toEqual(["TG-001", "TG-002", "TG-003"]);
    expect(manifests[0]!.tagihan_manifest!.bayar_keys).toEqual(["BY-1", "BY-2"]);
    // Agent tak pernah meminta penghapusan mirror berisi oleh daftar kosong.
    expect(manifests[0]!.tagihan_manifest).not.toHaveProperty("izinkan_kosong");

    const chunks = t.filter((p) => !p.tagihan_manifest);
    expect(chunks.length).toBeGreaterThan(1); // batchSize 2 → terpotong
    // chunk_token = token balasan potongan TERAKHIR — bukan yang pertama.
    const tokenTerakhir = tokens[sent.indexOf(chunks[chunks.length - 1]!)];
    expect(tokenTerakhir).toMatch(/^tok-/);
    expect(tokenTerakhir).not.toBe(tokens[sent.indexOf(chunks[0]!)]);
    expect(manifests[0]!.tagihan_manifest!.chunk_token).toBe(tokenTerakhir);
    // Yang dikirim = yang dibaca, persis sekali; baris batal ikut.
    expect(chunks.flatMap((p) => p.tables.tagihan_header ?? []).map((h) => h.ckdtagih))
      .toEqual(["TG-001", "TG-002", "TG-003"]);
    expect(chunks.flatMap((p) => p.tables.tagihan_detail ?? [])).toHaveLength(5);
    expect(chunks.flatMap((p) => p.tables.tagihan_bayar ?? []).map((b) => b.ckdbyr).sort())
      .toEqual(["BY-1", "BY-2"]);
    // TG-002 (3 tautan > batchSize 2) utuh di satu payload.
    const p2 = chunks.filter((p) => p.tables.tagihan_header?.some((h) => h.ckdtagih === "TG-002"));
    expect(p2).toHaveLength(1);
    expect(p2[0]!.tables.tagihan_detail!.filter((l) => l.ckdtagih === "TG-002")).toHaveLength(3);
  });

  it("sumber kosong (nol header) TETAP mengirim manifest berdaftar kosong", async () => {
    const { conn } = fakeConn({});
    const { client, sent } = fakeClient();
    await runCycle(deps(conn, client), MASTERS);
    const t = tagihan(sent);
    expect(t).toHaveLength(1);
    expect(t[0]!.tables).toEqual({});
    expect(t[0]!.tagihan_manifest).toMatchObject({ header_keys: [], bayar_keys: [] });
    // Nol potongan → tanpa token; dan agent TIDAK PERNAH menyetel izinkan_kosong —
    // backend-lah yang menolak (409) bila mirror unit masih berisi.
    expect(t[0]!.tagihan_manifest).not.toHaveProperty("chunk_token");
    expect(t[0]!.tagihan_manifest).not.toHaveProperty("izinkan_kosong");
  });

  it("🔴 manifest DITOLAK backend (409) → galat keras bernama sebab, SATU percobaan, tak di-buffer, domain lain utuh", async () => {
    const { conn } = fakeConn({ sales: true }); // sumber tagihan terbaca KOSONG
    const pesan = "ingest 409: tagihan_manifest ditolak: daftar header KOSONG sementara mirror unit ini masih berisi faktur";
    const { client, sent, attempts } = fakeClient((p) =>
      p.tagihan_manifest ? new IngestError(pesan, false, 409) : null);
    const d = deps(conn, client);
    const galat = vi.spyOn(log, "error").mockImplementation(() => {});
    try {
      const jobs: SweepJob[] = [
        { domain: "edc", tier: "tier1", from: "2026-06-20", toExcl: "2026-06-21", chunkDays: 7 },
      ];
      await expect(runCycle(d, { ...MASTERS, sweepJobs: jobs })).resolves.toBeUndefined();

      expect(tagihan(attempts)).toHaveLength(1); // tak ada kirim ulang
      expect(tagihan(sent)).toHaveLength(0);
      expect(d.store.bufferCount()).toBe(0);
      const baris = galat.mock.calls.find(([msg]) => /manifest DITOLAK backend \(409\)/.test(msg));
      expect(baris, "log galat manifest 409").toBeDefined();
      expect(baris![1]).toMatchObject({ status: 409, header: 0, bayar: 0, sebab: pesan });
      // Domain lain: sebelum (sales), cadence master (piutang), sesudah (sapuan edc).
      expect(sent.some((p) => p.domain === "sales")).toBe(true);
      expect(sent.some((p) => p.domain === "piutang")).toBe(true);
      expect(sent.some((p) => p.domain === "edc")).toBe(true);
    } finally {
      galat.mockRestore();
    }
  });

  it("backend tak memulangkan tagihan_token → manifest TIDAK dikirim (tak ada pangkas tanpa penjaga basi)", async () => {
    const { conn } = fakeConn({ header: [hdr("TG-001")] });
    const { client, attempts } = fakeClient(undefined, { tanpaToken: true });
    const galat = vi.spyOn(log, "error").mockImplementation(() => {});
    try {
      await runCycle(deps(conn, client), MASTERS);
      expect(tagihan(attempts)).toHaveLength(1); // potongannya saja
      expect(tagihan(attempts).some((p) => p.tagihan_manifest)).toBe(false);
      expect(galat.mock.calls.some(([, f]) => /tagihan_token/.test(String(f?.["err"])))).toBe(true);
    } finally {
      galat.mockRestore();
    }
  });

  it("🔴 daftar kunci melampaui batas kontrak → siklus gagal SEBELUM ada yang dikirim", async () => {
    const banyak = Array.from({ length: MAX_TAGIHAN_MANIFEST_KEYS + 1 }, (_, i) => hdr(`T${i}`));
    const { conn } = fakeConn({ header: banyak });
    const { client, attempts } = fakeClient();
    const galat = vi.spyOn(log, "error").mockImplementation(() => {});
    try {
      await runCycle(deps(conn, client), MASTERS);
      expect(tagihan(attempts)).toHaveLength(0);
      expect(galat.mock.calls.some(([, f]) =>
        new RegExp(`melampaui batas ${MAX_TAGIHAN_MANIFEST_KEYS} kunci`).test(String(f?.["err"])))).toBe(true);
    } finally {
      galat.mockRestore();
    }
  });

  it("tepat di batas jumlah kunci masih dikirim (kontrol: penjaga batas tidak memblokir yang sah)", async () => {
    const tepat = Array.from({ length: MAX_TAGIHAN_MANIFEST_KEYS }, (_, i) => hdr(`T${i}`));
    const { conn } = fakeConn({ header: tepat });
    const { client, sent } = fakeClient();
    await runCycle(deps(conn, client, cfgBatch(MAX_ROWS_PER_TABLE)), MASTERS);
    const m = tagihan(sent).filter((p) => p.tagihan_manifest);
    expect(m).toHaveLength(1);
    expect(m[0]!.tagihan_manifest!.header_keys).toHaveLength(MAX_TAGIHAN_MANIFEST_KEYS);
  });

  it("manifest melampaui anggaran byte (kunci non-ASCII) → siklus gagal SEBELUM ada yang dikirim", async () => {
    // 100.000 kunci × (27 karakter 3-byte + 5 digit + 3) ≈ 8,9 MB > anggaran
    // 8 MiB, walau jumlah dan panjang kuncinya (32) masih di dalam batas skema.
    const lebar = Array.from({ length: MAX_TAGIHAN_MANIFEST_KEYS }, (_, i) =>
      hdr(String(i).padStart(32, "€")));
    const { conn } = fakeConn({ header: lebar });
    const { client, attempts } = fakeClient();
    const galat = vi.spyOn(log, "error").mockImplementation(() => {});
    try {
      await runCycle(deps(conn, client), MASTERS);
      expect(tagihan(attempts)).toHaveLength(0);
      expect(galat.mock.calls.some(([, f]) => /melampaui anggaran \d+ byte/.test(String(f?.["err"])))).toBe(true);
    } finally {
      galat.mockRestore();
    }
  });

  it.each(["header", "detail", "bayar"] as const)(
    "kueri %s gagal → TAK ADA potongan maupun manifest yang dikirim",
    async (which) => {
      const { conn, queries } = fakeConn({
        header: [hdr("TG-001")], detail: [link("TG-001", "JP-1")],
        bayar: [byr("BY-1", "TG-001")],
        [which]: new Error("MySQL read gagal"),
      });
      const { client, attempts } = fakeClient();
      await expect(runCycle(deps(conn, client), MASTERS)).resolves.toBeUndefined();
      expect(queries.some((q) => q.includes("FROM tr_htagihan"))).toBe(true); // benar dijalankan
      expect(tagihan(attempts)).toHaveLength(0);
    },
  );

  it("potongan DITOLAK (4xx) → sisa potongan & manifest tidak dikirim, tak ada yang di-buffer", async () => {
    const { conn } = fakeConn({
      header: [hdr("TG-001"), hdr("TG-002"), hdr("TG-003")],
      detail: [link("TG-001", "JP-1")],
    });
    let n = 0;
    const { client, sent, attempts } = fakeClient((p) =>
      p.domain === "tagihan" && ++n === 2 ? new IngestError("ingest 422", false, 422) : null);
    const d = deps(conn, client, cfgBatch(1));
    await runCycle(d, MASTERS);
    expect(tagihan(attempts)).toHaveLength(2); // berhenti di potongan ke-2
    expect(tagihan(sent)).toHaveLength(1);
    expect(tagihan(attempts).some((p) => p.tagihan_manifest)).toBe(false);
    expect(d.store.bufferCount()).toBe(0);
  });

  it("backend offline (retriable habis) → tanpa manifest dan TIDAK di-buffer untuk diputar ulang", async () => {
    const { conn } = fakeConn({ header: [hdr("TG-001")], bayar: [byr("BY-1", "TG-001")] });
    const { client, attempts } = fakeClient((p) =>
      p.domain === "tagihan" ? new IngestError("offline", true) : null);
    const d = deps(conn, client);
    await runCycle(d, MASTERS);
    expect(tagihan(attempts)).toHaveLength(1);
    expect(tagihan(attempts)[0]!.tagihan_manifest).toBeUndefined();
    expect(d.store.bufferCount()).toBe(0);
  });

  it("manifest gagal terkirim → tidak di-buffer; siklus berikut mengirim manifest ber-cycle_id BARU", async () => {
    const { conn } = fakeConn({ header: [hdr("TG-001")] });
    let tolak = true;
    const { client, sent } = fakeClient((p) =>
      tolak && p.tagihan_manifest ? new IngestError("offline", true) : null);
    const d = deps(conn, client);
    await runCycle(d, MASTERS);
    expect(tagihan(sent).some((p) => p.tagihan_manifest)).toBe(false);
    expect(d.store.bufferCount()).toBe(0);

    tolak = false;
    await runCycle(d, MASTERS);
    await runCycle(d, MASTERS);
    const ids = tagihan(sent).filter((p) => p.tagihan_manifest)
      .map((p) => p.tagihan_manifest!.cycle_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("yatim: tautan tanpa header tak dikirim; pembayaran tanpa header dikirim & masuk bayar_keys", async () => {
    const { conn } = fakeConn({
      header: [hdr("TG-001")],
      detail: [link("TG-001", "JP-1"), link("TG-HILANG", "JP-2")],
      bayar: [byr("BY-1", "TG-001"), byr("BY-2", "TG-HILANG")],
    });
    const { client, sent } = fakeClient();
    await runCycle(deps(conn, client), MASTERS);
    const t = tagihan(sent);
    for (const p of t) expect(() => IngestPayload.parse(p)).not.toThrow();
    expect(t.flatMap((p) => p.tables.tagihan_detail ?? [])).toEqual([
      { ckdtagih: "TG-001", ckdjualplg: "JP-1" },
    ]);
    expect(t.flatMap((p) => p.tables.tagihan_bayar ?? []).map((b) => b.ckdbyr))
      .toEqual(["BY-1", "BY-2"]);
    const m = t[t.length - 1]!.tagihan_manifest!;
    expect(m.header_keys).toEqual(["TG-001"]);
    expect(m.bayar_keys).toEqual(["BY-1", "BY-2"]);
  });

  it("kegagalan tagihan tak menghentikan domain lain (sales sebelum, sapuan sesudah)", async () => {
    const { conn } = fakeConn({ header: new Error("tabel tidak ada"), sales: true });
    const { client, sent } = fakeClient();
    const jobs: SweepJob[] = [
      { domain: "edc", tier: "tier1", from: "2026-06-20", toExcl: "2026-06-21", chunkDays: 7 },
    ];
    await expect(
      runCycle(deps(conn, client), { ...MASTERS, sweepJobs: jobs }),
    ).resolves.toBeUndefined();
    expect(sent.some((p) => p.domain === "sales")).toBe(true);
    expect(sent.some((p) => p.domain === "hutang")).toBe(true); // cadence master tetap jalan
    expect(sent.some((p) => p.domain === "edc")).toBe(true); // sapuan SESUDAH tagihan
    expect(tagihan(sent)).toHaveLength(0);
  });

  it("backend lama menolak domain baru (400) → domain lain tetap terkirim, tanpa buffer", async () => {
    const { conn } = fakeConn({ header: [hdr("TG-001")], sales: true });
    const { client, sent } = fakeClient((p) =>
      p.domain === "tagihan" ? new IngestError("ingest 400: domain tak dikenal", false, 400) : null);
    const d = deps(conn, client);
    await runCycle(d, MASTERS);
    expect(sent.some((p) => p.domain === "sales")).toBe(true);
    expect(sent.some((p) => p.domain === "piutang")).toBe(true);
    expect(tagihan(sent)).toHaveLength(0);
    expect(d.store.bufferCount()).toBe(0);
  });

  it("hanya jalan pada cadence master (includeMasters)", async () => {
    const { conn, queries } = fakeConn({ header: [hdr("TG-001")] });
    const { client, sent } = fakeClient();
    await runCycle(deps(conn, client), { ...MASTERS, includeMasters: false });
    expect(queries.some((q) => q.includes("tagih"))).toBe(false);
    expect(tagihan(sent)).toHaveLength(0);
  });

  it("dry-run: membaca tapi tidak mengirim apa pun", async () => {
    const { conn, queries } = fakeConn({
      header: [hdr("TG-001")], detail: [link("TG-001", "JP-1")],
    });
    const { client, attempts } = fakeClient();
    await runCycle(deps(conn, client, CFG, true), MASTERS);
    expect(queries.filter((q) => /tr_(htagihan|dtagihan|byrtagih)/.test(q))).toHaveLength(3);
    expect(attempts).toHaveLength(0);
  });

  it("entri tagihan yang terlanjur ada di buffer DIBUANG, tidak diputar ulang", async () => {
    const store = new StateStore(dir);
    store.enqueue({
      unit_code: CFG.unitCode, domain: "tagihan", watermark_high: null,
      tagihan_manifest: {
        cycle_id: "00000000-0000-4000-8000-000000000000",
        header_keys: [], bayar_keys: [],
      },
      tables: {},
    });
    const { conn } = fakeConn({ header: [hdr("TG-001")] });
    const { client, sent } = fakeClient();
    await runCycle({ conn, client, store, cfg: CFG, dryRun: false }, MASTERS);
    expect(store.bufferCount()).toBe(0);
    const manifests = tagihan(sent).filter((p) => p.tagihan_manifest);
    expect(manifests).toHaveLength(1); // hanya milik siklus ini
    expect(manifests[0]!.tagihan_manifest!.header_keys).toEqual(["TG-001"]);
  });
});

// Kebijakan kirim-ulang yang SEBENARNYA (bukan klien tiruan): penolakan penjaga
// manifest (409) fatal — tak boleh memicu badai kirim-ulang.
describe("IngestClient.sendWithRetry — penolakan manifest", () => {
  const cfg = {
    backend: { baseUrl: "http://127.0.0.1:9", apiKey: "kunci-ilustratif", requestTimeoutMs: 1000 },
  } as unknown as AgentConfig;
  const payload: IngestPayload = {
    unit_code: "0000001", domain: "tagihan", watermark_high: null,
    tagihan_manifest: {
      cycle_id: "00000000-0000-4000-8000-000000000000", header_keys: [], bayar_keys: [],
    },
    tables: {},
  };
  afterEach(() => vi.unstubAllGlobals());

  it("409 → SATU permintaan, galat fatal berstatus 409 yang membawa pesan backend", async () => {
    const fetchPalsu = vi.fn(async () => new Response(
      JSON.stringify({ statusCode: 409, message: "tagihan_manifest ditolak: basi" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchPalsu);
    const err = await new IngestClient(cfg)
      .sendWithRetry(payload, { retries: 4, baseDelayMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err).toMatchObject({ retriable: false, status: 409 });
    expect((err as IngestError).message).toContain("tagihan_manifest ditolak: basi");
    expect(fetchPalsu).toHaveBeenCalledTimes(1);
  });

  it("kontrol: 503 memang dikirim ulang sampai habis (retries + 1 permintaan)", async () => {
    const fetchPalsu = vi.fn(async () => new Response("sibuk", { status: 503 }));
    vi.stubGlobal("fetch", fetchPalsu);
    await expect(new IngestClient(cfg).sendWithRetry(payload, { retries: 2, baseDelayMs: 1 }))
      .rejects.toMatchObject({ retriable: true, status: 503 });
    expect(fetchPalsu).toHaveBeenCalledTimes(3);
  });

  it("balasan potongan: tagihan_token diteruskan apa adanya", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      upserted: { tagihan_header: 1 }, new_watermark: null, tagihan_token: "701:20260105T010203.000004",
    }), { status: 200 })));
    const res = await new IngestClient(cfg).send(payload);
    expect(res.tagihan_token).toBe("701:20260105T010203.000004");
  });
});
