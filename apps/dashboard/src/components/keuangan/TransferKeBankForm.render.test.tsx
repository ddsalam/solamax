import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AkunKas, BarisBuku } from "@/lib/keuangan-kas-model";

/**
 * Tampilan transfer Kas Besar → bank (rencana 2026-11-11 U4/U6; R1, R10).
 * Render STATIS (repo tanpa jsdom): yang diuji adalah apa yang tampil pada
 * keadaan awal. Kiriman ganda dijaga di server (kunci idempotensi, uji
 * integrasi), bukan oleh uji ini.
 */
vi.mock("@/lib/transfer-kas-actions", () => ({ catatTransferKeBank: vi.fn(), batalkanTransfer: vi.fn(), jadikanTransfer: vi.fn() }));
vi.mock("@/lib/kas-actions", () => ({ setujuiSetoran: vi.fn(), simpanMutasiBeban: vi.fn(), simpanMutasiKas: vi.fn(), voidMutasiKas: vi.fn(), pecahMutasi: vi.fn() }));
vi.mock("@/lib/edc-actions", () => ({ batalkanPencairan: vi.fn() }));
vi.mock("@/lib/penebusan-actions", () => ({ simpanPenebusan: vi.fn() }));

const { TransferKeBankForm } = await import("./TransferKeBankForm");
const { BukuKasPanel } = await import("./BukuKasPanel");

const KAS: AkunKas = { id: "akun-kas", nama: "Kas Besar", kind: "kas", active: true };
const BCA: AkunKas = { id: "akun-bca", nama: "BCA …6811", kind: "bank", active: true };
const BNI: AkunKas = { id: "akun-bni", nama: "BNI …0001", kind: "bank", active: false };
const D = "2026-11-03";
const KUNCI = "6f1c0b8e-2a4d-4c3b-9e1f-0a2b3c4d5e6f";

const baris = (o: Partial<BarisBuku> & Pick<BarisBuku, "id" | "amount">): BarisBuku => ({
  accountId: KAS.id,
  businessDate: D,
  jenis: o.amount < 0 ? "kredit" : "debet",
  categorySide: o.amount < 0 ? "kredit" : "debet",
  categoryLabel: "Setoran ke Bank",
  saldoAwal: false,
  void: false,
  keterangan: "Setoran ke Bank",
  saldoBerjalan: 0,
  dariSetoranPengawas: false,
  barisSistem: null,
  ...o,
});

const panel = (o: { akun?: AkunKas[]; bolehTulis?: boolean; buku?: BarisBuku[]; nKoreksi?: number } = {}) => {
  const akun = o.akun ?? [KAS, BCA];
  return renderToStaticMarkup(
    <BukuKasPanel
      code="6378301"
      date={D}
      akun={akun}
      bukuPerAkun={{ [akun[0]!.id]: o.buku ?? [] }}
      saldoAwalPerAkun={{}}
      kakiPerAkun={{}}
      kategori={[]}
      tawaran={[]}
      nilaiTertunda={0}
      bolehTulis={o.bolehTulis ?? true}
      bolehSettlement={false}
      pihakLawan={[]}
      nKoreksiTransfer={o.nKoreksi ?? 0}
    />,
  );
};

describe("BukuKasPanel — tombol 'Setor ke bank…' (R1)", () => {
  it("tampil di tab Kas Besar bagi yang boleh mengetik", () => {
    expect(panel()).toContain("Setor ke bank…");
  });
  it("tidak tampil bagi yang tak boleh mengetik", () => {
    expect(panel({ bolehTulis: false })).not.toContain("Setor ke bank…");
  });
  it("tidak tampil di tab bank", () => {
    expect(panel({ akun: [BCA] })).not.toContain("Setor ke bank…");
  });
});

describe("BukuKasPanel — kaki transfer tampil berpasangan (R10)", () => {
  it("kaki transfer: chip 'transfer' + 'Batalkan transfer', bukan 'Batalkan' tunggal", () => {
    const html = panel({ buku: [baris({ id: "k1", amount: -399_979_000, barisSistem: "transfer", transferUuid: KUNCI })] });
    expect(html).toContain(">transfer<");
    expect(html).toContain("Batalkan transfer");
    expect(html).not.toMatch(/>Batalkan<\/button>/);
  });
  it("baris biasa tetap 'Batalkan'", () => {
    const html = panel({ buku: [baris({ id: "k2", amount: -5_000 })] });
    expect(html).toMatch(/>Batalkan<\/button>/);
    expect(html).not.toContain("Batalkan transfer");
  });
  it("tanpa hak tulis: kolom Tindakan tak ada (seperti baris sistem lain), tombol tidak tampil", () => {
    const html = panel({ bolehTulis: false, buku: [baris({ id: "k1", amount: -1, barisSistem: "transfer", transferUuid: KUNCI })] });
    expect(html).not.toContain("Tindakan");
    expect(html).not.toContain("Batalkan transfer");
  });
});

describe("BukuKasPanel — tautan daftar koreksi (U6)", () => {
  it("tab bank + ada calon ⇒ tautan ke halaman koreksi", () => {
    const html = panel({ akun: [BCA], nKoreksi: 31 });
    expect(html).toContain("31 baris bank tampaknya transfer dari Kas Besar — koreksi");
    expect(html).toContain('href="/keuangan/unit/6378301/koreksi-transfer"');
  });
  it("tab Kas Besar atau tanpa calon ⇒ tak ada tautan", () => {
    expect(panel({ nKoreksi: 31 })).not.toContain("data-koreksi-transfer");
    expect(panel({ akun: [BCA], nKoreksi: 0 })).not.toContain("data-koreksi-transfer");
  });
});

describe("TransferKeBankForm (R2, R8)", () => {
  const form = (akunBank: AkunKas[]) =>
    renderToStaticMarkup(<TransferKeBankForm code="6378301" date={D} akunBank={akunBank} onSelesai={() => {}} />);

  it("judul, rekening tujuan, keterangan terisi 'Setoran ke Bank {tanggal}'", () => {
    const html = form([BCA, BNI]);
    expect(html).toContain("Setor dari Kas Besar ke bank");
    expect(html).toContain("BCA …6811");
    expect(html).toContain(`value="Setoran ke Bank ${D}"`);
  });
  it("tombol 'Simpan transfer' nonaktif sampai nominal & rekening diisi", () => {
    expect(form([BCA])).toMatch(/<button[^>]*disabled=""[^>]*>Simpan transfer<\/button>/);
  });
  it("tanpa rekening bank aktif ⇒ peringatan, bukan form kosong", () => {
    expect(form([])).toContain("belum punya rekening bank aktif");
  });
});
