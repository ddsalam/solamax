import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unggah & tarik rekening koran (rencana 2026-10-29 U9; R17–R19, R22, R31;
 * AE3, AE8) dengan DB TIRUAN — pola `penebusan-actions.test.ts`. Klien tiruan
 * mencatat setiap pernyataan, jadi "ditolak" dibuktikan sebagai "tak ada
 * koneksi / tak ada INSERT".
 *
 * `teksDariPdf` DITIRU (pdftotext tak dijalankan di uji): berkas berkepala
 * `%PDF` dijawab teks fixture SINTETIS; selainnya diteruskan ke fungsi asli —
 * yang menolak kepala bukan-PDF sebelum menjalankan apa pun. Pembaca U8 ASLI.
 * Rekening koran asli tidak pernah masuk repo.
 *
 * ⚠️ Batas: SQL tidak dijalankan. Partial unique, FK komposit ber-cermin
 * status, dan CHECK kaki 0051 dibuktikan `impor-bank.integration.test.ts`
 * (ber-gerbang env — belum dijalankan).
 */
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  type Jawab = { rows: unknown[]; rowCount?: number } | undefined;
  const log: { sql: string; params: unknown[] }[] = [];
  const state: { jawab: (sql: string, params: unknown[]) => Jawab; teks: string } = {
    jawab: () => undefined,
    teks: "",
  };
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
  return { log, state, connect, BK, sesi };
});

