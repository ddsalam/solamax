import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "./auth-context";

/**
 * Penjaga aksi transfer Kas Besar → bank (rencana 2026-11-11 U3/U6; R1, R4,
 * R8, R17; KTD5, KTD7). DB TIRUAN untuk gerbang & pemetaan hasil: "ditolak" =
 * tak ada `pool.connect()`. Perilaku tulisnya dibuktikan
 * `transfer-kas.integration.test.ts` (Postgres lokal sekali pakai).
 */

const t = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@solagroup.co";
  const log: string[] = [];
  const ctx = { role: "keuangan" as Role, email: "staf@solagroup.co" as string | null };
  const hasil = { catat: null as unknown, galat: null as unknown };
  const client = {
    query: async (sql: string) => {
      log.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  return { log, ctx, hasil, connect };
});

vi.mock("./db", () => ({ pool: { connect: t.connect }, qScoped: vi.fn(), q: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./buku-besar-tulis", () => ({ bentukJurnalSesudahTulis: vi.fn(async () => ({ dibentuk: [], dilewati: [], gagal: [] })) }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: t.ctx.role,
    email: t.ctx.email,
    requireUnit(code: string) {
      if (code !== "6300001") throw new Error("NEXT_NOT_FOUND");
      return { unit_id: 2, code, name: "Contoh" };
    },
  })),
}));
vi.mock("./transfer-kas-tulis", async (asli) => {
  const m = await asli<typeof import("./transfer-kas-tulis")>();
  return {
    ...m,
    tulisTransferKeBank: vi.fn(async () => {
      if (t.hasil.galat) throw t.hasil.galat;
      return t.hasil.catat;
    }),
    tulisBatalTransfer: vi.fn(async () => ({ ok: true, kaki: ["a", "b"], hariBuku: ["2026-11-03"] })),
    tulisJadikanTransfer: vi.fn(async () => ({ ok: true, baru: "n", transferUuid: "u", tanggal: "2026-10-22" })),
  };
});

const { catatTransferKeBank, batalkanTransfer, jadikanTransfer } = await import("./transfer-kas-actions");

const KUNCI = "6f1c0b8e-2a4d-4c3b-9e1f-0a2b3c4d5e6f";
const BANK = "44444444-4444-4444-8444-444444444444";
const TRANSFER = { code: "6300001", date: "2026-11-03", bankAccountId: BANK, amount: 50_000_000, keterangan: "Setoran ke Bank 2026-11-03", kunci: KUNCI };
const sebagai = (role: Role, email: string | null = null) => {
  t.ctx.role = role;
  t.ctx.email = email;
};

beforeEach(() => {
  t.log.length = 0;
  t.connect.mockClear();
  t.hasil.galat = null;
  t.hasil.catat = { ok: true, sudahAda: false, hariBuku: "2026-11-03", maju: false, kasId: "k", bankId: "b", namaBank: "BCA …6811", sen: 5_000_000_000 };
});

describe("gerbang peran — catat & batalkan = mengetik (canInputKeuangan)", () => {
  it.each([
    ["pengawas", null],
    ["direksi", null],
    ["admin_perusahaan", null],
    ["admin_perusahaan", "hof@solagroup.co"],
    ["keuangan", "hof@solagroup.co"],
  ] as const)("🔴 %s (%s) ditolak SEBELUM koneksi", async (role, email) => {
    sebagai(role, email);
    expect((await catatTransferKeBank(TRANSFER)).ok).toBe(false);
    expect((await batalkanTransfer({ code: "6300001", date: "2026-11-03", transferUuid: KUNCI })).ok).toBe(false);
    expect(t.connect).not.toHaveBeenCalled();
  });

  it.each(["keuangan", "super_admin"] as const)("%s boleh: transaksi COMMIT", async (role) => {
    sebagai(role, "staf@solagroup.co");
    const r = await catatTransferKeBank(TRANSFER);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.pesan).toMatch(/Kas Besar −50\.000\.000, BCA …6811 \+50\.000\.000/);
    expect(t.log).toContain("COMMIT");
    expect((await batalkanTransfer({ code: "6300001", date: "2026-11-03", transferUuid: KUNCI })).ok).toBe(true);
  });
});

