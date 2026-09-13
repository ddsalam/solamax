import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupPiutangRows, type PiutangViewRow } from "@/lib/piutang-model";
import {
  PiutangPelangganView,
  type PiutangPelangganViewProps,
} from "./PiutangPelangganView";

const angka = {
  awal: { piutangLokal: 125_000, piutangOnline: 50_000, hutangLokal: -20_000 },
  akhir: { piutangLokal: 100_000, piutangOnline: 75_000, hutangLokal: -10_000 },
};

type ReadyProps = Extract<PiutangPelangganViewProps, { state: "ready" }>;

const rows: PiutangViewRow[] = [
  { awalPiutangLokalDebet: 125000, awalPiutangLokalKredit: 0, akhirPiutangLokalDebet: 125000, akhirPiutangLokalKredit: 25000,
    awalPiutangOnlineDebet: 0, awalPiutangOnlineKredit: 0, akhirPiutangOnlineDebet: 0, akhirPiutangOnlineKredit: 0,
    awalHutangLokalDebet: 0, awalHutangLokalKredit: 20000, akhirHutangLokalDebet: 10000, akhirHutangLokalKredit: 20000,
    customerCode: "A-001", customerName: "Andi", isZeroBalance: false, bookCount: 2,
    awalPiutangLokal: 125_000, akhirPiutangLokal: 100_000,
    awalPiutangOnline: 0, akhirPiutangOnline: 0,
    awalHutangLokal: -20_000, akhirHutangLokal: -10_000 },
  { awalPiutangLokalDebet: 7.25, awalPiutangLokalKredit: 7.25, akhirPiutangLokalDebet: 7.25, akhirPiutangLokalKredit: 7.25,
    awalPiutangOnlineDebet: 8.5, awalPiutangOnlineKredit: 8.5, akhirPiutangOnlineDebet: 8.5, akhirPiutangOnlineKredit: 8.5,
    awalHutangLokalDebet: 9.75, awalHutangLokalKredit: 9.75, akhirHutangLokalDebet: 9.75, akhirHutangLokalKredit: 9.75,
    customerCode: "NOL/02", customerName: "Budi Saldo Nol", isZeroBalance: true, bookCount: 0,
    awalPiutangLokal: 0, akhirPiutangLokal: 0, awalPiutangOnline: 0,
    akhirPiutangOnline: 0, awalHutangLokal: 0, akhirHutangLokal: 0 },
];
const ready = (o: Partial<Omit<ReadyProps, "state">> = {}): ReadyProps => ({
  state: "ready",
  unit: { code: "IB", name: "Imam Bonjol" },
  date: "2026-09-09",
  detailBaseUrl: "/keuangan/unit/IB/piutang/2026-09-09/pelanggan",
  hasOnlineCustomer: true,
  query: { search: "", filter: "semua", sort: "default", totalRows: 2, occurrenceCount: 3 },
  provenance: {
    formulaVersion: "saldo-pelanggan-v1",
    computedAtLabel: "9 September 2026, 23.17 WIB",
    sourceCutLabel: "Siklus sumber selesai 9 September 2026, 23.10 WIB",
  },
  summary: {
    totals: angka,
    debetTotals: {
      awal: { piutangLokal: 125_000, piutangOnline: 50_000, hutangLokal: 0 },
      akhir: { piutangLokal: 100_000, piutangOnline: 75_000, hutangLokal: 0 },
    },
    kreditTotals: {
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 20_000 },
      akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 10_000 },
    },
  },
  sections: groupPiutangRows(rows, o.hasOnlineCustomer ?? true).map((section) => ({
    ...section, page: 1, pageSize: 50, totalPages: 1, resultCount: section.rows.length,
  })),
  zeroSectionOpen: false,
  csvHref: "/exports/piutang.csv",
  pdfHref: "/exports/piutang.pdf",
  ...o,
});

const html = (props: PiutangPelangganViewProps): string =>
  renderToStaticMarkup(<PiutangPelangganView {...props} />);

