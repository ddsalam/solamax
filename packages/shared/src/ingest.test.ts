import { describe, expect, it } from "vitest";
import { IngestPayload } from "./ingest.js";

describe("IngestPayload", () => {
  it("menerima payload sales header+detail yang valid", () => {
    const r = IngestPayload.safeParse({
      unit_code: "6478111",
      domain: "sales",
      watermark_high: "2026-06-11T07:30:00Z",
      tables: {
        sales_header: [
          { ckdjualbbm: "A1", dtgljual: "2026-06-11", nshift: 2, vcket: null },
        ],
        sales_detail: [
          {
            ckdjualbbm: "A1",
            ckdnozzle: "N1",
            nurut: 1,
            nstandawal: 100,
            nstandakhir: 150,
            nvolume: 50,
            nhargajual: 10000,
            nsubtotal: 500000,
            ckdbbm: "P1",
            ckdtangki: "T1",
            vcopeator: null,
            dtgljam: "2026-06-11T07:30:00Z",
            subah: 0,
            sedit: 0,
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("menolak payload tanpa baris sama sekali", () => {
    const r = IngestPayload.safeParse({
      unit_code: "6478111",
      domain: "opname",
      watermark_high: null,
      tables: {},
    });
    expect(r.success).toBe(false);
  });

  it("menolak dtgljam yang bukan ISO UTC", () => {
    const r = IngestPayload.safeParse({
      unit_code: "6478111",
      domain: "delivery",
      watermark_high: "2026-06-11T07:30:00Z",
      tables: {
        delivery: [
          {
            ckdtrm: "D1",
            dtgltrm: "2026-06-11",
            dtgljam: "2026-06-11 07:30:00", // bukan ISO
            cnodo: null,
            nvoldo: null,
            nvolreal: null,
            nvolselisih: null,
            cnopol: null,
            vcsopir: null,
            ckdtangki: null,
            ckdbbm: null,
            sbatal: 0,
          },
        ],
      },
    });
    expect(r.success).toBe(false);
  });

  // ── replace_window (sapuan delete-capable tebus/delivery) ──
  const winBase = {
    unit_code: "6378301",
    watermark_high: null,
    replace_window: { from: "2026-01-01", to: "2026-02-01" },
  };

  it("replace_window: sah untuk delivery, termasuk payload TANPA baris (DELETE-only)", () => {
    const r = IngestPayload.safeParse({ ...winBase, domain: "delivery", tables: {} });
    expect(r.success).toBe(true);
  });

  it("replace_window: sah untuk tebus dengan baris", () => {
    const r = IngestPayload.safeParse({
      ...winBase,
      domain: "tebus",
      tables: {
        tebus_header: [
          { ckdtbs: "TB1", dtgltbs: "2026-01-05", cnoso: "4060000001", sbatal: 0 },
        ],
        tebus_detail: [{ ckdtbs: "TB1", ckdbbm: "BB-03", nvolume: 8000 }],
      },
    });
    expect(r.success).toBe(true);
  });

  it("replace_window: DITOLAK untuk domain di luar whitelist (sales)", () => {
    const r = IngestPayload.safeParse({ ...winBase, domain: "sales", tables: {} });
    expect(r.success).toBe(false);
  });

  it("replace_window: from >= to ditolak", () => {
    const r = IngestPayload.safeParse({
      ...winBase,
      domain: "delivery",
      replace_window: { from: "2026-02-01", to: "2026-02-01" },
      tables: {},
    });
    expect(r.success).toBe(false);
  });

  it("tanpa replace_window: payload kosong tetap ditolak", () => {
    const r = IngestPayload.safeParse({
      unit_code: "6378301",
      domain: "delivery",
      watermark_high: null,
      tables: {},
    });
    expect(r.success).toBe(false);
  });

  // ── source_cut (snapshot lengkap saldo pelanggan) ──
  const sourceCutBase = {
    cycle_id: "8d15c6cf-3e80-4db8-8104-8ea8b556be96",
    domain: "bppiut",
    chunk_index: 0,
    chunk_count: 1,
    row_count: 0,
  } as const;

  it("source_cut: menerima marker full-sync kosong bila tabel sumber eksplisit", () => {
    const r = IngestPayload.safeParse({
      unit_code: "6378301",
      domain: "piutang",
      watermark_high: null,
      source_cut: sourceCutBase,
      tables: { bppiut: [] },
    });
    expect(r.success).toBe(true);
  });

  it.each([
    {
      name: "UUID siklus tidak sah",
      payload: { source_cut: { ...sourceCutBase, cycle_id: "bukan-uuid" }, tables: { bppiut: [] } },
    },
    {
      name: "chunk_index sama dengan chunk_count",
      payload: { source_cut: { ...sourceCutBase, chunk_index: 1 }, tables: { bppiut: [] } },
    },
    {
      name: "domain ingest tidak cocok",
      payload: { domain: "hutang", source_cut: sourceCutBase, tables: { bppiut: [] } },
    },
    {
      name: "tabel sumber tidak hadir",
      payload: { source_cut: sourceCutBase, tables: {} },
    },
  ])("source_cut: menolak $name", ({ payload }) => {
    const r = IngestPayload.safeParse({
      unit_code: "6378301",
      domain: "piutang",
      watermark_high: null,
      ...payload,
    });
    expect(r.success).toBe(false);
  });

  it("source_cut pelanggan_master: hanya sah pada masters dengan key tabel pelanggan", () => {
    const sourceCut = { ...sourceCutBase, domain: "pelanggan_master" };
    expect(
      IngestPayload.safeParse({
        unit_code: "6378301",
        domain: "masters",
        watermark_high: null,
        source_cut: sourceCut,
        tables: { pelanggan_master: [] },
      }).success,
    ).toBe(true);
    expect(
      IngestPayload.safeParse({
        unit_code: "6378301",
        domain: "masters",
        watermark_high: null,
        source_cut: sourceCut,
        tables: { product: [] },
      }).success,
    ).toBe(false);
  });
});
