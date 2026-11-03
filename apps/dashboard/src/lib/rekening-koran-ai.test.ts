import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KlienAnthropic } from "./rekening-koran-ai";

/**
 * Pembaca AI rekening koran (rencana 2026-11-02 U10; R29, R30, AE8, KTD9).
 *
 *   · pembaca (`bacaRekeningKoranAi`) dengan klien Anthropic TIRUAN — tanpa
 *     jaringan; bacaan dari model dikarang di sini;
 *   · gerbang murni (`periksaBacaan`): empat angka kontrol, saldo berjalan,
 *     urutan tanggal, jangkar saldo awal;
 *   · server action dengan DB TIRUAN (pola `impor-bank-actions.test.ts`): klien
 *     tiruan mencatat setiap pernyataan, jadi "tidak ada yang tersimpan"
 *     dibuktikan sebagai "tak ada INSERT ke rekening_koran / mutasi_bank".
 *
 * Semua nominal & nomor rekening KARANGAN (repo publik).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string, params: unknown[]) => Jawab } = { jawab: () => undefined };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      const r = state.jawab(sql, params);
      return { rows: r?.rows ?? [], rowCount: r?.rowCount ?? r?.rows.length ?? 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const BK = { unit_id: 2, code: "6378301", name: "Bakau" };
  const sesi = { role: "keuangan", email: "staf@solagroup.co" as string | null, units: [BK] };
  const ai: { klien: unknown } = { klien: null };
  return { log, state, connect, BK, sesi, ai };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: h.sesi.role,
    email: h.sesi.email,
    units: h.sesi.units,
    requireUnit(code: string) {
      const u = h.sesi.units.find((x) => x.code === code);
      if (!u) throw new Error("NEXT_NOT_FOUND");
      return u;
    },
  })),
}));
vi.mock("./rekening-koran-ai", async (asli) => {
  const m = await asli<typeof import("./rekening-koran-ai")>();
  // Klien disuntikkan: aksi memintanya lewat `buatKlien`, uji menjawab tiruan.
  return { ...m, buatKlien: vi.fn(() => h.ai.klien) };
});

const ai = await import("./rekening-koran-ai");
const model = await import("./impor-bank-model");
const aksi = await import("./impor-bank-actions");

// ---------------------------------------------------------------------------
// Klien Anthropic tiruan
// ---------------------------------------------------------------------------

type Bacaan = {
  terbaca: boolean;
  nomorRekening: string | null;
  saldoAwal: string;
  baris: { tanggal: string; keterangan: string; arah: "debet" | "kredit"; nominal: string; saldo: string | null }[];
};

const panggilan: Anthropic.MessageCreateParamsNonStreaming[] = [];
let jawabAi: () => Promise<Anthropic.Message>;
const klienPalsu: KlienAnthropic = {
  messages: {
    create: async (p) => {
      panggilan.push(p);
      return jawabAi();
    },
  },
};
const pesan = (isi: unknown, stop: Anthropic.StopReason = "end_turn"): Anthropic.Message =>
  ({
    id: "msg_uji",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: stop,
    stop_sequence: null,
    stop_details: stop === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    content: [{ type: "text", text: typeof isi === "string" ? isi : JSON.stringify(isi), citations: null }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as Anthropic.Message;

// ---------------------------------------------------------------------------
// Rekening koran BNI sintetis: 42 baris Oktober 2026, saldo awal Rp 10.000.000
// ---------------------------------------------------------------------------

const SALDO_AWAL = 1_000_000_000; // sen = Rp 10.000.000
/** Baris ke-i: genap kredit, ganjil debet; nominal karangan. Tanggal naik. */
const barisSintetis = Array.from({ length: 42 }, (_, i) => ({
  tanggal: `2026-10-${String(1 + Math.floor(i / 2)).padStart(2, "0")}`,
  keterangan: i % 2 === 0 ? `SETORAN TUNAI ${i}` : `TRF KELUAR ${i}`,
  sen: i % 2 === 0 ? 25_000_000 + i * 1_000 : -(12_500_000 + i * 700),
}));
const desimal = (sen: number) => `${sen < 0 ? "-" : ""}${Math.floor(Math.abs(sen) / 100)}.${String(Math.abs(sen) % 100).padStart(2, "0")}`;
/** Angka kontrol dari cetakan (dihitung di sini, bukan oleh kode yang diuji). */
const KREDIT = barisSintetis.filter((b) => b.sen > 0).reduce((s, b) => s + b.sen, 0);
const DEBET = -barisSintetis.filter((b) => b.sen < 0).reduce((s, b) => s + b.sen, 0);
const KONTROL = { saldoAwalSen: SALDO_AWAL, totalDebetSen: DEBET, totalKreditSen: KREDIT, saldoAkhirSen: SALDO_AWAL + KREDIT - DEBET };

