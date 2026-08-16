"use client";

import { useState, useTransition } from "react";
import { tambahBiayaFinance } from "@/lib/biaya-actions";
import {
  belumBerakun,
  LABEL_TINDAKAN,
  menungguTinjauan,
  tindakanTersedia,
  totalPerPintu,
  type BarisBiaya,
} from "@/lib/keuangan-biaya-model";

/**
 * Blok 4 Layar 3 — Biaya operasional & pendapatan lain-lain (mockup layar 3).
 *
 * ⛔ **TIDAK ADA TOMBOL EDIT GENERIK**, sekarang maupun nanti (§2.3). Baris dari
 * Rincian Penjualan tampil **read-only** dengan keping asal-usulnya. Yang
 * tersedia hanya empat tindakan bernama, dan masing-masing meninggalkan jejak
 * berbeda — putaran ini menampilkannya sebagai tindakan yang AKAN tersedia,
 * belum menjalankannya.
 *
 * ⛔ **DUA KOLOM, DUA PEMILIK** (§2.1): kategori operasional dipilih pengawas
 * dan tidak bisa disentuh Finance; akun akuntansi dipetakan otomatis dari
 * kategori itu, dan reklasifikasi menanganinya secara teraudit.
 */

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const KATEGORI = [
  "Iklan, Promosi, Spanduk",
  "Transportasi / Kendaraan Milik Perusahaan",
  "Supir Tangki",
  "Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)",
  "Sumbangan / Donasi",
  "Komputer dan Internet",
  "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)",
  "Konsumsi Makanan, Lembur, & Hiburan",
  "Peralatan Kantor (ATK)",
  "Biaya Taktis",
  "Gaji Karyawan",
  "Lain-Lain",
  "MDR",
  "Biaya Admin",
] as const;