vi.mock("./db", () => ({ pool: { connect: h.connect }, qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./pdf-teks", async (asli) => {
  const m = await asli<typeof import("./pdf-teks")>();
  return {
    ...m,
    teksDariPdf: vi.fn(async (isi: Buffer) => {
      if (isi.subarray(0, 4).toString("latin1") !== "%PDF") return m.teksDariPdf(isi);
      return h.state.teks;
    }),
  };
});
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

const { unggahRekeningKoran, tarikRekeningKoran } = await import("./impor-bank-actions");
const { teksDariPdf } = await import("./pdf-teks");

const AKUN = "11111111-1111-4111-8111-111111111111";
const RK_LAMA = "22222222-2222-4222-8222-222222222222";
const RK_BARU = "33333333-3333-4333-8333-333333333333";

const fixture = (nama: string) =>
  readFileSync(new URL(`./__fixtures__/rekening-koran-sintetis-${nama}.txt`, import.meta.url), "utf8");
const GIRO = fixture("giro"); // 9876543210 · Maret 2027 · 6 baris (2 CR, 4 DB)
/** Fixture giro digeser ke September 2026 — tata letak & kaki sama (AE8). */
const GIRO_SEP_2026 = GIRO.replace(/MARE T 2027/g, "SE PTE MBE R 2026")
  .replace("31/03", "30/03") // September 30 hari
  .replace(/(\d{2})\/03(\s)/g, "$1/09$2");

const PDF = (ekor = "a") => Buffer.from(`%PDF-1.4 sintetis ${ekor}`);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function form(isi: Buffer | null, over: Partial<{ code: string; accountId: string }> = {}): FormData {
  const f = new FormData();
  f.set("code", over.code ?? h.BK.code);
  f.set("accountId", over.accountId ?? AKUN);
  if (isi !== null) f.set("berkas", new File([new Uint8Array(isi)], "rk.pdf", { type: "application/pdf" }));
  return f;
}

type Akun = { id: string; nama: string; kind: string; active: boolean; nomorRekening: string | null; bca: boolean };
let akun: Akun | null;
let aktif: { id: string; fileSha256: string; nBaris: number; nPraCutover: number } | null;
let cutOver: { unit: string | null; akun: string | null };
let buku: { cutOver: string; saldo: string; sementara: boolean } | null;
let galatInsert: (Error & { code?: string; constraint?: string }) | null;

const db = (sql: string): { rows: unknown[]; rowCount?: number } | undefined => {
  if (sql.includes("FROM app.cash_account")) return { rows: akun ? [akun] : [] };
  if (sql.includes("FROM app.rekening_koran") && sql.includes("status = 'aktif'")) return { rows: aktif ? [aktif] : [] };
  if (sql.includes("AS unit") && sql.includes("saldo_awal")) return { rows: [cutOver] };
  if (sql.includes("INSERT INTO app.rekening_koran")) {
    if (galatInsert) throw galatInsert;
    return { rows: [{ id: RK_BARU }] };
  }
  if (sql.includes("INSERT INTO app.mutasi_bank")) return { rows: [], rowCount: 6 };
  if (sql.includes("WITH sa AS")) return { rows: buku ? [buku] : [] };
  return undefined;
};

const tulis = (tabel: string) => h.log.filter((l) => new RegExp(`(INSERT INTO|UPDATE) ${tabel}\\b`).test(l.sql));
const sql = () => h.log.map((l) => l.sql.trim().split(/\s+/).slice(0, 3).join(" "));

beforeEach(() => {
  h.log.length = 0;
  h.connect.mockClear();
  vi.mocked(teksDariPdf).mockClear();
  h.state.jawab = db;
  h.state.teks = GIRO;
  h.sesi.role = "keuangan";
  h.sesi.email = "staf@solagroup.co";
  akun = { id: AKUN, nama: "Bank BCA - 09876543210", kind: "bank", active: true, nomorRekening: "09876543210", bca: true };
  aktif = null;
  cutOver = { unit: "2027-03-01", akun: "2027-03-01" };
  buku = { cutOver: "2027-03-01", saldo: "500000000.00", sementara: false };
  galatInsert = null;
});

describe("unggahRekeningKoran — diterima (R17, R19)", () => {
  it("🔴 berkas valid ⇒ SATU rekening koran + 6 baris, satu transaksi, audit; cash_ledger TIDAK disentuh", async () => {
    const berkas = PDF();
    const r = await unggahRekeningKoran(form(berkas));
    expect(r).toMatchObject({
      status: "diterima",
      periode: "2027-03",
      nBaris: 6,
      nPraCutover: 0,
      nCr: 2,
      nDb: 4,
      saldoAwal: { status: "cocok", selisihSen: 0 },
    });

    const rk = tulis("app.rekening_koran");
    expect(rk).toHaveLength(1);
    // (unit, akun, periode, saldo awal, saldo akhir, cr, n cr, db, n db, sha256, user)
    expect(rk[0]!.params).toEqual([
      2,
      AKUN,
      "2027-03-01",
      "500000000.00",
      "414745247.36",
      "13595000.55",
      2,
      "98849753.19",
      4,
      sha(berkas),
      7,
    ]);

    const mb = tulis("app.mutasi_bank");
    expect(mb).toHaveLength(1);
    const p = mb[0]!.params;
    expect(p.slice(0, 3)).toEqual([2, RK_BARU, AKUN]);
    expect(p[3]).toEqual(["2027-03-03", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-05", "2027-03-31"]);
    expect(p[4]).toEqual([1, 2, 1, 1, 2, 1]);
    expect(p[6]).toEqual(["12345000.00", "-98765432.10", "-30000.00", "1250000.55", "-50000.00", "-4321.09"]);
    expect(p[10]).toEqual([false, false, false, false, false, false]);

    expect(h.log.find((l) => l.sql.includes("INSERT INTO app.audit_log"))?.params[2]).toBe("rekening_koran.unggah");
    expect(tulis("app.cash_ledger")).toEqual([]);
    expect(sql()).toContain("COMMIT");
    expect(urutanLog("BEGIN", "INSERT INTO app.rekening_koran")).toBe(true);
    expect(urutanLog("INSERT INTO app.mutasi_bank", "COMMIT")).toBe(true);
  });

  it("R18: saldo awal dibandingkan dengan saldo buku hari sebelumnya — selisih & sementara ikut", async () => {
    buku = { cutOver: "2027-03-01", saldo: "499999000.00", sementara: true };
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "diterima", saldoAwal: { status: "selisih", selisihSen: 100_000, sementara: true } });
    const q = h.log.find((l) => l.sql.includes("WITH sa AS"));
    expect(q?.params).toEqual([2, AKUN, "2027-03-01"]);
  });

  it("nomor rekening berawalan nol di sumber lain tetap cocok dengan kepala 10 digit", async () => {
    akun = { ...akun!, nomorRekening: "09876543210" };
    expect((await unggahRekeningKoran(form(PDF()))).status).toBe("diterima");
  });
});

describe("unggahRekeningKoran — cocok otomatis SESUDAH impor COMMIT (U10)", () => {
  const M1 = "55555555-5555-4555-8555-555555555555";
  const K1 = "66666666-6666-4666-8666-666666666666";
  const dbCocok = (q: string): { rows: unknown[]; rowCount?: number } | undefined => {
    if (q.includes("FOR NO KEY UPDATE")) return { rows: [{ status: "aktif" }] };
    if (q.includes("m.rekening_koran_id = $2::uuid")) {
      return {
        rows: [
          {
            id: M1, accountId: AKUN, tanggalBank: "2027-03-03", keterangan: "BI-FAST CR | CONTOH", amount: "12345000.00",
            so: null, dokRef: null, praCutover: false, rkStatus: "aktif", rekeningKoranId: RK_BARU, dicocokkan: false,
          },
        ],
      };
    }
    const kas = {
      id: K1, accountId: AKUN, businessDate: "2027-03-03", tanggalAsal: null, amount: "12345000.00", keterangan: "Ketikan",
      categoryLabel: "Pendapatan Lain-Lain", void: false, saldoAwal: false, edcSettlementId: null, edcSettlementDate: null,
      pasanganUuid: null, lahirDariCocokId: null, dicocokkan: false,
    };
    if (q.includes("BETWEEN $2::date")) return { rows: [kas] };
    if (q.includes("l.id = ANY($2::uuid[])")) return { rows: [kas] };
    if (q.includes("INSERT INTO app.cocok_bank (")) return { rows: [{ id: "g-1" }] };
    return db(q);
  };

  it("🔴 impor COMMIT dulu, lalu transaksi cocok sendiri menulis kelompok tunggal — cash_ledger tetap tak disentuh", async () => {
    h.state.jawab = dbCocok;
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "diterima", cocok: { status: "selesai", nOtomatis: 1 } });
    expect(urutanLog("INSERT INTO app.mutasi_bank", "COMMIT")).toBe(true);
    const commitImpor = h.log.findIndex((l) => l.sql.trim() === "COMMIT");
    const kelompok = h.log.findIndex((l) => l.sql.includes("INSERT INTO app.cocok_bank ("));
    expect(commitImpor).toBeGreaterThan(-1);
    expect(kelompok).toBeGreaterThan(commitImpor);
    expect(h.log.filter((l) => l.sql.trim() === "COMMIT")).toHaveLength(2);
    expect(h.log.some((l) => l.params[2] === "cocok_bank.otomatis")).toBe(true);
    expect(tulis("app.cash_ledger")).toEqual([]);
  });

  it("🔴 cocok otomatis GAGAL ⇒ impor tetap diterima, kegagalannya dilaporkan", async () => {
    h.state.jawab = (q) => {
      if (q.includes("FOR NO KEY UPDATE")) throw new Error("koneksi putus");
      return db(q);
    };
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "diterima", nBaris: 6, cocok: { status: "gagal" } });
    if (r.status === "diterima" && r.cocok.status === "gagal") expect(r.cocok.pesan).toMatch(/Impor tersimpan.*koneksi putus/);
    expect(sql()).toContain("ROLLBACK");
  });
});