function bacaanDari(baris: typeof barisSintetis, opsi: { saldoBerjalan?: boolean } = {}): Bacaan {
  let saldo = SALDO_AWAL;
  return {
    terbaca: true,
    nomorRekening: "0123456789",
    saldoAwal: desimal(SALDO_AWAL),
    baris: baris.map((b) => {
      saldo += b.sen;
      return {
        tanggal: b.tanggal,
        keterangan: b.keterangan,
        arah: b.sen < 0 ? "debet" : "kredit",
        nominal: desimal(Math.abs(b.sen)),
        saldo: opsi.saldoBerjalan ? desimal(saldo) : null,
      };
    }),
  };
}

const PDF = Buffer.from("%PDF-1.7 sintetis bni");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

beforeEach(() => {
  panggilan.length = 0;
  jawabAi = async () => pesan(bacaanDari(barisSintetis));
});

// ---------------------------------------------------------------------------
// Pembaca
// ---------------------------------------------------------------------------

describe("bacaRekeningKoranAi — permintaan & bacaan (KTD9)", () => {
  it("PDF dikirim sebagai blok document base64 SEBELUM instruksi; model claude-opus-5-5; keluaran terstruktur + effort; tanpa sampling", async () => {
    await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" });
    const p = panggilan[0]!;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.output_config?.format?.type).toBe("json_schema");
    expect(p.output_config?.effort).toBe("medium");
    expect(p).not.toHaveProperty("temperature");
    expect(p).not.toHaveProperty("top_p");
    expect(p).not.toHaveProperty("output_format");
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]!.role).toBe("user");
    const isi = p.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(isi[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: PDF.toString("base64") },
    });
    expect(isi[isi.length - 1]!.type).toBe("text");
  });

  it("foto dikirim sebagai blok image", async () => {
    await ai.bacaRekeningKoranAi(klienPalsu, { isi: JPEG, media: "image/jpeg", periode: "2026-10" });
    const isi = panggilan[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(isi[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") } });
  });

  it("bacaan → bentuk RekeningKoran: debet negatif, urutan per tanggal, saldo berjalan tercetak dibawa", async () => {
    jawabAi = async () => pesan(bacaanDari(barisSintetis.slice(0, 3), { saldoBerjalan: true }));
    const r = await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rk.periode).toBe("2026-10");
    expect(r.rk.saldoAwalSen).toBe(1_000_000_000);
    expect(r.rk.rows.map((x) => [x.tanggal, x.urutan, x.amountSen, x.saldoSen])).toEqual([
      ["2026-10-01", 1, 25_000_000, 1_025_000_000],
      ["2026-10-01", 2, -12_500_700, 1_012_499_300],
      ["2026-10-02", 1, 25_002_000, 1_037_501_300],
    ]);
    expect(r.nomorRekening).toBe("0123456789");
  });

  it('🔴 stop_reason "refusal" ⇒ "tidak terbaca", bukan galat', async () => {
    jawabAi = async () => pesan("", "refusal");
    const r = await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" });
    expect(r).toMatchObject({ ok: false, sebab: "tidak-terbaca" });
    if (!r.ok) expect(r.pesan).toMatch(/tidak terbaca/i);
  });

  it("model menyatakan bukan rekening koran / nominal berbentuk tak dikenal / bacaan terpotong ⇒ tidak terbaca", async () => {
    jawabAi = async () => pesan({ ...bacaanDari([]), terbaca: false });
    expect(await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" })).toMatchObject({
      ok: false,
      sebab: "tidak-terbaca",
    });
    const b = bacaanDari(barisSintetis.slice(0, 1));
    b.baris[0]!.nominal = "25.000.000,00";
    jawabAi = async () => pesan(b);
    expect(await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" })).toMatchObject({
      ok: false,
      sebab: "tidak-terbaca",
    });
    jawabAi = async () => pesan('{"terbaca": true, "baris": [', "max_tokens");
    expect(await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" })).toMatchObject({
      ok: false,
      sebab: "tidak-terbaca",
    });
  });

  it("galat SDK bertipe (koneksi) ⇒ sebab layanan, pesan tidak memuat isi berkas", async () => {
    jawabAi = async () => {
      throw new Anthropic.APIConnectionError({ message: "putus" });
    };
    const r = await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" });
    expect(r).toMatchObject({ ok: false, sebab: "layanan" });
  });

  it("tanpa ANTHROPIC_API_KEY ⇒ tak ada klien (fail closed)", async () => {
    const asli = await vi.importActual<typeof import("./rekening-koran-ai")>("./rekening-koran-ai");
    expect(asli.buatKlien({})).toBeNull();
    expect(asli.buatKlien({ ANTHROPIC_API_KEY: "  " })).toBeNull();
    expect(asli.buatKlien({ ANTHROPIC_API_KEY: "kunci-uji" })).not.toBeNull();
  });

  it("jenis berkas dikenali dari kepala, bukan nama", () => {
    expect(ai.kenaliMedia(PDF)).toBe("application/pdf");
    expect(ai.kenaliMedia(JPEG)).toBe("image/jpeg");
    expect(ai.kenaliMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(ai.kenaliMedia(Buffer.from("PK\u0003\u0004 xlsx"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gerbang murni
// ---------------------------------------------------------------------------

async function rkDari(baris: typeof barisSintetis, opsi: { saldoBerjalan?: boolean } = {}) {
  jawabAi = async () => pesan(bacaanDari(baris, opsi));
  const r = await ai.bacaRekeningKoranAi(klienPalsu, { isi: PDF, media: "application/pdf", periode: "2026-10" });
  if (!r.ok) throw new Error("bacaan uji harus terbaca");
  return r.rk;
}
const JANGKAR_LALU = { jenis: "rekening-koran-lalu", periode: "2026-09", saldoAkhirSen: SALDO_AWAL } as const;

describe("periksaBacaan — gerbang R30", () => {
  it("🔴 Covers AE8. Satu dari 42 baris terlewat ⇒ total debet ≠ angka kontrol ⇒ ditolak, menyebut total yang berbeda", async () => {
    const terlewat = barisSintetis.filter((_, i) => i !== 17); // baris debet
    const rk = await rkDari(terlewat);
    const g = model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: JANGKAR_LALU });
    expect(g.ok).toBe(false);
    if (g.ok) return;
    expect(g.pelanggaran).toContainEqual({
      jenis: "kontrol",
      angka: "total-debet",
      terbaca: DEBET - (12_500_000 + 17 * 700),
      kontrol: DEBET,
      selisih: -(12_500_000 + 17 * 700),
    });
    expect(g.pesan).toMatch(/total debet/i);
    expect(g.pesan).toMatch(/tidak ada baris yang disimpan/i);
  });

  it("bacaan cocok empat angka kontrol & jangkar ⇒ lolos; kaki yang disimpan = angka kontrol", async () => {
    const rk = await rkDari(barisSintetis, { saldoBerjalan: true });
    const g = model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: JANGKAR_LALU });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.rk.footer).toEqual({ mutasiCrSen: KREDIT, nCr: 21, mutasiDbSen: DEBET, nDb: 21, saldoAkhirSen: KONTROL.saldoAkhirSen });
  });

  it("🔴 saldo berjalan tercetak ≠ saldo sebelumnya ± nominal pada satu baris ⇒ ditolak (walau total cocok)", async () => {
    const rk = await rkDari(barisSintetis, { saldoBerjalan: true });
    rk.rows[9] = { ...rk.rows[9]!, saldoSen: rk.rows[9]!.saldoSen! + 100 };
    const g = model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: JANGKAR_LALU });
    expect(g.ok).toBe(false);
    if (g.ok) return;
    expect(g.pelanggaran).toEqual([
      expect.objectContaining({ jenis: "saldo-berjalan", baris: 10, tercetak: rk.rows[9]!.saldoSen, dihitung: rk.rows[9]!.saldoSen! - 100 }),
    ]);
  });

  it("tanggal mundur atau di luar periode ⇒ ditolak", async () => {
    const rk = await rkDari(barisSintetis);
    const mundur = { ...rk, rows: rk.rows.map((r, i) => (i === 5 ? { ...r, tanggal: "2026-10-01" } : r)) };
    const g1 = model.periksaBacaan({ rk: mundur, kontrol: KONTROL, periode: "2026-10", jangkar: JANGKAR_LALU });
    expect(!g1.ok && g1.pelanggaran.map((p) => p.jenis)).toEqual(["tanggal"]);
    const luar = { ...rk, rows: rk.rows.map((r, i) => (i === 41 ? { ...r, tanggal: "2026-11-01" } : r)) };
    const g2 = model.periksaBacaan({ rk: luar, kontrol: KONTROL, periode: "2026-10", jangkar: JANGKAR_LALU });
    expect(!g2.ok && g2.pelanggaran.map((p) => p.jenis)).toEqual(["tanggal"]);
  });

  it("🔴 saldo awal ≠ saldo akhir rekening koran bulan lalu yang terkonfirmasi ⇒ ditolak", async () => {
    const rk = await rkDari(barisSintetis);
    const g = model.periksaBacaan({
      rk,
      kontrol: KONTROL,
      periode: "2026-10",
      jangkar: { jenis: "rekening-koran-lalu", periode: "2026-09", saldoAkhirSen: SALDO_AWAL - 5_000 },
    });
    expect(!g.ok && g.pelanggaran).toEqual([
      { jenis: "jangkar", sumber: "rekening-koran-lalu", saldoAwal: SALDO_AWAL, jangkarSen: SALDO_AWAL - 5_000, selisih: 5_000 },
    ]);
  });

  it("🔴 jangkar pertama: rekening tanpa rekening koran terkonfirmasi — saldo awal BNI = saldo buku bank ⇒ lolos; selisih ⇒ ditolak", async () => {
    const rk = await rkDari(barisSintetis);
    const cocok = model.bandingkanSaldoAwal({
      periode: "2026-10",
      saldoAwalSen: SALDO_AWAL,
      buku: { cutOver: "2026-10-01", saldoSen: SALDO_AWAL, sementara: false },
    });
    expect(model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: { jenis: "buku-bank", perbandingan: cocok } }).ok).toBe(true);
    const selisih = model.bandingkanSaldoAwal({
      periode: "2026-10",
      saldoAwalSen: SALDO_AWAL,
      buku: { cutOver: "2026-10-01", saldoSen: SALDO_AWAL + 1, sementara: false },
    });
    expect(model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: { jenis: "buku-bank", perbandingan: selisih } }).ok).toBe(false);
    const tanpa = model.bandingkanSaldoAwal({ periode: "2026-10", saldoAwalSen: SALDO_AWAL, buku: null });
    expect(model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: { jenis: "buku-bank", perbandingan: tanpa } }).ok).toBe(false);
  });

  it("ada rekening koran terkonfirmasi lebih awal tetapi bulan lalu bolong ⇒ ditolak", async () => {
    const rk = await rkDari(barisSintetis);
    const g = model.periksaBacaan({ rk, kontrol: KONTROL, periode: "2026-10", jangkar: { jenis: "bulan-lalu-belum", periodeLalu: "2026-09" } });
    expect(g.ok).toBe(false);
  });
});