describe("PiutangPelangganView", () => {
  it("memisahkan tiga bucket dan menulis dua batas tanggal persis", () => {
    const h = html(ready());
    expect(h).toContain("Daftar Saldo Hutang Piutang per Pelanggan");
    expect(h).toContain("Piutang Lokal");
    expect(h).toContain("Piutang Online");
    expect(h).toContain("Hutang Lokal");
    expect(h).toContain("dtgl &lt; D · s.d. D−1");
    expect(h).toContain("dtgl ≤ D · s.d. D");
    expect(h).toContain("Tiga bucket berbeda; jangan dijumlahkan atau dinetokan.");
    expect(h).not.toContain("Total gabungan");
  });

  it("menampilkan pelanggan nol secara eksplisit, bukan menyembunyikannya", () => {
    const h = html(ready());
    expect(h).toContain("Budi Saldo Nol");
    expect(h).toContain("Saldo nol pada kedua batas");
    const zeroSection = h.slice(h.indexOf('id="piutang-nol"'));
    expect(zeroSection.match(/Rp0/g)).toHaveLength(6);
    expect(zeroSection).toContain("Rp 7,25");
    expect(zeroSection).toContain("Rp 8,5");
    expect(zeroSection).toContain("Rp 9,75");
  });

  it("menghilangkan seluruh blok Online saat presence gate false", () => {
    const withoutOnline = html(ready({ hasOnlineCustomer: false }));
    expect(withoutOnline).not.toContain('id="piutang-online"');
    expect(withoutOnline).not.toContain('aria-label="Ringkasan Piutang Online"');
    expect(html(ready({ hasOnlineCustomer: true }))).toContain("Piutang Online");
  });

  it("membawa pencarian, filter, sort, dan halaman melalui form/tautan nyata", () => {
    const h = html(
      ready({
        query: {
          search: "andi",
          filter: "bersaldo",
          sort: "nama",
          totalRows: 121,
          occurrenceCount: 121,
        },
        sections: ready().sections.map((section) => ({ ...section, page: 2, totalPages: 3, resultCount: 121 })),
      }),
    );
    expect(h).toContain('<form method="get"');
    expect(h).toContain('name="q"');
    expect(h).toContain('value="andi"');
    expect(h).toContain('name="sort"');
    expect(h).toContain("121 pelanggan · 50 per halaman");
    expect(h).toContain("Halaman 2 dari 3");
    expect(h).toContain("page_lokal=3");
    expect(h).toContain("page_hutang=2");
    expect(h).toContain("filter=bersaldo");
    expect(h).toContain("sort=nama");
  });

  it("not-ready adalah keadaan utama tanpa angka, tabel, atau ekspor numerik", () => {
    const h = html({
      state: "not_ready",
      unit: { code: "KB", name: "Kotabaru" },
      date: "2026-09-09",
      detailBaseUrl: "/keuangan/unit/KB/piutang/2026-09-09/pelanggan",
      readiness: {
        kind: "building",
        title: "Data saldo sedang disiapkan",
        reason: "Snapshot tanggal ini belum memiliki generasi lengkap.",
        action: "Unit menunggu pembaruan agent agar siklus sumber dapat dikirim.",
      },
    });
    expect(h).toContain("Data saldo sedang disiapkan");
    expect(h).toContain("Kotabaru");
    expect(h).toContain("9 September 2026");
    expect(h).toContain("menunggu pembaruan agent");
    expect(h).not.toContain("<table");
    expect(h).not.toContain("data-piutang-numeric");
    expect(h).not.toContain("Rp0");
    expect(h).not.toContain("Ekspor CSV");
    expect(h).not.toContain("Unduh PDF");
  });

  it("menampilkan provenance serta banner generasi lama ketika pembaruan tertunda", () => {
    const h = html(
      ready({
        pendingBanner: {
          tone: "warning",
          title: "Data sedang diperbarui—menampilkan data per 8 September 2026",
          body: "Generasi lengkap sebelumnya tetap aktif sampai publikasi baru selesai.",
        },
      }),
    );
    expect(h).toContain("Data sedang diperbarui—menampilkan data per 8 September 2026");
    expect(h).toContain("Formula saldo-pelanggan-v1");
    expect(h).toContain("Siklus sumber selesai 9 September 2026, 23.10 WIB");
  });

  it("mengodekan kode pelanggan pada tautan detail", () => {
    const h = html(ready());
    expect(h).toContain("/pelanggan/NOL%2F02");
  });
});


