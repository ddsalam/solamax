import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hariDalamBulan, periksaTutupBulan, type MasukanTutupBulan } from "@/lib/tutup-bulan-model";
import type { BarisMaju, BarisParkirTampil } from "@/lib/tutup-bulan-queries";
import { TutupBulanPeriksa } from "./TutupBulanPeriksa";
import { TutupHariSusulan } from "./TutupHariSusulan";

/** Tampilan U12 (R24, R25, R32) — data SINTETIS, vonis ASLI. */

const BCA = "11111111-1111-4111-8111-111111111111";
const P = "88888888-8888-4888-8888-888888888888";

const lengkap = (o: Partial<MasukanTutupBulan> = {}): MasukanTutupBulan => ({
  bulan: "2026-10",
  hariTertutup: hariDalamBulan("2026-10"),
  parkir: [],
  rekening: [{ id: BCA, nama: "Bank BCA - 1234567890", cutOver: "2026-10-01", rekeningKoranAktif: true }],
  impor: [],
  buku: [],
  ...o,
});

const parkir: BarisParkirTampil = {
  id: "p1",
  accountId: BCA,
  tanggalBank: "2026-10-15",
  businessDate: "2026-10-15",
  amountSen: -500_000_000_00,
  keterangan: "Diparkir — DB tanpa keterangan",
  sudahDipindah: false,
  alasanMaju: null,
  lahirDariCocokId: null,
  rekening: "Bank BCA - 1234567890",
};

describe("TutupBulanPeriksa — empat baris, OK atau hitungan + tautan", () => {
  it("semua OK ⇒ empat baris OK", () => {
    const html = renderToStaticMarkup(<TutupBulanPeriksa code="6378301" bulan="2026-10" vonis={periksaTutupBulan(lengkap())} />);
    expect(html.match(/data-syarat=/g)).toHaveLength(4);
    expect(html.match(/tutup-syarat baik/g)).toHaveLength(4);
  });

  it("penghalang ⇒ hitungan + tautan ke layar yang menyelesaikannya", () => {
    const v = periksaTutupBulan(
      lengkap({
        hariTertutup: hariDalamBulan("2026-10").filter((d) => d !== "2026-10-17"),
        parkir: [parkir],
        rekening: [{ id: BCA, nama: "Bank BCA - 1234567890", cutOver: "2026-10-01", rekeningKoranAktif: false }],
        buku: [
          {
            id: "kaki", accountId: BCA, businessDate: "2026-10-09", tanggalAsal: null, amountSen: 25_000_000_00, void: false,
            saldoAwal: false, dicocokkan: false, alasanMaju: null, lahirDariCocokId: null, pasanganUuid: P,
            keterangan: "Antar unit dari Kotabaru", categoryLabel: "Hutang Piutang",
          },
        ],
      }),
    );
    const html = renderToStaticMarkup(<TutupBulanPeriksa code="6378301" bulan="2026-10" vonis={v} />);
    expect(html.match(/tutup-syarat buruk/g)).toHaveLength(4);
    expect(html).toContain('href="/keuangan/unit/6378301/tutup-hari/2026-10-17"');
    expect(html).toContain('href="/keuangan/unit/6378301/impor-bank/2026-10"');
    expect(html).toContain('href="/keuangan/unit/6378301/impor-bank"');
    expect(html).toContain("1 hari belum");
    // ⚠️ isu terbuka U11 — kaki antar unit DIKENALI di daftar.
    expect(html).toContain("kaki antar unit tanpa mutasi bank");
    expect(html).toContain('data-jenis="kaki_antar_unit"');
  });
});

describe("TutupHariSusulan — R24/R32: dua daftar buka-tutup", () => {
  const maju: BarisMaju = {
    id: "k1",
    rekening: "Bank BCA - 1234567890",
    tanggalAsal: "2026-10-02",
    amountSen: 160_000_000_00,
    keterangan: "Transfer pelanggan",
    categoryLabel: "Transfer Pembayaran Piutang Pelanggan",
    alasanMaju: "ADJ-FWD-IMPORT",
    alasanLabel: "Impor rekening koran ke hari tertutup",
    bulanBank: "2026-10",
    pasanganUuid: null,
  };

  it("🔴 AE13: baris maju tampil dengan tanggal asal, kode alasan, tautan sumber; koreksi susulan disebut", () => {
    const html = renderToStaticMarkup(
      <TutupHariSusulan code="6378301" date="2026-11-03" maju={[maju]} parkir={[]} koreksiSusulan={160_000_000} />,
    );
    expect(html).toContain('data-daftar="maju"');
    expect(html).toContain("2026-10-02");
    expect(html).toContain("ADJ-FWD-IMPORT");
    expect(html).toContain('href="/keuangan/unit/6378301/impor-bank/2026-10"');
    expect(html).toContain("160.000.000");
  });

  it("🔴 AE5/R24: tutup hari 15 Okt menampilkan baris yang diparkir, dengan tautan pemindahan", () => {
    const html = renderToStaticMarkup(
      <TutupHariSusulan code="6378301" date="2026-10-15" maju={[]} parkir={[parkir]} koreksiSusulan={0} />,
    );
    expect(html).toContain('data-daftar="parkir"');
    expect(html).toContain("Diparkir — DB tanpa keterangan");
    expect(html).toContain("-500.000.000");
    expect(html).toContain('href="/keuangan/unit/6378301/tutup-bulan/2026-10"');
    expect(html).toMatch(/<details[^>]*open=""[^>]*data-daftar="parkir"/);
  });
});