describe("angka kontrol & foto", () => {
  it("angka ketikan Indonesia → sen; bentuk lain ditolak", () => {
    expect(model.parseRupiahKetik("10.000.000")).toBe(1_000_000_000);
    expect(model.parseRupiahKetik("1.234.567,89")).toBe(123_456_789);
    expect(model.parseRupiahKetik("250000,5")).toBe(25_000_050);
    expect(model.parseRupiahKetik("-1.000")).toBe(-100_000);
    expect(model.parseRupiahKetik("1,234,567.89")).toBeNull();
    expect(model.parseRupiahKetik("")).toBeNull();
    expect(model.parseRupiahKetik("12a")).toBeNull();
  });

  it("empat angka kontrol yang tidak menutup ditolak sebelum dibaca", () => {
    expect(model.periksaAngkaKontrol(KONTROL)).toBeNull();
    expect(model.periksaAngkaKontrol({ ...KONTROL, saldoAkhirSen: KONTROL.saldoAkhirSen + 1 })).toMatch(/saldo akhir/i);
    expect(model.periksaAngkaKontrol({ ...KONTROL, totalDebetSen: -1 })).toMatch(/tidak boleh negatif/i);
  });

  it("foto 4 MB diperkecil sampai di bawah batas; yang tak pernah muat ditolak dengan pesan jelas", async () => {
    // Pengode tiruan: ukuran ∝ (lebar² × mutu) — foto 4 MB pada 4000 px, mutu 1.
    const kodekan = async (lebar: number, mutu: number) => ({ size: Math.round(4_000_000 * (lebar / 4000) ** 2 * mutu) });
    const r = await model.perkecilSampaiMuat(kodekan);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hasil.size).toBeLessThanOrEqual(model.MAKS_BERKAS_BYTE);
    const bandel = await model.perkecilSampaiMuat(async () => ({ size: 5_000_000 }));
    expect(bandel).toMatchObject({ ok: false });
    if (!bandel.ok) expect(bandel.pesan).toMatch(/1 MB/);
  });
});