describe("unggah ulang (R19)", () => {
  it("🔴 berkas IDENTIK (sha256 sama) ⇒ 'sudah ada', tak ada baris baru, ROLLBACK", async () => {
    const berkas = PDF();
    aktif = { id: RK_LAMA, fileSha256: sha(berkas), nBaris: 6, nPraCutover: 0 };
    const r = await unggahRekeningKoran(form(berkas));
    expect(r).toMatchObject({ status: "sudah-ada", periode: "2027-03", nBaris: 6 });
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(tulis("app.mutasi_bank")).toEqual([]);
    expect(sql()).toContain("ROLLBACK");
    expect(sql()).not.toContain("COMMIT");
  });

  it("🔴 berkas BERBEDA untuk periode yang aktif ⇒ ditolak 'tarik impor lama dulu (HoF)'", async () => {
    aktif = { id: RK_LAMA, fileSha256: sha(PDF("lama")), nBaris: 6, nPraCutover: 0 };
    const r = await unggahRekeningKoran(form(PDF("baru")));
    expect(r).toMatchObject({ status: "ditolak", sebab: "periode-aktif" });
    expect(r.status === "ditolak" && r.pesan).toMatch(/[Tt]arik.*Head of Finance/);
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(tulis("app.mutasi_bank")).toEqual([]);
  });

  it("balapan dua unggahan: partial unique menolak yang kedua ⇒ pesan periode aktif, bukan galat mentah", async () => {
    galatInsert = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "rekening_koran_aktif_uq",
    });
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "ditolak", sebab: "periode-aktif" });
    expect(sql()).toContain("ROLLBACK");
  });
});

