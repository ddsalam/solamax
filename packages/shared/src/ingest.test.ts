import { describe, expect, it } from "vitest";
import {
  IngestPayload,
  MAX_TAGIHAN_KEY_LENGTH,
  MAX_TAGIHAN_MANIFEST_BYTES,
  MAX_TAGIHAN_MANIFEST_KEYS,
} from "./ingest.js";

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

  // Regresi: terra_resmi TANPA jalur hapus = orphan abadi. Tiga kejadian produksi
  // (BL 13-08, 28 Oktober 29-08, IB 27-08 2026) sebelum domain ini di-whitelist.
  it("replace_window: sah untuk terra_resmi dengan baris", () => {
    const r = IngestPayload.safeParse({
      ...winBase,
      domain: "terra_resmi",
      tables: {
        terra_resmi: [
          {
            business_date: "2026-01-05",
            ckdterra: "NT202600055",
            ckdnozzle: "NZ-17",
            nshift: 3,
            ckdtangki: "T-03",
            ckdbbm: "BB-02",
            nvolume: 4,
            nharga: 16300,
            ntotal: 65200,
            dtgljam: "2026-01-05T16:21:14.000Z",
            ckdjualbbm: "JB202600717",
            sbatal: 0,
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("replace_window: terra_resmi DELETE-only (jendela kosong di sumber)", () => {
    const r = IngestPayload.safeParse({ ...winBase, domain: "terra_resmi", tables: {} });
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

  it("replace_details: sah untuk sales, DITOLAK untuk domain lain", () => {
    const sales = {
      unit_code: "6478201",
      domain: "sales",
      watermark_high: null,
      replace_details: true,
      tables: {
        sales_header: [{ ckdjualbbm: "H1", dtgljual: "2026-09-23", nshift: 3, vcket: null }],
      },
    };
    expect(IngestPayload.safeParse(sales).success).toBe(true);
    expect(IngestPayload.safeParse({ ...winBase, domain: "delivery", replace_details: true, tables: {} }).success).toBe(false);
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

  // ── tagihan (snapshot penuh + manifest penutup siklus) ── nilai ilustratif.
  const tagihanBase = { unit_code: "0000001", domain: "tagihan", watermark_high: null } as const;
  const fakturContoh = {
    ckdtagih: "TG-CONTOH-0001", dtgl: "2026-01-05", dtgljt: null, ckdplg: "PLG-A",
    vcket: null, ntotal: 10000000, nadm: 0, ngatot: 10000000, nstatus: 0, sbatal: 0,
    vcalasan: null, nlastsaldo: 6000000, sjenistag: 1,
  };
  const bayarContoh = {
    ckdbyr: "BY-CONTOH-0001", dtgl: "2026-01-20", ckdtagih: "TG-CONTOH-0001",
    vcbukti: null, vcket: null, ctmpkas: null, ntotal: 4000000, sbatal: 0,
    vcalasan: null, capprovecode: null, cnamereq: null,
  };
  const manifestContoh = {
    cycle_id: "8d15c6cf-3e80-4db8-8104-8ea8b556be96",
    header_keys: ["TG-CONTOH-0001"],
    bayar_keys: ["BY-CONTOH-0001"],
    chunk_token: "701:20260105T010203.000004",
  };

  it("tagihan: payload dengan ketiga tabel valid", () => {
    const r = IngestPayload.safeParse({
      ...tagihanBase,
      tables: {
        tagihan_header: [fakturContoh],
        tagihan_detail: [
          { ckdtagih: "TG-CONTOH-0001", ckdjualplg: "JP-CONTOH-0001" },
          { ckdtagih: "TG-CONTOH-0001", ckdjualplg: "JP-CONTOH-0002" },
        ],
        tagihan_bayar: [bayarContoh],
      },
    });
    expect(r.success).toBe(true);
  });

  it("tagihan: tanggal nol EasyMax (null) diterima di dtgl maupun dtgljt", () => {
    const r = IngestPayload.safeParse({
      ...tagihanBase,
      tables: {
        tagihan_header: [{ ...fakturContoh, dtgl: null, dtgljt: null }],
        tagihan_bayar: [{ ...bayarContoh, dtgl: null }],
      },
    });
    expect(r.success).toBe(true);
  });

  it("tagihan_manifest: sah TANPA baris — juga dengan daftar kunci kosong", () => {
    expect(IngestPayload.safeParse({
      ...tagihanBase, tagihan_manifest: manifestContoh, tables: {},
    }).success).toBe(true);
    // Tabel sumber memang kosong → manifest kosong tetap penutup siklus yang sah.
    expect(IngestPayload.safeParse({
      ...tagihanBase,
      tagihan_manifest: { cycle_id: manifestContoh.cycle_id, header_keys: [], bayar_keys: [] },
      tables: {},
    }).success).toBe(true);
  });

  it("tagihan_manifest: berisi kunci WAJIB membawa chunk_token; manifest kosong tidak", () => {
    const { chunk_token: _buang, ...tanpaToken } = manifestContoh;
    const r = IngestPayload.safeParse({ ...tagihanBase, tagihan_manifest: tanpaToken, tables: {} });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("chunk_token");
    // Satu daftar saja yang berisi pun sudah didahului potongan → wajib bertoken.
    expect(IngestPayload.safeParse({
      ...tagihanBase, tables: {},
      tagihan_manifest: { ...tanpaToken, header_keys: [] },
    }).success).toBe(false);
    expect(IngestPayload.safeParse({
      ...tagihanBase, tables: {},
      tagihan_manifest: { ...tanpaToken, header_keys: [], bayar_keys: [] },
    }).success).toBe(true);
  });

  it("tagihan_manifest.izinkan_kosong: opsional, hanya literal true", () => {
    const kosong = { cycle_id: manifestContoh.cycle_id, header_keys: [], bayar_keys: [] };
    const ok = IngestPayload.safeParse({
      ...tagihanBase, tagihan_manifest: { ...kosong, izinkan_kosong: true }, tables: {},
    });
    expect(ok.success && ok.data.tagihan_manifest?.izinkan_kosong).toBe(true);
    const tanpa = IngestPayload.safeParse({ ...tagihanBase, tagihan_manifest: kosong, tables: {} });
    expect(tanpa.success && tanpa.data.tagihan_manifest?.izinkan_kosong).toBeUndefined();
    for (const nilai of [false, "true", 1]) {
      expect(IngestPayload.safeParse({
        ...tagihanBase, tagihan_manifest: { ...kosong, izinkan_kosong: nilai }, tables: {},
      }).success).toBe(false);
    }
  });

  it("tagihan_manifest: daftar kunci berbatas — tepat di batas sah, satu di atasnya ditolak dengan pesan jelas", () => {
    const kunci = (n: number) => Array.from({ length: n }, (_, i) => `K${i}`);
    const dengan = (m: Record<string, unknown>) => IngestPayload.safeParse({
      ...tagihanBase, tagihan_manifest: { ...manifestContoh, ...m }, tables: {},
    });
    expect(dengan({
      header_keys: kunci(MAX_TAGIHAN_MANIFEST_KEYS), bayar_keys: kunci(MAX_TAGIHAN_MANIFEST_KEYS),
    }).success).toBe(true);
    for (const daftar of ["header_keys", "bayar_keys"]) {
      const r = dengan({ [daftar]: kunci(MAX_TAGIHAN_MANIFEST_KEYS + 1) });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toContain(`${daftar}: melampaui ${MAX_TAGIHAN_MANIFEST_KEYS} kunci`);
    }
    // Panjang satu kunci juga berbatas — tanpa itu batas jumlah tak mengikat byte.
    expect(dengan({ header_keys: ["K".repeat(MAX_TAGIHAN_KEY_LENGTH)] }).success).toBe(true);
    expect(dengan({ header_keys: ["K".repeat(MAX_TAGIHAN_KEY_LENGTH + 1)] }).success).toBe(false);
  });

  it("batas manifest muat di bawah batas body backend 10 MB, dengan margin", () => {
    // Kunci ASCII terpanjang yang sah, kedua daftar penuh — kasus terburuk skema.
    const penuh = Array.from({ length: MAX_TAGIHAN_MANIFEST_KEYS }, (_, i) =>
      String(i).padStart(MAX_TAGIHAN_KEY_LENGTH, "K"));
    const byte = Buffer.byteLength(JSON.stringify({
      ...tagihanBase, tables: {},
      tagihan_manifest: { ...manifestContoh, header_keys: penuh, bayar_keys: penuh },
    }));
    expect(byte).toBeLessThanOrEqual(MAX_TAGIHAN_MANIFEST_BYTES);
    expect(MAX_TAGIHAN_MANIFEST_BYTES).toBeLessThan(10 * 1024 * 1024);
  });

  // 🔴 Tabel tagihan di domain lain menghapus tautan faktur TANPA kunci per-unit.
  it.each(["piutang", "masters", "sales"] as const)(
    "tabel tagihan di domain %s ditolak (ketiga tabel)",
    (domain) => {
      const tabel = {
        tagihan_header: [fakturContoh],
        tagihan_detail: [{ ckdtagih: "TG-CONTOH-0001", ckdjualplg: "JP-CONTOH-0001" }],
        tagihan_bayar: [bayarContoh],
      };
      for (const [nama, rows] of Object.entries(tabel)) {
        const r = IngestPayload.safeParse({
          unit_code: "0000001", domain, watermark_high: null,
          // tautan butuh header sepayload; sertakan agar yang ditolak memang domainnya
          tables: nama === "tagihan_detail" ? { tagihan_header: tabel.tagihan_header, [nama]: rows } : { [nama]: rows },
        });
        expect(r.success, nama).toBe(false);
        expect(JSON.stringify(r.error?.issues), nama).toContain(`tabel ${nama} hanya untuk domain tagihan`);
      }
    },
  );

  it("domain tagihan hanya membawa tabelnya sendiri; domain lain tak diperketat", () => {
    const asing = IngestPayload.safeParse({
      ...tagihanBase,
      tables: { tagihan_header: [fakturContoh], product: [{ ckdbbm: "P1", vcnmbbm: "contoh", nhrgjual: 10000, perk_map: null }] },
    });
    expect(asing.success).toBe(false);
    expect(JSON.stringify(asing.error?.issues)).toContain("domain tagihan hanya membawa tabel");
    // Kunci tabel tagihan yang KOSONG di domain lain bukan pelanggaran.
    expect(IngestPayload.safeParse({
      unit_code: "0000001", domain: "sales", watermark_high: "2026-06-11T07:30:00.000Z",
      tables: {
        sales_header: [{ ckdjualbbm: "H1", dtgljual: "2026-06-11", nshift: 2, vcket: null }],
        tagihan_header: [],
      },
    }).success).toBe(true);
  });

  it("tagihan: payload kosong TANPA manifest tetap ditolak", () => {
    expect(IngestPayload.safeParse({ ...tagihanBase, tables: {} }).success).toBe(false);
    expect(IngestPayload.safeParse({
      ...tagihanBase, tables: { tagihan_header: [], tagihan_detail: [], tagihan_bayar: [] },
    }).success).toBe(false);
  });

  it.each([
    {
      name: "domain lain",
      payload: { domain: "piutang", tagihan_manifest: manifestContoh, tables: {} },
    },
    {
      name: "manifest yang membawa baris",
      payload: { tagihan_manifest: manifestContoh, tables: { tagihan_header: [fakturContoh] } },
    },
    {
      name: "cycle_id bukan UUID",
      payload: { tagihan_manifest: { ...manifestContoh, cycle_id: "bukan-uuid" }, tables: {} },
    },
    {
      name: "daftar kunci tidak hadir",
      payload: { tagihan_manifest: { cycle_id: manifestContoh.cycle_id, header_keys: [] }, tables: {} },
    },
    {
      name: "kunci kosong",
      payload: { tagihan_manifest: { ...manifestContoh, bayar_keys: [""] }, tables: {} },
    },
  ])("tagihan_manifest: menolak $name", ({ payload }) => {
    expect(IngestPayload.safeParse({ ...tagihanBase, ...payload }).success).toBe(false);
  });

  it("tagihan_detail tanpa header fakturnya di payload yang sama ditolak", () => {
    // Backend mengganti tautan PER FAKTUR; tautan yang berjalan sendirian
    // berarti potongan dipecah per baris, bukan per faktur.
    const yatim = IngestPayload.safeParse({
      ...tagihanBase,
      tables: { tagihan_detail: [{ ckdtagih: "TG-CONTOH-0001", ckdjualplg: "JP-CONTOH-0001" }] },
    });
    expect(yatim.success).toBe(false);
    const fakturLain = IngestPayload.safeParse({
      ...tagihanBase,
      tables: {
        tagihan_header: [fakturContoh],
        tagihan_detail: [{ ckdtagih: "TG-CONTOH-0002", ckdjualplg: "JP-CONTOH-0001" }],
      },
    });
    expect(fakturLain.success).toBe(false);
    // Spasi pengisi CHAR(n) di ujung kunci bukan perbedaan.
    const berpengisi = IngestPayload.safeParse({
      ...tagihanBase,
      tables: {
        tagihan_header: [fakturContoh],
        tagihan_detail: [{ ckdtagih: "TG-CONTOH-0001 ", ckdjualplg: "JP-CONTOH-0001" }],
      },
    });
    expect(berpengisi.success).toBe(true);
  });
});