// ---------------------------------------------------------------------------
// Server action — DB tiruan
// ---------------------------------------------------------------------------

const AKUN = "11111111-1111-4111-8111-111111111111";
const RK_BARU = "33333333-3333-4333-8333-333333333333";
const RK_TUNGGU = "44444444-4444-4444-8444-444444444444";
const titik = (sen: number) => model.formatRupiahKetik(sen);

type Akun = { id: string; nama: string; kind: string; active: boolean; nomorRekening: string | null; bca: boolean };
let akun: Akun | null;
let nPercobaan: number;
let rkLalu: { periode: string; saldoAkhir: string } | null;
let buku: { cutOver: string; saldo: string; sementara: boolean } | null;
let ada: { id: string } | null;
let tunggu: { id: string; status: string; periode: string; accountId: string; saldoAwal: string } | null;

const db = (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.cash_account")) return { rows: akun ? [akun] : [] };
  if (sql.includes("FROM app.audit_log")) return { rows: [{ n: nPercobaan }] };
  if (sql.includes("FROM app.rekening_koran") && sql.includes("periode < $3")) return { rows: rkLalu ? [rkLalu] : [] };
  if (sql.includes("FROM app.rekening_koran") && sql.includes("'menunggu'") && sql.includes("periode = $3")) return { rows: ada ? [ada] : [] };
  if (sql.includes("FROM app.rekening_koran") && sql.includes("FOR UPDATE")) return { rows: tunggu ? [tunggu] : [] };
  if (sql.includes("AS unit") && sql.includes("saldo_awal")) return { rows: [{ unit: "2026-10-01", akun: "2026-10-01" }] };
  if (sql.includes("WITH sa AS")) return { rows: buku ? [buku] : [] };
  if (sql.includes("INSERT INTO app.rekening_koran")) return { rows: [{ id: RK_BARU }] };
  if (sql.includes("UPDATE app.rekening_koran")) return { rows: [], rowCount: 1 };
  return undefined;
};
const tulis = (tabel: string) => h.log.filter((l) => new RegExp(`(INSERT INTO|UPDATE) ${tabel}\\b`).test(l.sql));
const audit = (aksiNama: string) => h.log.filter((l) => l.sql.includes("INSERT INTO app.audit_log") && l.params[2] === aksiNama);