export function BiayaPanel({
  code,
  date,
  baris,
  peta,
  bolehTulis,
}: {
  code: string;
  date: string;
  baris: BarisBiaya[];
  peta: { category: string; account: string }[];
  bolehTulis: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [section, setSection] = useState<"pengeluaran" | "pendapatan_lain">("pengeluaran");
  const [ket, setKet] = useState("");
  const [nominal, setNominal] = useState("");
  const [kategori, setKategori] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = totalPerPintu(baris);
  const tunggu = menungguTinjauan(baris);
  const tanpaAkun = belumBerakun(baris);
  const akunDari = (k: string): string | null =>
    peta.find((p) => p.category === k)?.account ?? null;

  const simpan = (): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await tambahBiayaFinance({
        code,
        date,
        section,
        keterangan: ket,
        amountRp: Number(nominal.replace(/[^\d]/g, "")),
        operationalCategory: kategori,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Tersimpan lewat pintu Finance — asal-usulnya tercatat pada barisnya.");
        setKet("");
        setNominal("");
        setKategori("");
        setBuka(false);
      }
    });
  };

  return (
    <section aria-labelledby="blok-biaya">
      <div className="section-h">
        <h3 id="blok-biaya" className="text-h3">
          4 · Biaya operasional &amp; pendapatan lain-lain
        </h3>
        <span className="fs16 t-tertiary">
          Fakta transaksi milik pengawas · klasifikasi akuntansi milik Finance
        </span>
      </div>

      <div className="banner info keu-banner" role="status">
        <b>Finance tidak punya tombol Edit di sini</b>
        <p className="keu-p">
          Transaksi yang dicatat pengawas tidak bisa ditimpa. Yang tersedia hanya empat
          tindakan eksplisit: <strong>{Object.values(LABEL_TINDAKAN).join(" · ")}</strong>.
          Dua kolom terpisah menjaga batasnya — kategori operasional dipilih pengawas, akun
          akuntansi jadi tanggung jawab Finance.
        </p>
      </div>

      {tanpaAkun.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>{tanpaAkun.length} baris belum punya akun akuntansi</b>
          <p className="keu-p">
            Beban tanpa akun tetap beban — ia tidak hilang dari total, tetapi belum punya
            tempat di Income Statement.
          </p>
        </div>
      )}

      {msg !== null && (
        <div className="banner info keu-banner" role="status">
          {msg}
        </div>
      )}
      {err !== null && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}

      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-biaya">
          <span>Keterangan</span>
          <span>Kategori operasional · pengawas</span>
          <span>Akun akuntansi (CoA) · Finance</span>
          <span className="right">Nominal</span>
          <span>Status</span>
          <span>Tindakan</span>
        </div>
        {baris.length === 0 ? (
          <div className="empty-inline">
            Belum ada biaya atau pendapatan lain-lain pada tanggal ini.
          </div>
        ) : (
          baris.map((b) => {
            const tindakan = tindakanTersedia(b);
            return (
              <div className="grid-row cols-biaya" key={b.id}>
                <span className="w600">
                  {b.keterangan}
                  {/* Keping asal-usul — direkam saat penulisan (0034). */}
                  <span className="keu-chip">
                    {b.sourceDoor === "pengawas" ? "dari Rincian Penjualan" : "pintu Finance"}
                  </span>
                </span>
                <span className="fs16 t-secondary">
                  {b.operationalCategory ?? (
                    <span className="t-tertiary">belum berkategori</span>
                  )}
                </span>
                <span className="fs16 t-secondary">
                  {b.accountingAccount ?? <span className="t-danger">belum dipetakan</span>}
                </span>
                <span className={`right num ${b.amount < 0 ? "t-danger" : ""}`}>
                  {rp(b.amount)}
                </span>
                <span className="fs16 t-secondary">
                  {b.void ? "dibatalkan" : b.status === "closed" ? "disahkan · terkunci" : b.status}
                </span>
                <span className="fs16 t-tertiary">
                  {/* Daftar tindakan yang AKAN tersedia. Tak ada "Edit" di sini,
                      dan tak akan pernah ada. */}
                  {tindakan.length === 0
                    ? "—"
                    : tindakan.map((t) => LABEL_TINDAKAN[t]).join(" · ")}
                </span>
              </div>
            );
          })
        )}
        <div className="grid-total cols-biaya">
          <span>
            {baris.filter((b) => !b.void).length} baris · {tunggu.length} menunggu tinjauan
          </span>
          <span className="fs16 t-tertiary">pengawas {rp(total.pengawas)}</span>
          <span className="fs16 t-tertiary">Finance {rp(total.finance)}</span>
          <span className="right num">{rp(total.pengawas + total.finance)}</span>
          <span />
          <span />
        </div>
      </div>

      {bolehTulis && !buka && (
        <div className="manual-form-actions">
          <button type="button" className="btn-tint sm" onClick={() => setBuka(true)}>
            Tambah biaya yang tidak lewat pengawas…
          </button>
        </div>
      )}

      {bolehTulis && buka && (
        <div className="card card-pad-lg keu-form">
          <h4 className="text-h3">Tambah lewat pintu Finance</h4>
          <p className="fs16 t-tertiary mt2">
            Barisnya akan ditandai berasal dari Finance, bukan dari Rincian Penjualan — dan
            tanda itu tidak berubah kelak, apa pun peran Anda nanti.
          </p>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Jenis</span>
              <select
                className="manual-input"
                value={section}
                onChange={(e) => setSection(e.target.value as "pengeluaran" | "pendapatan_lain")}
              >
                <option value="pengeluaran">Biaya operasional</option>
                <option value="pendapatan_lain">Pendapatan lain-lain</option>
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nominal</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
          <label className="keu-fld">
            <span className="keu-label">Keterangan</span>
            <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
          </label>
          <label className="keu-fld">
            <span className="keu-label">Kategori operasional</span>
            <select
              className="manual-input"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
            >
              <option value="">— pilih kategori —</option>
              {KATEGORI.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className="fs16 t-tertiary">
              {kategori === ""
                ? "Akun akuntansinya dipetakan otomatis dari kategori — tidak diketik."
                : `Akan dipetakan ke akun ${akunDari(kategori) ?? "— belum ada pemetaan"}`}
            </span>
          </label>
          <div className="manual-form-actions">
            <button type="button" className="btn-navy" onClick={simpan} disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setBuka(false)}
              disabled={pending}
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