it("keeps the zero section collapsed by default, accessible and present in the HTML", () => {
  const h = html(ready());
  expect(h).toMatch(/<details[^>]*id="piutang-nol"[^>]*><summary>/);
  expect(h).not.toMatch(/<details[^>]*open=/);
  expect(h).toContain("Tanpa saldo di ketiga buku");
  expect(h).toContain("Budi Saldo Nol");
  expect(html(ready({ zeroSectionOpen: true }))).toMatch(/<details[^>]*open=""/);
});

it("labels multi-book customers and distinguishes unique count from appearances", () => {
  const h = html(ready());
  expect(h.match(/satu pelanggan, dua buku/g)).toHaveLength(2);
  expect(h).toContain("2 pelanggan unik · 3 kemunculan dalam seksi");
});

it("preserves the existing integer rupiah rounding and negative sign", () => {
  const props = ready();
  const h = html({ ...props, summary: { ...props.summary, totals: { ...angka, awal: { ...angka.awal, piutangLokal: 13_052_684_187.5 } } } });
  expect(h).toContain("Rp 13.052.684.188");
  expect(h).toContain("−Rp 20.000");
});


it("shows the audited IB debit/credit totals exactly while keeping saldo rounding", () => {
  // Source: tracked Gerbang A 01-audit.txt, rows 68–70.
  const h = html(ready({
    summary: {
      totals: {
        awal: { piutangLokal: 13052684187.5, piutangOnline: 900000, hutangLokal: -673010538 },
        akhir: { piutangLokal: 13052684187.5, piutangOnline: 900000, hutangLokal: -673010538 },
      },
      debetTotals: {
        awal: { piutangLokal: 122345938294, piutangOnline: 10505841, hutangLokal: 53549062678.5 },
        akhir: { piutangLokal: 122345938294, piutangOnline: 10505841, hutangLokal: 53549062678.5 },
      },
      kreditTotals: {
        awal: { piutangLokal: 109293254106.5, piutangOnline: 9605841, hutangLokal: 54222073216.5 },
        akhir: { piutangLokal: 109293254106.5, piutangOnline: 9605841, hutangLokal: 54222073216.5 },
      },
    },
  }));
  expect(h).toContain("Rp 122.345.938.294");
  expect(h).toContain("Rp 109.293.254.106,5");
  expect(h).toContain("Rp 53.549.062.678,5");
  expect(h).toContain("Rp 54.222.073.216,5");
  expect(h).toContain("Rp 13.052.684.188");
  expect(h).toContain("−Rp 673.010.538");
  expect(h).toContain("Debet"); expect(h).toContain("Kredit"); expect(h).toContain("Saldo");
});

it("shows turnover in an inactive book once while retaining its saldo-based section", () => {
  const row = { ...rows[0]!, awalHutangLokal: 0, akhirHutangLokal: 0,
    awalHutangLokalDebet: 71.25, awalHutangLokalKredit: 71.25,
    akhirHutangLokalDebet: 71.25, akhirHutangLokalKredit: 71.25, bookCount: 1 };
  const props = ready({ sections: groupPiutangRows([row], true).map((section) => ({
    ...section, page: 1, totalPages: 1, pageSize: 50, resultCount: section.rows.length,
  })) });
  const h = html(props);
  expect(h.match(/Rp 71,25/g)).toHaveLength(4);
  const local = h.slice(h.indexOf('id="piutang-lokal"'), h.indexOf('id="piutang-online"'));
  expect(local).toContain("Hutang Lokal · buku bersaldo nol");
  expect(h.slice(h.indexOf('id="piutang-hutang"'))).not.toContain("Rp 71,25");
});