describe("masukan & idempotensi (R7, R8, KTD5)", () => {
  beforeEach(() => sebagai("keuangan", "staf@solagroup.co"));

  it("nominal ≤ 0 / kunci bukan UUID ditolak sebelum koneksi", async () => {
    expect((await catatTransferKeBank({ ...TRANSFER, amount: 0 })).ok).toBe(false);
    expect((await catatTransferKeBank({ ...TRANSFER, kunci: "x" })).ok).toBe(false);
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("kunci sudah ada ⇒ ok + sudahAda, ROLLBACK (tak menulis)", async () => {
    t.hasil.catat = { ok: true, sudahAda: true };
    const r = await catatTransferKeBank(TRANSFER);
    expect(r).toMatchObject({ ok: true, sudahAda: true });
    expect(t.log).not.toContain("COMMIT");
    expect(t.log).toContain("ROLLBACK");
  });

  it("🔴 kiriman ganda bersamaan: pelanggaran indeks unik 0062 ⇒ 'sudah tercatat', bukan galat", async () => {
    t.hasil.galat = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "cash_ledger_transfer_akun_uq" });
    const r = await catatTransferKeBank(TRANSFER);
    expect(r).toMatchObject({ ok: true, sudahAda: true });
  });

  it("pelanggaran unik LAIN tetap galat", async () => {
    t.hasil.galat = Object.assign(new Error("duplicate key lain"), { code: "23505", constraint: "lain" });
    expect((await catatTransferKeBank(TRANSFER)).ok).toBe(false);
  });

  it("dibukukan maju ⇒ pesan menyebut hari bukunya", async () => {
    t.hasil.catat = { ok: true, sudahAda: false, hariBuku: "2026-11-04", maju: true, kasId: "k", bankId: "b", namaBank: "BCA …6811", sen: 100 };
    const r = await catatTransferKeBank(TRANSFER);
    if (r.ok) expect(r.pesan).toMatch(/hari buku 2026-11-04 karena 2026-11-03 sudah tutup hari/);
  });
});

describe("jadikan transfer — klasifikasi (canJadikanTransfer, KTD7)", () => {
  const J = { code: "6300001", bankId: BANK, kasId: KUNCI, konfirmasi: { yakin: true as const, tanggal: "2026-10-22", nominalSen: 39_997_900_000, rekening4: "6811" } };
  it.each([
    ["pengawas", null],
    ["direksi", null],
  ] as const)("🔴 %s ditolak sebelum koneksi", async (role, email) => {
    sebagai(role, email);
    expect((await jadikanTransfer(J)).ok).toBe(false);
    expect(t.connect).not.toHaveBeenCalled();
  });
  it.each([
    ["keuangan", "staf@solagroup.co"],
    ["admin_perusahaan", "hof@solagroup.co"],
    ["super_admin", null],
  ] as const)("%s (%s) boleh", async (role, email) => {
    sebagai(role, email);
    expect((await jadikanTransfer(J)).ok).toBe(true);
    expect(t.log).toContain("COMMIT");
  });
});

describe("jadikan transfer — konfirmasi eksplisit WAJIB di server (keputusan Dion 11 Nov 2026 17:54 WIB)", () => {
  const J = { code: "6300001", bankId: BANK, kasId: KUNCI };
  const K = { yakin: true as const, tanggal: "2026-10-22", nominalSen: 39_997_900_000, rekening4: "6811" };

  it("🔴 hari terbuka, keuangan, TANPA konfirmasi ⇒ ditolak sebelum koneksi", async () => {
    sebagai("keuangan", "staf@solagroup.co");
    const r = await jadikanTransfer(J);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Konfirmasi wajib/) });
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("🔴 hari tertutup, HoF dengan alasan tertulis, TANPA konfirmasi ⇒ tetap ditolak sebelum koneksi", async () => {
    sebagai("admin_perusahaan", "hof@solagroup.co");
    const r = await jadikanTransfer({ ...J, alasan: "Kaki bank transfer salah kategori. Ref REPORT6/7B." });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Konfirmasi wajib/) });
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("🔴 centang tak benar-benar true (mis. string dari klien rakitan) ⇒ ditolak", async () => {
    sebagai("super_admin", null);
    const r = await jadikanTransfer({ ...J, konfirmasi: { ...K, yakin: "true" } as unknown as typeof K });
    expect(r.ok).toBe(false);
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("dengan konfirmasi ⇒ diterima; konfirmasi diteruskan ke inti tulis (yang mencocokkan & mengauditnya)", async () => {
    sebagai("keuangan", "staf@solagroup.co");
    const { tulisJadikanTransfer } = await import("./transfer-kas-tulis");
    const r = await jadikanTransfer({ ...J, konfirmasi: K });
    expect(r.ok).toBe(true);
    expect(t.log).toContain("COMMIT");
    expect(vi.mocked(tulisJadikanTransfer).mock.lastCall?.[1]).toMatchObject({ bankId: BANK, kasId: KUNCI, konfirmasi: K });
  });
});

describe("teks — kategori dari server, bukan klien (R4)", () => {
  const SRC = readFileSync(resolve(__dirname, "transfer-kas-actions.ts"), "utf8");
  it("aksi tak menerima kategori, sisi, atau tanda dari klien", () => {
    expect(SRC).not.toMatch(/categoryLabel|categorySide|kategori:/);
  });
  it("set_config transaction-local di ketiga aksi", () => {
    expect([...SRC.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(3);
  });
});
