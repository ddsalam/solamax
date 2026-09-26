"use client";

import { bacaRupiah } from "@/lib/angka-input";
import { PratinjauAngka } from "./PratinjauAngka";
import { useState, useTransition } from "react";
import { tambahBiayaFinance } from "@/lib/biaya-actions";
import { reklasifikasiBiaya } from "@/lib/reklas-actions";
import type { ReklasBaris } from "@/lib/keuangan-input-queries";
import {
  AKUN_REKLAS,
  dampakLaba,
  jenisAkun,
  labelAkun,
  membentukLaba,
  type SeksiBiaya,
} from "@/lib/keuangan-reklas";
import {
  belumBerakun,
  LABEL_TINDAKAN,
  menungguTinjauan,
  tindakanTersedia,
  totalPerPintu,
  nilaiBertanda,
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
 *
 * §10.29 — **Reklasifikasi** kini tombol sungguhan: memindahkan AKUN baris
 * pengawas (termasuk ke dua akun bukan-laba: prive/kontribusi & perpindahan
 * dana) lewat baris baru di `app.reclassification`. Barisnya sendiri tidak
 * berubah; riwayatnya tampil di bawah akun.
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
  reklas,
  reasonReklas,
  bolehTulis,
}: {
  code: string;
  date: string;
  baris: BarisBiaya[];
  peta: { category: string; account: string }[];
  /** Riwayat reklasifikasi baris hari ini — terbaru dulu. */
  reklas: ReklasBaris[];
  /** Kode alasan grup `reclass` (§10.2). */
  reasonReklas: { code: string; label: string }[];
  bolehTulis: boolean;
}) {
  const [reklasId, setReklasId] = useState<string | null>(null);
  const [akunKe, setAkunKe] = useState("");
  const [alasanReklas, setAlasanReklas] = useState("");
  const [catatanReklas, setCatatanReklas] = useState("");
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

  const riwayatDari = (id: string): ReklasBaris[] => reklas.filter((r) => r.sourceTxnId === id);

  const bukaReklas = (id: string): void => {
    setErr(null);
    setMsg(null);
    setReklasId(id);
    setAkunKe("");
    setAlasanReklas("");
    setCatatanReklas("");
  };

  const simpanReklas = (b: BarisBiaya): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await reklasifikasiBiaya({
        code,
        date,
        entryId: b.id,
        toAccount: akunKe,
        reasonCode: alasanReklas,
        note: catatanReklas,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`“${b.keterangan}” kini di akun ${labelAkun(akunKe)}. Baris pengawasnya tidak berubah.`);
        setReklasId(null);
      }
    });
  };

  const formReklas = (b: BarisBiaya) => {
    const pilihan = AKUN_REKLAS.filter(
      (a) => a.untuk.includes(b.section as SeksiBiaya) && a.kode !== b.accountingAccount,
    );
    const bukanLaba = pilihan.filter((a) => !membentukLaba(a.jenis));
    const laba = pilihan.filter((a) => membentukLaba(a.jenis));
    const tujuan = AKUN_REKLAS.find((a) => a.kode === akunKe) ?? null;
    const dampak = tujuan === null ? 0 : dampakLaba(b.section, b.accountingAccount, akunKe, b.amount);
    const perluCatatan = tujuan !== null && !membentukLaba(tujuan.jenis);
    return (
      <div className="card card-pad-lg keu-form reklas-form">
        <h4 className="text-h3">Reklasifikasi — {b.keterangan}</h4>
        <p className="fs16 t-tertiary mt2">
          Keterangan, nominal, tanggal, dan kategori pengawas <strong>tidak berubah</strong>. Yang
          berpindah hanya akun akuntansinya — dan karena itu apakah baris ini ikut membentuk laba.
          Sekarang: <strong>{labelAkun(b.accountingAccount)}</strong>.
        </p>
        <div className="keu-2col">
          <label className="keu-fld">
            <span className="keu-label">Akun baru</span>
            <select
              className="manual-input"
              value={akunKe}
              onChange={(e) => {
                setAkunKe(e.target.value);
                const t = AKUN_REKLAS.find((a) => a.kode === e.target.value);
                // Saran alasan: keluar dari laba = sifatnya berbeda.
                if (alasanReklas === "" && t && !membentukLaba(t.jenis)) setAlasanReklas("RCL-NATURE");
              }}
            >
              <option value="">— pilih akun —</option>
              <optgroup label="Bukan beban / bukan pendapatan — tidak masuk laba">
                {bukanLaba.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} {a.nama}
                  </option>
                ))}
              </optgroup>
              <optgroup label={b.section === "pengeluaran" ? "Beban operasional" : "Pendapatan"}>
                {laba.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} {a.nama}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="keu-fld">
            <span className="keu-label">Alasan</span>
            <select
              className="manual-input"
              value={alasanReklas}
              onChange={(e) => setAlasanReklas(e.target.value)}
            >
              <option value="">— pilih alasan —</option>
              {reasonReklas.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} — {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="keu-fld">
          <span className="keu-label">Catatan{perluCatatan ? " (wajib)" : " (opsional)"}</span>
          <input
            className="manual-input"
            value={catatanReklas}
            onChange={(e) => setCatatanReklas(e.target.value)}
            placeholder={
              tujuan?.jenis === "ekuitas"
                ? "contoh: prive ke PT Triguna, atas persetujuan Direktur"
                : tujuan?.jenis === "pindah_dana"
                  ? "contoh: disetor ke BCA oleh Pak Athoi / dibayar pelanggan via transfer"
                  : "contoh: sebenarnya perbaikan genset"
            }
          />
        </label>
        {tujuan !== null && (
          <div className={`banner ${dampak === 0 ? "info" : "warning"} keu-banner`} role="status">
            <b>
              {dampak === 0
                ? "Laba bersih tidak berubah — baris hanya pindah antar akun."
                : `Laba bersih ${date} ${dampak > 0 ? "naik" : "turun"} Rp ${rp(Math.abs(dampak))}.`}
            </b>
            {tujuan.jenis === "ekuitas" && (
              <p className="keu-p">
                Uangnya tetap keluar dari kas — di arus kas ia tampil sebagai prive/kontribusi
                pemilik, bukan biaya operasional.
              </p>
            )}
            {tujuan.jenis === "pindah_dana" && (
              <p className="keu-p">
                Pastikan uangnya tercatat di buku kas/bank Finance (setoran ke bank atau
                penerimaan transfer) — di sanalah perpindahannya dibukukan.
              </p>
            )}
          </div>
        )}
        <div className="manual-form-actions">
          <button
            type="button"
            className="btn-navy"
            onClick={() => simpanReklas(b)}
            disabled={pending || akunKe === "" || alasanReklas === "" || (perluCatatan && catatanReklas.trim().length < 5)}
          >
            {pending ? "Menyimpan…" : "Simpan reklasifikasi"}
          </button>
          <button type="button" className="btn-outline" onClick={() => setReklasId(null)} disabled={pending}>
            Batal
          </button>
        </div>
      </div>
    );
  };

  const hNominal = bacaRupiah(nominal);
  const simpan = (): void => {
    setErr(null);
    setMsg(null);
    if (hNominal.keadaan !== "sah") {
      setErr(hNominal.keadaan === "tolak" ? hNominal.pesan : "Nominal wajib diisi.");
      return;
    }
    const amountRp = hNominal.nilai;
    start(async () => {
      const res = await tambahBiayaFinance({
        code,
        date,
        section,
        keterangan: ket,
        amountRp,
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
        <p className="keu-p">
          <strong>Reklasifikasi</strong> sudah bisa dipakai: pindahkan pos yang bukan biaya
          (prive, setoran ke bank, penjualan via transfer) ke akun bukan-laba. Baris pengawasnya
          tetap utuh. Tindakan lain menyusul.
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
            const riwayat = riwayatDari(b.id);
            const bukanLaba = !membentukLaba(jenisAkun(b.accountingAccount, b.section));
            const bisaReklas = bolehTulis && tindakan.includes("reclassify") && !b.titipanBright;
            return (
              <div key={b.id}>
              <div className="grid-row cols-biaya">
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
                  {b.titipanBright ? (
                    <span className="t-tertiary">titipan outlet Bright — bukan pendapatan</span>
                  ) : b.accountingAccount === null ? (
                    <span className="t-danger">belum dipetakan</span>
                  ) : (
                    labelAkun(b.accountingAccount)
                  )}
                  {bukanLaba && !b.void && <span className="keu-chip nada-kuning">tidak masuk laba</span>}
                  {riwayat.length > 0 && (
                    <span className="keu-p t-tertiary">
                      direklasifikasi {riwayat.length}× · semula {labelAkun(b.akunAsli)} · terakhir{" "}
                      {riwayat[0]!.waktu}
                      {riwayat[0]!.oleh !== null && ` oleh ${riwayat[0]!.oleh}`} · {riwayat[0]!.reasonCode}
                      {riwayat[0]!.note !== null && ` · ${riwayat[0]!.note}`}
                    </span>
                  )}
                </span>
                <span className={`right num ${nilaiBertanda(b) < 0 ? "t-danger" : ""}`}>
                  {rp(nilaiBertanda(b))}
                </span>
                <span className="fs16 t-secondary">
                  {b.void ? "dibatalkan" : b.status === "closed" ? "disahkan · terkunci" : b.status}
                </span>
                <span className="fs16 t-tertiary">
                  {/* Tak ada "Edit" di sini, dan tak akan pernah ada. */}
                  {bisaReklas ? (
                    <button
                      type="button"
                      className="btn-outline sm"
                      disabled={pending}
                      onClick={() => (reklasId === b.id ? setReklasId(null) : bukaReklas(b.id))}
                    >
                      Reklasifikasi
                    </button>
                  ) : tindakan.length === 0 ? (
                    "—"
                  ) : (
                    tindakan.map((t) => LABEL_TINDAKAN[t]).join(" · ")
                  )}
                </span>
              </div>
              {reklasId === b.id && formReklas(b)}
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
                placeholder="contoh 250.000"
              />
              <PratinjauAngka hasil={hNominal} />
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
            <button
              type="button"
              className="btn-navy"
              onClick={simpan}
              disabled={pending || hNominal.keadaan === "tolak"}
            >
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