describe("AE8 / R22 — pra-cut-over disimpan, tidak dibukukan", () => {
  it("🔴 cut-over 1 Okt 2026, berkas September ⇒ semua baris pra_cutover, NOL baris kas", async () => {
    h.state.teks = GIRO_SEP_2026;
    cutOver = { unit: "2026-10-01", akun: "2026-10-01" };
    buku = { cutOver: "2026-10-01", saldo: "1.00", sementara: false };
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({
      status: "diterima",
      periode: "2026-09",
      nBaris: 6,
      nPraCutover: 6,
      saldoAwal: { status: "sebelum-cut-over", cutOver: "2026-10-01" },
    });
    const p = tulis("app.mutasi_bank")[0]!.params;
    expect(p[3]).toEqual(["2026-09-03", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-05", "2026-09-30"]);
    expect(p[10]).toEqual([true, true, true, true, true, true]);
    expect(tulis("app.cash_ledger")).toEqual([]);
  });

  it("cut-over di tengah bulan ⇒ hanya baris SEBELUM cut-over yang pra; rekening tanpa saldo pembuka jatuh ke cut-over unit", async () => {
    cutOver = { unit: "2027-03-05", akun: null };
    await unggahRekeningKoran(form(PDF()));
    expect(tulis("app.mutasi_bank")[0]!.params[10]).toEqual([true, true, true, false, false, false]);
  });
});

describe("R18 — rekening salah", () => {
  it("🔴 nomor di kepala ≠ nomor rekening yang dipilih ⇒ ditolak, tak ada INSERT", async () => {
    akun = { ...akun!, nama: "Bank BCA - 5125036811", nomorRekening: "5125036811" };
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "ditolak", sebab: "rekening-salah" });
    expect(r.status === "ditolak" && r.pesan).toMatch(/9876543210.*5125036811/);
    expect(tulis("app.rekening_koran")).toEqual([]);
  });

  it("rekening bukan milik unit / bukan BCA / nonaktif / tanpa nomor ⇒ ditolak rekening-salah", async () => {
    for (const a of [
      null,
      { ...akun!, nama: "Bank BRI - 9876543210", bca: false },
      { ...akun!, active: false },
      { ...akun!, nomorRekening: null },
      { ...akun!, kind: "tunai" },
    ]) {
      akun = a;
      h.log.length = 0;
      const r = await unggahRekeningKoran(form(PDF()));
      expect(r, JSON.stringify(a)).toMatchObject({ status: "ditolak", sebab: "rekening-salah" });
      expect(tulis("app.rekening_koran")).toEqual([]);
    }
  });
});