function formAi(berkas: Buffer | null = PDF, kontrol = KONTROL): FormData {
  const f = new FormData();
  f.set("code", h.BK.code);
  f.set("accountId", AKUN);
  f.set("periode", "2026-10");
  f.set("saldoAwal", titik(kontrol.saldoAwalSen));
  f.set("totalDebet", titik(kontrol.totalDebetSen));
  f.set("totalKredit", titik(kontrol.totalKreditSen));
  f.set("saldoAkhir", titik(kontrol.saldoAkhirSen));
  if (berkas) f.set("berkas", new File([new Uint8Array(berkas)], "rk.pdf"));
  return f;
}

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  h.state.jawab = db;
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
  h.ai.klien = klienPalsu;
  akun = { id: AKUN, nama: "Bank BNI - 0123456789", kind: "bank", active: true, nomorRekening: "0123456789", bca: false };
  nPercobaan = 0;
  rkLalu = { periode: "2026-09", saldoAkhir: desimal(SALDO_AWAL) };
  buku = null;
  ada = null;
  tunggu = null;
});

describe("bacaRekeningKoranAiAksi — R29, R30", () => {
  it("🔴 Covers AE8. Bacaan melewatkan satu baris ⇒ ditolak, total yang berbeda disebut, TIDAK ADA baris tersimpan", async () => {
    jawabAi = async () => pesan(bacaanDari(barisSintetis.filter((_, i) => i !== 17)));
    const r = await aksi.bacaRekeningKoranAiAksi(formAi());
    expect(r.status).toBe("ditolak-gerbang");
    if (r.status !== "ditolak-gerbang") return;
    expect(r.pelanggaran.map((p) => (p.jenis === "kontrol" ? p.angka : p.jenis))).toContain("total-debet");
    expect(r.pesan).toMatch(/total debet/i);
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(tulis("app.mutasi_bank")).toEqual([]);
    // Percobaannya tetap tercatat (batas 10/bulan menghitung yang ditolak).
    expect(audit("rekening_koran.baca_ai")).toHaveLength(1);
  });

  it("🔴 bacaan lolos ⇒ tersimpan berstatus menunggu konfirmasi HoF; baris ikut status itu; tanpa cocok otomatis", async () => {
    const r = await aksi.bacaRekeningKoranAiAksi(formAi());
    expect(r).toMatchObject({ status: "menunggu-konfirmasi", rekeningKoranId: RK_BARU, periode: "2026-10", nBaris: 42, sisaPercobaan: 9 });
    const rk = tulis("app.rekening_koran");
    expect(rk).toHaveLength(1);
    expect(rk[0]!.params.slice(-2)).toEqual(["menunggu", "ai"]);
    // (unit, akun, periode, saldo awal, saldo akhir, cr, n cr, db, n db, …) = angka kontrol
    expect(rk[0]!.params.slice(0, 9)).toEqual([
      2,
      AKUN,
      "2026-10-01",
      desimal(SALDO_AWAL),
      desimal(KONTROL.saldoAkhirSen),
      desimal(KREDIT),
      21,
      desimal(DEBET),
      21,
    ]);
    const mb = tulis("app.mutasi_bank");
    expect(mb).toHaveLength(1);
    expect(mb[0]!.params[mb[0]!.params.length - 1]).toBe("menunggu");
    expect(tulis("app.cocok_bank")).toEqual([]);
    expect(h.log.some((l) => l.params[2] === "cocok_bank.otomatis")).toBe(false);
  });

  it("🔴 jangkar pertama: tanpa rekening koran terkonfirmasi sebelumnya, saldo awal = saldo buku bank ⇒ lolos", async () => {
    rkLalu = null;
    buku = { cutOver: "2026-10-01", saldo: desimal(SALDO_AWAL), sementara: false };
    expect(await aksi.bacaRekeningKoranAiAksi(formAi())).toMatchObject({ status: "menunggu-konfirmasi" });
    buku = { cutOver: "2026-10-01", saldo: desimal(SALDO_AWAL + 100), sementara: false };
    h.log.length = 0;
    expect(await aksi.bacaRekeningKoranAiAksi(formAi())).toMatchObject({ status: "ditolak-gerbang" });
    expect(tulis("app.rekening_koran")).toEqual([]);
  });

  it("🔴 tanpa kunci API ⇒ menolak SEBELUM membaca & menawarkan input manual; percobaan tak dihitung", async () => {
    h.ai.klien = null;
    const r = await aksi.bacaRekeningKoranAiAksi(formAi());
    expect(r).toMatchObject({ status: "ditolak", sebab: "tanpa-kunci", inputManual: true });
    expect(panggilan).toHaveLength(0);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it('🔴 refusal ⇒ "tidak terbaca", input manual ditawarkan, tidak ada yang tersimpan', async () => {
    jawabAi = async () => pesan("", "refusal");
    const r = await aksi.bacaRekeningKoranAiAksi(formAi());
    expect(r).toMatchObject({ status: "ditolak", sebab: "tidak-terbaca", inputManual: true });
    expect(tulis("app.rekening_koran")).toEqual([]);
  });

  it("🔴 percobaan ke-11 dalam satu bulan untuk rekening yang sama ⇒ ditolak tanpa memanggil AI", async () => {
    nPercobaan = 10;
    const r = await aksi.bacaRekeningKoranAiAksi(formAi());
    expect(r).toMatchObject({ status: "ditolak", sebab: "batas-percobaan", inputManual: true });
    expect(panggilan).toHaveLength(0);
    expect(audit("rekening_koran.baca_ai")).toEqual([]);
    // Percobaan ke-10 masih boleh.
    nPercobaan = 9;
    h.log.length = 0;
    expect(await aksi.bacaRekeningKoranAiAksi(formAi())).toMatchObject({ status: "menunggu-konfirmasi", sisaPercobaan: 0 });
  });

  it("rekening BCA ditolak — BCA tetap lewat parser e-statement (R29)", async () => {
    akun = { ...akun!, nama: "Bank BCA - 0987654321", bca: true };
    expect(await aksi.bacaRekeningKoranAiAksi(formAi())).toMatchObject({ status: "ditolak", sebab: "rekening-salah" });
    expect(panggilan).toHaveLength(0);
  });

  it("angka kontrol tidak menutup ⇒ ditolak sebelum AI dipanggil", async () => {
    const r = await aksi.bacaRekeningKoranAiAksi(formAi(PDF, { ...KONTROL, saldoAkhirSen: KONTROL.saldoAkhirSen + 100 }));
    expect(r).toMatchObject({ status: "ditolak", sebab: "kontrol" });
    expect(panggilan).toHaveLength(0);
  });

  it("HoF tidak mengunggah (wewenang Keuangan)", async () => {
    h.sesi.role = "viewer";
    h.sesi.email = "hof@solagroup.co";
    expect(await aksi.bacaRekeningKoranAiAksi(formAi())).toMatchObject({ status: "ditolak", sebab: "wewenang" });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("simpanMutasiManual — pemeriksaan yang sama (R30)", () => {
  const masukan = (baris = barisSintetis) => ({
    code: h.BK.code,
    accountId: AKUN,
    periode: "2026-10",
    kontrol: {
      saldoAwal: titik(KONTROL.saldoAwalSen),
      totalDebet: titik(KONTROL.totalDebetSen),
      totalKredit: titik(KONTROL.totalKreditSen),
      saldoAkhir: titik(KONTROL.saldoAkhirSen),
    },
    baris: baris.map((b) => ({ tanggal: b.tanggal, keterangan: b.keterangan, arah: b.sen < 0 ? ("debet" as const) : ("kredit" as const), nominal: titik(Math.abs(b.sen)), saldo: "" })),
  });

  it("baris terlewat ⇒ ditolak, tidak ada yang tersimpan", async () => {
    const r = await aksi.simpanMutasiManual(masukan(barisSintetis.slice(1)));
    expect(r.status).toBe("ditolak-gerbang");
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(tulis("app.mutasi_bank")).toEqual([]);
  });

  it("lengkap ⇒ menunggu konfirmasi HoF, sumber manual, tanpa percobaan AI", async () => {
    const r = await aksi.simpanMutasiManual(masukan());
    expect(r).toMatchObject({ status: "menunggu-konfirmasi", nBaris: 42 });
    expect(tulis("app.rekening_koran")[0]!.params.slice(-2)).toEqual(["menunggu", "manual"]);
    expect(audit("rekening_koran.baca_ai")).toEqual([]);
    expect(panggilan).toHaveLength(0);
  });
});

describe("konfirmasiRekeningKoran — HoF", () => {
  beforeEach(() => {
    tunggu = { id: RK_TUNGGU, status: "menunggu", periode: "2026-10", accountId: AKUN, saldoAwal: desimal(SALDO_AWAL) };
  });

  it("staf Keuangan tidak boleh mengonfirmasi bacaannya sendiri", async () => {
    const r = await aksi.konfirmasiRekeningKoran({ code: h.BK.code, rekeningKoranId: RK_TUNGGU });
    expect(r).toMatchObject({ ok: false });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 HoF ⇒ status aktif (baris ikut lewat FK), audit, lalu cocok otomatis — baris baru ikut pencocokan", async () => {
    h.sesi.role = "viewer";
    h.sesi.email = "hof@solagroup.co";
    const r = await aksi.konfirmasiRekeningKoran({ code: h.BK.code, rekeningKoranId: RK_TUNGGU });
    expect(r).toMatchObject({ ok: true });
    const u = tulis("app.rekening_koran");
    expect(u).toHaveLength(1);
    expect(u[0]!.sql).toMatch(/SET status = 'aktif'/);
    expect(u[0]!.sql).toMatch(/AND status = 'menunggu'/);
    expect(audit("rekening_koran.konfirmasi")).toHaveLength(1);
    const iCommit = h.log.findIndex((l) => l.sql === "COMMIT");
    const iCocok = h.log.findIndex((l) => l.sql.includes("FOR NO KEY UPDATE"));
    expect(iCommit).toBeGreaterThanOrEqual(0);
    expect(iCocok).toBeGreaterThan(iCommit);
  });

  it("jangkar berubah sejak dibaca (rekening koran bulan lalu kini berbeda) ⇒ konfirmasi ditolak", async () => {
    h.sesi.role = "viewer";
    h.sesi.email = "hof@solagroup.co";
    rkLalu = { periode: "2026-09", saldoAkhir: desimal(SALDO_AWAL + 1) };
    expect(await aksi.konfirmasiRekeningKoran({ code: h.BK.code, rekeningKoranId: RK_TUNGGU })).toMatchObject({ ok: false });
    expect(tulis("app.rekening_koran")).toEqual([]);
  });

  it("Tolak (HoF) = tarik bacaan yang menunggu: status ditarik dengan alasan", async () => {
    h.sesi.role = "viewer";
    h.sesi.email = "hof@solagroup.co";
    h.state.jawab = (sql) =>
      sql.includes("FROM app.reason_code") ? { rows: [{ code: "ADJ-DUP" }] } : sql.includes("FROM app.cocok_bank_baris") ? { rows: [{ n: 0 }] } : db(sql);
    const r = await aksi.tarikRekeningKoran({ code: h.BK.code, rekeningKoranId: RK_TUNGGU, reasonCode: "ADJ-DUP", catatan: "bacaan keliru" });
    expect(r).toMatchObject({ ok: true });
    const u = tulis("app.rekening_koran");
    expect(u[0]!.sql).toMatch(/SET status = 'ditarik'/);
    expect(u[0]!.sql).toMatch(/AND status = 'menunggu'/);
  });
});
