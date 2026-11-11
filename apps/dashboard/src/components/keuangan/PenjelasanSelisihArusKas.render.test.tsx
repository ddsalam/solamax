import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CEK_26_OKT, HARI_BAKAU_OKT } from "@/lib/__fixtures__/bakau-26-okt-selisih-arus";
import {
  jelaskanSelisihArusKas,
  TEKS_AKSI_PIUTANG_WAKTU,
  TEKS_SISA_DI_LUAR_TOLERANSI,
} from "@/lib/selisih-arus-kas-model";
import type { KelengkapanInput } from "@/lib/keuangan-input-queries";
import { PenjelasanSelisihArusKas } from "./PenjelasanSelisihArusKas";

// Panel mengimpor server action; jalur DB-nya tak dipakai di render.
vi.mock("@/lib/tutup-hari-actions", () => ({ tutupHari: vi.fn() }));
const { TutupHariPanel } = await import("./TutupHariPanel");

/** Tampilan U3 (R1, R3–R5, R8) — angka NYATA Bakau 26/29/30 Okt, vonis ASLI. */

const teks = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
const ae1 = jelaskanSelisihArusKas({ date: "2026-10-26", check: CEK_26_OKT, hari: HARI_BAKAU_OKT })!;

describe("PenjelasanSelisihArusKas", () => {
  it("AE1 Bakau 26 Okt: −123.196.000 + −354 = −123.196.354; petunjuk 29 Okt (3 baris); tindakan untuk Finance", () => {
    const html = renderToStaticMarkup(<PenjelasanSelisihArusKas penjelasan={ae1} />);
    const t = teks(html);
    expect(html).toContain('class="banner warning keu-banner"');
    expect(html).toContain('role="status"');
    expect(t).toContain("-123.196.000");
    expect(t).toContain("-354");
    expect(t).toContain("-123.196.354");
    expect(t).toContain("EasyMax mencatat pembayaran piutang Rp 123.196.000 (3 baris) pada 29 Okt");
    expect(t).toContain("PLG0607 86.136.000, PLG0609 26.849.200, PLG0607 10.210.800");
    expect(t).toContain("a8b2f689 Bank BCA …6811");
    expect(t).toContain(TEKS_AKSI_PIUTANG_WAKTU);
    // "memorial" hanya muncul di larangan.
    expect(t.match(/memorial/g)).toHaveLength(1);
    expect(t).toContain("Jangan menutup selisih ini dengan jurnal memorial");
    expect(html).not.toContain("di luar toleransi");
  });

  it("galat bacaan ⇒ role=alert, tanpa baris penjelasan", () => {
    const html = renderToStaticMarkup(<PenjelasanSelisihArusKas penjelasan={{ galat: "koneksi putus" }} />);
    expect(html).toContain('role="alert"');
    expect(teks(html)).toContain("Penjelasan selisih tidak bisa dimuat: koneksi putus");
    expect(html).not.toContain("data-baris");
  });

  it("AE3 cek −217 tanpa piutang ⇒ nada info, tanpa kalimat tindakan", () => {
    const p = jelaskanSelisihArusKas({ date: "2026-10-27", check: -217, hari: [] })!;
    const html = renderToStaticMarkup(<PenjelasanSelisihArusKas penjelasan={p} />);
    expect(html).toContain('class="banner info keu-banner"');
    expect(teks(html)).toContain("-217");
    expect(html).not.toContain("data-aksi");
    expect(teks(html)).not.toContain(TEKS_AKSI_PIUTANG_WAKTU);
  });

  it("AE4 sisa di luar toleransi ⇒ pil teks + kalimat telusuri, tanpa kalimat ubah tanggal", () => {
    const p = jelaskanSelisihArusKas({ date: "2026-10-27", check: -25_000, hari: [] })!;
    const html = renderToStaticMarkup(<PenjelasanSelisihArusKas penjelasan={p} />);
    expect(html).toContain('<span class="keu-pill">di luar toleransi</span>');
    expect(teks(html)).toContain(TEKS_SISA_DI_LUAR_TOLERANSI);
    expect(teks(html)).not.toContain(TEKS_AKSI_PIUTANG_WAKTU);
  });
});

describe("TutupHariPanel — blok penjelasan hanya bila diberikan", () => {
  const kelengkapan: KelengkapanInput = {
    hargaBeliLengkap: true,
    produkTanpaHarga: 0,
    adaAkunKas: true,
    settlementBelumCair: 0,
    biayaMenungguTinjauan: 0,
    edcBelumDiposting: { sel: [], kartuTanpaPeta: [], totalRp: 0 },
  };
  const render = (penjelasanArusKas?: Parameters<typeof TutupHariPanel>[0]["penjelasanArusKas"]) =>
    renderToStaticMarkup(
      <TutupHariPanel
        code="6478111"
        date="2026-10-26"
        langkahHarian={-354}
        cashFlowCheck={CEK_26_OKT}
        kelengkapan={kelengkapan}
        reasonCodes={[]}
        overrides={[]}
        sudahDitutup={false}
        bolehMenutupTier
        koreksiSusulan={0}
        {...(penjelasanArusKas === undefined ? {} : { penjelasanArusKas })}
      />,
    );

  it("null ⇒ markup identik dengan panel tanpa prop (kartu Cash flow check tak berubah)", () => {
    const tanpa = render();
    expect(render(null)).toBe(tanpa);
    expect(tanpa).not.toContain("data-penjelasan-arus-kas");
    expect(teks(tanpa)).toContain("Arus tidak cocok dengan saldo buku.");
  });

  it("diberi penjelasan ⇒ blok tampil di antara kartu syarat dan koreksi susulan", () => {
    const html = render(ae1);
    const i = html.indexOf("data-penjelasan-arus-kas");
    expect(i).toBeGreaterThan(html.indexOf("Kelengkapan input"));
    expect(i).toBeLessThan(html.indexOf("data-koreksi-susulan"));
    expect(teks(html)).toContain("Arus tidak cocok dengan saldo buku.");
  });
});