describe("bulan tertutup — unggah ditolak (keputusan Dion 30 Okt 2026, §10.43)", () => {
  it("🔴 bulan berkas SUDAH DITUTUP ⇒ ditolak bulan-tertutup, tak ada INSERT; kunci bersama bulan diambil SEBELUM tutup_bulan dibaca", async () => {
    h.state.jawab = (q, p) =>
      q.includes("FROM app.tutup_bulan") ? { rows: (p[1] as string[]).includes("2027-03-01") ? [{ bulan: "2027-03" }] : [] } : db(q);
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "ditolak", sebab: "bulan-tertutup" });
    expect(r.status === "ditolak" && r.pesan).toMatch(/Bulan 2027-03 sudah ditutup/);
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(tulis("app.mutasi_bank")).toEqual([]);
    expect(sql()).not.toContain("COMMIT");
    const kunci = h.log.findIndex((l) => l.sql.includes("pg_advisory_xact_lock_shared") && l.sql.includes("tutup-bulan:"));
    const baca = h.log.findIndex((l) => l.sql.includes("FROM app.tutup_bulan"));
    expect(kunci).toBeGreaterThanOrEqual(0);
    expect(kunci).toBeLessThan(baca);
    expect(h.log[kunci]!.params).toEqual([2, "2027-03"]);
  });

  it("berkas IDENTIK untuk bulan tertutup tetap 'sudah ada' (idempoten), bukan penolakan", async () => {
    const berkas = PDF();
    aktif = { id: RK_LAMA, fileSha256: sha(berkas), nBaris: 6, nPraCutover: 0 };
    h.state.jawab = (q, p) =>
      q.includes("FROM app.tutup_bulan") ? { rows: (p[1] as string[]).includes("2027-03-01") ? [{ bulan: "2027-03" }] : [] } : db(q);
    expect(await unggahRekeningKoran(form(berkas))).toMatchObject({ status: "sudah-ada", rekeningKoranId: RK_LAMA });
  });

  it("bulan lain yang tertutup tidak menahan unggahan bulan terbuka", async () => {
    h.state.jawab = (q, p) =>
      q.includes("FROM app.tutup_bulan") ? { rows: (p[1] as string[]).includes("2027-02-01") ? [{ bulan: "2027-02" }] : [] } : db(q);
    expect(await unggahRekeningKoran(form(PDF()))).toMatchObject({ status: "diterima" });
  });
});

