import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PiutangPelangganView,
  type PiutangPelangganViewProps,
} from "./PiutangPelangganView";

const angka = {
  piutangLokalAwal: 125_000,
  piutangLokalAkhir: 100_000,
  piutangOnlineAwal: 50_000,
  piutangOnlineAkhir: 75_000,
  hutangLokalAwal: -20_000,
  hutangLokalAkhir: -10_000,
};

type ReadyProps = Extract<PiutangPelangganViewProps, { state: "ready" }>;

const ready = (o: Partial<Omit<ReadyProps, "state">> = {}): ReadyProps => ({
  state: "ready",
  unit: { code: "IB", name: "Imam Bonjol" },
  date: "2026-09-09",
  detailBaseUrl: "/keuangan/unit/IB/piutang/2026-09-09/pelanggan",
  hasOnlineCustomer: true,
  query: {
    search: "",
    filter: "semua",
    sort: "default",
    page: 1,
    pageSize: 50,
    totalRows: 2,
    totalPages: 1,
  },
  provenance: {
    formulaVersion: "saldo-pelanggan-v1",
    computedAtLabel: "9 September 2026, 23.17 WIB",
    sourceCutLabel: "Siklus sumber selesai 9 September 2026, 23.10 WIB",
  },
  totals: angka,
  rows: [
    { customerCode: "A-001", customerName: "Andi", balances: angka },
    {
      customerCode: "NOL/02",
      customerName: "Budi Saldo Nol",
      balances: {
        piutangLokalAwal: 0,
        piutangLokalAkhir: 0,
        piutangOnlineAwal: 0,
        piutangOnlineAkhir: 0,
        hutangLokalAwal: 0,
        hutangLokalAkhir: 0,
      },
    },
  ],
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
    expect(h.match(/Rp0/g)).toHaveLength(6);
  });

  it("menghilangkan seluruh blok Online saat presence gate false", () => {
    const withoutOnline = html(ready({ hasOnlineCustomer: false }));
    expect(withoutOnline).not.toContain("Piutang Online");
    expect(html(ready({ hasOnlineCustomer: true }))).toContain("Piutang Online");
  });

  it("membawa pencarian, filter, sort, dan halaman melalui form/tautan nyata", () => {
    const h = html(
      ready({
        query: {
          search: "andi",
          filter: "bersaldo",
          sort: "nama",
          page: 2,
          pageSize: 50,
          totalRows: 121,
          totalPages: 3,
        },
      }),
    );
    expect(h).toContain('<form method="get"');
    expect(h).toContain('name="q"');
    expect(h).toContain('value="andi"');
    expect(h).toContain('name="sort"');
    expect(h).toContain("121 pelanggan · 50 per halaman");
    expect(h).toContain("Halaman 2 dari 3");
    expect(h).toContain("page=3");
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