describe("AE3 / R17 — kaki tidak cocok", () => {
  it("🔴 total DB beda Rp 0,01 ⇒ ditolak utuh dengan rincian; TAK ADA koneksi DB dibuka", async () => {
    h.state.teks = GIRO.replace("98,849,753.19", "98,849,753.20");
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "ditolak-kaki" });
    if (r.status !== "ditolak-kaki") throw new Error("tak terduga");
    expect(r.ketidakcocokan).toContainEqual({ pemeriksaan: "mutasi-db", terbaca: 9_884_975_319, kaki: 9_884_975_320, selisih: -1 });
    expect(r.pesan).toMatch(/ditolak utuh/);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("teks bukan e-statement BCA ⇒ ditolak format, tanpa koneksi", async () => {
    h.state.teks = "BUKAN REKENING KORAN";
    const r = await unggahRekeningKoran(form(PDF()));
    expect(r).toMatchObject({ status: "ditolak", sebab: "format" });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("berkas — pesan jelas, bukan galat server", () => {
  it("🔴 lebih dari 1 MB ⇒ pesan menyebut batasnya; pdftotext tak dijalankan", async () => {
    const besar = Buffer.concat([PDF(), Buffer.alloc(1_000_001)]);
    const r = await unggahRekeningKoran(form(besar));
    expect(r).toMatchObject({ status: "ditolak", sebab: "berkas" });
    expect(r.status === "ditolak" && r.pesan).toMatch(/1 MB/);
    expect(teksDariPdf).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 bukan PDF ⇒ pesan 'Berkas bukan PDF'", async () => {
    const r = await unggahRekeningKoran(form(Buffer.from("PK\u0003\u0004 ini zip")));
    expect(r).toMatchObject({ status: "ditolak", sebab: "berkas" });
    expect(r.status === "ditolak" && r.pesan).toMatch(/bukan PDF/);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("tanpa berkas / rekening tak sah ⇒ pesan, tanpa koneksi", async () => {
    expect(await unggahRekeningKoran(form(null))).toMatchObject({ status: "ditolak", sebab: "berkas" });
    expect(await unggahRekeningKoran(form(PDF(), { accountId: "x" }))).toMatchObject({
      status: "ditolak",
      sebab: "rekening-salah",
    });
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("wewenang DIPERIKSA SEBELUM berkas dibaca", () => {
  it.each([
    ["pengawas", "pengawas@solagroup.co"],
    ["direksi", "direksi@solagroup.co"],
    ["keuangan", "hof@solagroup.co"], // HoF tidak mengetik (§10.12)
  ])("🔴 %s (%s) ⇒ ditolak; berkas TIDAK disentuh", async (role, email) => {
    h.sesi.role = role;
    h.sesi.email = email;
    const f = form(PDF());
    const get = vi.spyOn(f, "get");
    const r = await unggahRekeningKoran(f);
    expect(r).toMatchObject({ status: "ditolak", sebab: "wewenang" });
    expect(get.mock.calls.map((c) => c[0])).not.toContain("berkas");
    expect(teksDariPdf).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("unit di luar jangkauan ⇒ requireUnit melempar (notFound), berkas tak disentuh", async () => {
    const f = form(PDF(), { code: "9999999" });
    const get = vi.spyOn(f, "get");
    await expect(unggahRekeningKoran(f)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(get.mock.calls.map((c) => c[0])).not.toContain("berkas");
  });
});

// ---------------------------------------------------------------------------
// Tarik (R31)
// ---------------------------------------------------------------------------

describe("tarikRekeningKoran — HoF saja, beralasan, beraudit", () => {
  let rk: { id: string; status: string; periode: string; accountId: string } | null;
  let kode = true;
  const dbTarik = (q: string): { rows: unknown[]; rowCount?: number } | undefined => {
    if (q.includes("FROM app.reason_code")) return { rows: kode ? [{ code: "ADJ-DUP" }] : [] };
    if (q.includes("FROM app.rekening_koran")) return { rows: rk ? [rk] : [] };
    if (q.includes("UPDATE app.rekening_koran")) return { rows: [], rowCount: 1 };
    return undefined;
  };
  const masukan = { code: h.BK.code, rekeningKoranId: RK_LAMA, reasonCode: "ADJ-DUP", catatan: "berkas salah bulan" };

  it("🔴 U10: ada baris di kelompok cocok AKTIF ⇒ ditolak 'batalkan cocok dulu'; tak ada UPDATE", async () => {
    h.state.jawab = (q) => (q.includes("FROM app.cocok_bank_baris") ? { rows: [{ n: 3 }] } : dbTarik(q));
    const r = await tarikRekeningKoran(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/3 baris .* sudah dicocokkan — batalkan cocok dulu/);
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(sql()).not.toContain("COMMIT");
  });

  beforeEach(() => {
    h.state.jawab = dbTarik;
    rk = { id: RK_LAMA, status: "aktif", periode: "2027-03", accountId: AKUN };
    kode = true;
    h.sesi.role = "admin_perusahaan";
    h.sesi.email = "hof@solagroup.co";
  });

  it("🔴 staf Keuangan ⇒ ditolak, tanpa koneksi", async () => {
    h.sesi.role = "keuangan";
    h.sesi.email = "staf@solagroup.co";
    const r = await tarikRekeningKoran(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/Head of Finance/);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("🔴 HoF ⇒ status ditarik + alasan + catatan, audit rekening_koran.tarik, COMMIT", async () => {
    const r = await tarikRekeningKoran(masukan);
    expect(r).toMatchObject({ ok: true });
    const u = tulis("app.rekening_koran");
    expect(u).toHaveLength(1);
    expect(u[0]!.sql).toMatch(/SET status = 'ditarik'/);
    expect(u[0]!.sql).toMatch(/AND status = 'aktif'/);
    expect(u[0]!.params).toEqual([RK_LAMA, 2, 7, "ADJ-DUP", "berkas salah bulan"]);
    const a = h.log.find((l) => l.sql.includes("INSERT INTO app.audit_log"));
    expect(a?.params[2]).toBe("rekening_koran.tarik");
    expect(JSON.parse(String(a?.params[4]))).toMatchObject({ reasonCode: "ADJ-DUP", catatan: "berkas salah bulan", periode: "2027-03" });
    expect(sql()).toContain("COMMIT");
    // Baris mutasi tak pernah disunting aplikasi — cermin status lewat FK CASCADE.
    expect(tulis("app.mutasi_bank")).toEqual([]);
  });

  it("super admin boleh (break-glass §10.11)", async () => {
    h.sesi.role = "super_admin";
    h.sesi.email = "root@solagroup.co";
    expect(await tarikRekeningKoran(masukan)).toMatchObject({ ok: true });
  });

  it("🔴 U12: bulan rekening koran SUDAH DITUTUP ⇒ ditolak tanpa UPDATE; kunci bersama bulan diambil SEBELUM tutup_bulan dibaca", async () => {
    h.state.jawab = (q, p) =>
      q.includes("FROM app.tutup_bulan") ? { rows: (p[1] as string[]).includes("2027-03-01") ? [{ bulan: "2027-03" }] : [] } : dbTarik(q);
    const r = await tarikRekeningKoran(masukan);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/Bulan 2027-03 sudah ditutup/);
    expect(tulis("app.rekening_koran")).toEqual([]);
    expect(sql()).not.toContain("COMMIT");
    const kunci = h.log.findIndex((l) => l.sql.includes("pg_advisory_xact_lock_shared") && l.sql.includes("tutup-bulan:"));
    const baca = h.log.findIndex((l) => l.sql.includes("FROM app.tutup_bulan"));
    expect(kunci).toBeGreaterThanOrEqual(0);
    expect(kunci).toBeLessThan(baca);
    expect(h.log[kunci]!.params).toEqual([2, "2027-03"]);
  });

  it("bulan lain yang tertutup tidak menahan tarikan bulan terbuka", async () => {
    h.state.jawab = (q, p) =>
      q.includes("FROM app.tutup_bulan") ? { rows: (p[1] as string[]).includes("2027-02-01") ? [{ bulan: "2027-02" }] : [] } : dbTarik(q);
    expect(await tarikRekeningKoran(masukan)).toMatchObject({ ok: true });
  });

  it("sudah ditarik / tak ditemukan / kode alasan asing / catatan kosong ⇒ ditolak tanpa UPDATE", async () => {
    rk = { ...rk!, status: "ditarik" };
    expect(await tarikRekeningKoran(masukan)).toMatchObject({ ok: false });
    rk = null;
    expect(await tarikRekeningKoran(masukan)).toMatchObject({ ok: false });
    rk = { id: RK_LAMA, status: "aktif", periode: "2027-03", accountId: AKUN };
    kode = false;
    expect(await tarikRekeningKoran(masukan)).toMatchObject({ ok: false });
    kode = true;
    expect(await tarikRekeningKoran({ ...masukan, catatan: "  " })).toMatchObject({ ok: false });
    expect(await tarikRekeningKoran({ ...masukan, reasonCode: "ADJ-FWD-IMPORT" })).toMatchObject({ ok: false });
    expect(tulis("app.rekening_koran")).toEqual([]);
  });
});

function urutanLog(a: string, b: string): boolean {
  const i = h.log.findIndex((l) => l.sql.includes(a));
  const j = h.log.findIndex((l) => l.sql.includes(b));
  return i >= 0 && j >= 0 && i < j;
}
