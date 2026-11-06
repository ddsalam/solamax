"use client";

import { useState, useTransition } from "react";
import { reklasifikasiBiaya } from "@/lib/reklas-actions";
import {
  ajukanBalikBiaya,
  batalkanBiayaFinance,
  setujuiBalikBiaya,
  tarikBalikBiaya,
  tolakBalikBiaya,
} from "@/lib/batal-balik-actions";
import { ALASAN_MIN, dampakBatal } from "@/lib/batal-balik-model";
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
 *
 * K6 U3 (R25) — **tak ada lagi form input pintu Finance** di sini. Biaya &
 * pendapatan lain-lain Finance diinput SEKALI dari Tambah mutasi buku kas/bank
 * (satu simpan menulis mutasi + barisnya); dua pintu input adalah sebab input
 * ganda. Halaman ini meninjau, mereklasifikasi, dan menampilkan.
 *
 * Rencana 2026-11-07 — **Batalkan** baris pintu Finance di hari terbuka: void
 * beralasan (kode grup `void` + alasan tertulis), bukan Edit. Barisnya tetap
 * tampil, dicoret statusnya, beserta siapa, kapan, dan mengapa. Baris pengawas
 * dan baris yang lahir dari mutasi kas tidak ditawari tombolnya — dan server
 * menolaknya juga (`batal-balik-tulis.ts`).
 */

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function BiayaPanel({
  code,
  date,
  baris,
  reklas,
  reasonReklas,
  bolehReklas,
  reasonVoid,
  bolehBatal,
  reasonBalik,
  bolehAjukanBalik,
  bolehSetujuiBalik,
  userId,
}: {
  code: string;
  date: string;
  baris: BarisBiaya[];
  /** Riwayat reklasifikasi baris hari ini — terbaru dulu. */
  reklas: ReklasBaris[];
  /** Kode alasan grup `reclass` (§10.2). */
  reasonReklas: { code: string; label: string }[];
  /**
   * §10.29 — gerbangnya SENDIRI (`canReklasifikasi`): staf Keuangan DAN Head of
   * Finance. Bukan `bolehTulis`, yang menolak HoF (§10.12).
   */
  bolehReklas: boolean;
  /** Kode alasan grup `void` (0059). */
  reasonVoid: { code: string; label: string }[];
  /** Rencana 2026-11-07 KTD7 — `canBatalkanBarisFinance`: staf Keuangan, HoF, super admin. */
  bolehBatal: boolean;
  /** Rilis 2 — kode alasan Balik (grup `adjustment`, `KODE_BALIK`). */
  reasonBalik: { code: string; label: string }[];
  /** `canAjukanBalikBaris` — staf Keuangan, HoF, super admin. */
  bolehAjukanBalik: boolean;
  /** `canSetujuiBalikBaris` — HoF, Direksi, super admin; tetap BUKAN pengajunya sendiri (server + DB). */
  bolehSetujuiBalik: boolean;
  /** Pengguna yang membuka halaman — untuk membedakan pengaju dari penyetuju. */
  userId: number;
}) {
  const [reklasId, setReklasId] = useState<string | null>(null);
  const [akunKe, setAkunKe] = useState("");
  const [alasanReklas, setAlasanReklas] = useState("");
  const [catatanReklas, setCatatanReklas] = useState("");
  const [batalId, setBatalId] = useState<string | null>(null);
  const [kodeBatal, setKodeBatal] = useState("");
  const [alasanBatal, setAlasanBatal] = useState("");
  // Rilis 2 — satu form Balik terbuka per kali: ajukan, atau tolak (catatan).
  const [balikForm, setBalikForm] = useState<{ id: string; mode: "ajukan" | "tolak" } | null>(null);
  const [kodeBalik, setKodeBalik] = useState("");
  const [teksBalik, setTeksBalik] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = totalPerPintu(baris);
  const tunggu = menungguTinjauan(baris);
  const tanpaAkun = belumBerakun(baris);

  const riwayatDari = (id: string): ReklasBaris[] => reklas.filter((r) => r.sourceTxnId === id);

  const bukaReklas = (id: string): void => {
    setErr(null);
    setMsg(null);
    setBatalId(null);
    setBalikForm(null);
    setReklasId(id);
    setAkunKe("");
    setAlasanReklas("");
    setCatatanReklas("");
  };

  const bukaBatal = (id: string): void => {
    setErr(null);
    setMsg(null);
    setReklasId(null);
    setBalikForm(null);
    setBatalId(id);
    setKodeBatal("");
    setAlasanBatal("");
  };

  const simpanBatal = (b: BarisBiaya): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await batalkanBiayaFinance({ code, date, entryId: b.id, reasonCode: kodeBatal, alasan: alasanBatal });
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`“${b.keterangan}” dibatalkan. Barisnya tetap tercatat beserta alasannya, dan tidak lagi dihitung di laporan.`);
        setBatalId(null);
      }
    });
  };

  const formBatal = (b: BarisBiaya) => {
    const dampak = dampakBatal(b.section, b.accountingAccount, b.amount, b.titipanBright);
    return (
      <div className="card card-pad-lg keu-form reklas-form">
        <h4 className="text-h3">Batalkan — {b.keterangan}</h4>
        <p className="fs16 t-tertiary mt2">
          Baris tidak dihapus dan tidak disunting. Ia ditandai <strong>dibatalkan</strong> beserta alasannya, lalu
          keluar dari laporan laba rugi, arus kas, neraca, dan buku besar tanggal {date}.
        </p>
        <div className="keu-2col">
          <label className="keu-fld">
            <span className="keu-label">Alasan pembatalan</span>
            <select className="manual-input" value={kodeBatal} onChange={(e) => setKodeBatal(e.target.value)}>
              <option value="">— pilih alasan —</option>
              {reasonVoid.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} — {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="keu-fld">
            <span className="keu-label">Keterangan (wajib)</span>
            <input
              className="manual-input"
              value={alasanBatal}
              onChange={(e) => setAlasanBatal(e.target.value)}
              placeholder="contoh: ganda dengan MDR otomatis settlement BCA"
            />
          </label>
        </div>
        <div className={`banner ${dampak === 0 ? "info" : "warning"} keu-banner`} role="status">
          <b>
            {dampak === 0
              ? "Laba bersih tidak berubah — baris ini sudah tidak membentuk laba."
              : `Laba bersih ${date} ${dampak > 0 ? "naik" : "turun"} Rp ${rp(Math.abs(dampak))}.`}
          </b>
        </div>
        <div className="manual-form-actions">
          <button
            type="button"
            className="btn-navy"
            onClick={() => simpanBatal(b)}
            disabled={pending || kodeBatal === "" || alasanBatal.trim().length < ALASAN_MIN}
          >
            {pending ? "Menyimpan…" : "Ya, batalkan baris ini"}
          </button>
          <button type="button" className="btn-outline" onClick={() => setBatalId(null)} disabled={pending}>
            Batal
          </button>
        </div>
      </div>
    );
  };

  const bukaBalik = (id: string, mode: "ajukan" | "tolak"): void => {
    setErr(null);
    setMsg(null);
    setReklasId(null);
    setBatalId(null);
    setBalikForm({ id, mode });
    setKodeBalik("");
    setTeksBalik("");
  };

  const jalankan = (aksi: () => Promise<{ ok: true } | { ok: false; error: string }>, sukses: string): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await aksi();
      if (!res.ok) setErr(res.error);
      else {
        setMsg(sukses);
        setBalikForm(null);
      }
    });
  };

  const formBalik = (b: BarisBiaya) => {
    if (balikForm === null) return null;
    const dampak = dampakBatal(b.section, b.accountingAccount, b.amount, b.titipanBright);
    const tolak = balikForm.mode === "tolak";
    return (
      <div className="card card-pad-lg keu-form reklas-form">
        <h4 className="text-h3">
          {tolak ? "Tolak pengajuan balik" : "Ajukan balik"} — {b.keterangan}
        </h4>
        {!tolak && (
          <>
            <p className="fs16 t-tertiary mt2">
              Hari {date} sudah ditutup. Baris tidak disunting: yang lahir adalah satu entri pembalik yang
              <strong> wajib disetujui orang lain</strong> (Head of Finance, Direksi, atau super admin). Sesudah
              disetujui, baris tidak lagi dihitung di laporan tanggal {date}. Selisih saat hari ditutup tetap
              tercatat apa adanya.
            </p>
            <label className="keu-fld">
              <span className="keu-label">Alasan koreksi</span>
              <select className="manual-input" value={kodeBalik} onChange={(e) => setKodeBalik(e.target.value)}>
                <option value="">— pilih alasan —</option>
                {reasonBalik.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code} — {r.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="keu-fld">
          <span className="keu-label">{tolak ? "Catatan penolakan (wajib)" : "Keterangan (wajib)"}</span>
          <input
            className="manual-input"
            value={teksBalik}
            onChange={(e) => setTeksBalik(e.target.value)}
            placeholder={tolak ? "contoh: MDR ini ditagih terpisah, bukan ganda" : "contoh: ganda dengan MDR otomatis settlement BCA"}
          />
        </label>
        {!tolak && (
          <div className={`banner ${dampak === 0 ? "info" : "warning"} keu-banner`} role="status">
            <b>
              {dampak === 0
                ? "Laba bersih tidak berubah — baris ini sudah tidak membentuk laba."
                : `Bila disetujui: laba bersih ${date} ${dampak > 0 ? "naik" : "turun"} Rp ${rp(Math.abs(dampak))}.`}
            </b>
          </div>
        )}
        <div className="manual-form-actions">
          <button
            type="button"
            className="btn-navy"
            disabled={pending || teksBalik.trim().length < ALASAN_MIN || (!tolak && kodeBalik === "")}
            onClick={() =>
              tolak
                ? jalankan(
                    () => tolakBalikBiaya({ code, date, requestId: b.balik!.id, catatan: teksBalik }),
                    `Pengajuan balik “${b.keterangan}” ditolak. Baris tetap berlaku.`,
                  )
                : jalankan(
                    () => ajukanBalikBiaya({ code, date, entryId: b.id, reasonCode: kodeBalik, alasan: teksBalik }),
                    `Balik “${b.keterangan}” diajukan — menunggu persetujuan orang kedua.`,
                  )
            }
          >
            {pending ? "Menyimpan…" : tolak ? "Tolak pengajuan" : "Ajukan balik"}
          </button>
          <button type="button" className="btn-outline" onClick={() => setBalikForm(null)} disabled={pending}>
            Batal
          </button>
        </div>
      </div>
    );
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
          Transaksi yang dicatat pengawas tidak bisa ditimpa. Yang tersedia hanya
          tindakan eksplisit: <strong>{Object.values(LABEL_TINDAKAN).join(" · ")}</strong>.
          Dua kolom terpisah menjaga batasnya — kategori operasional dipilih pengawas, akun
          akuntansi jadi tanggung jawab Finance.
        </p>
        <p className="keu-p">
          <strong>Reklasifikasi</strong> sudah bisa dipakai: pindahkan pos yang bukan biaya
          (prive, setoran ke bank, penjualan via transfer) ke akun bukan-laba. Baris pengawasnya
          tetap utuh. <strong>{LABEL_TINDAKAN.batalkan}</strong> tersedia untuk baris pintu Finance
          yang salah input (mis. tercatat ganda) selama hari belum ditutup — dengan alasan, tanpa
          menghapus. Untuk hari yang sudah ditutup, baris pintu Finance bisa <strong>diajukan balik</strong>:
          entri pembalik yang wajib disetujui orang kedua (Head of Finance, Direksi, atau super admin).
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
            const bisaReklas = bolehReklas && tindakan.includes("reclassify") && !b.titipanBright;
            const bisaBatal = tindakan.includes("batalkan");
            const finance = b.sourceDoor === "finance" && !b.void;
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
                  {b.dibalik && b.balik !== null ? (
                    <>
                      <span className="keu-chip nada-merah">dibalik</span>
                      <span className="keu-p t-tertiary">
                        diajukan {b.balik.oleh ?? "?"} · disetujui {b.balik.putusOleh ?? "?"} {b.balik.putusWaktu} ·{" "}
                        {b.balik.kode} · {b.balik.alasan}
                      </span>
                    </>
                  ) : b.void ? (
                    <>
                      <span className="keu-chip nada-merah">dibatalkan</span>
                      {b.voidReasonCode !== null && (
                        <span className="keu-p t-tertiary">
                          {b.voidAt}
                          {b.voidOleh !== null && ` oleh ${b.voidOleh}`} · {b.voidReasonCode} · {b.voidAlasan}
                        </span>
                      )}
                    </>
                  ) : b.hariTutup || b.status === "closed" ? (
                    <>
                      {"disahkan · terkunci"}
                      {b.balik?.status === "menunggu" && (
                        <span className="keu-p">
                          <span className="keu-chip nada-kuning">menunggu balik</span> diajukan{" "}
                          {b.balik.oleh ?? "?"} {b.balik.waktu} · {b.balik.kode} · {b.balik.alasan}
                        </span>
                      )}
                      {(b.balik?.status === "ditolak" || b.balik?.status === "ditarik") && (
                        <span className="keu-p t-tertiary">
                          balik terakhir {b.balik.status} oleh {b.balik.putusOleh ?? "?"} {b.balik.putusWaktu}
                          {b.balik.catatan !== null && ` · ${b.balik.catatan}`}
                        </span>
                      )}
                    </>
                  ) : (
                    b.status
                  )}
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
                  ) : b.titipanBright ? (
                    "—"
                  ) : tindakan.includes("reclassify") ? (
                    // Nama tindakan TANPA tombol terbaca seperti tombol rusak
                    // (27 Sep: HoF mengira fiturnya gagal). Sebut siapa pelakunya.
                    <span className="keu-p">Reklasifikasi oleh staf Keuangan / Head of Finance</span>
                  ) : (
                    "—"
                  )}
                  {bisaBatal &&
                    (bolehBatal ? (
                      <button
                        type="button"
                        className="btn-outline sm t-danger"
                        disabled={pending}
                        onClick={() => (batalId === b.id ? setBatalId(null) : bukaBatal(b.id))}
                      >
                        {LABEL_TINDAKAN.batalkan}
                      </button>
                    ) : (
                      <span className="keu-p">{LABEL_TINDAKAN.batalkan} oleh staf Keuangan / Head of Finance</span>
                    ))}
                  {finance && b.bertautKas && !b.hariTutup && (
                    <span className="keu-p t-tertiary">batalkan lewat mutasi kas asalnya</span>
                  )}
                  {tindakan.includes("correct") &&
                    (b.balik?.status === "menunggu" ? (
                      <>
                        {b.balik.olehId === userId && bolehAjukanBalik && (
                          <button
                            type="button"
                            className="btn-outline sm"
                            disabled={pending}
                            onClick={() =>
                              jalankan(
                                () => tarikBalikBiaya({ code, date, requestId: b.balik!.id }),
                                `Pengajuan balik “${b.keterangan}” ditarik.`,
                              )
                            }
                          >
                            Tarik pengajuan
                          </button>
                        )}
                        {b.balik.olehId !== userId && bolehSetujuiBalik ? (
                          <>
                            <button
                              type="button"
                              className="btn-navy sm"
                              disabled={pending}
                              onClick={() =>
                                jalankan(
                                  () => setujuiBalikBiaya({ code, date, requestId: b.balik!.id }),
                                  `Balik “${b.keterangan}” disetujui — baris tidak lagi dihitung di laporan ${date}.`,
                                )
                              }
                            >
                              Setujui balik
                            </button>
                            <button
                              type="button"
                              className="btn-outline sm"
                              disabled={pending}
                              onClick={() => bukaBalik(b.id, "tolak")}
                            >
                              Tolak
                            </button>
                          </>
                        ) : (
                          b.balik.olehId === userId && (
                            <span className="keu-p t-tertiary">menunggu Head of Finance / Direksi lain</span>
                          )
                        )}
                      </>
                    ) : bolehAjukanBalik ? (
                      <button type="button" className="btn-outline sm" disabled={pending} onClick={() => bukaBalik(b.id, "ajukan")}>
                        Ajukan balik
                      </button>
                    ) : (
                      <span className="keu-p">{LABEL_TINDAKAN.correct} oleh staf Keuangan / Head of Finance</span>
                    ))}
                  {finance && b.hariTutup && b.bertautKas && (
                    <span className="keu-p t-tertiary">bertaut mutasi kas — hubungi Head of Finance</span>
                  )}
                </span>
              </div>
              {reklasId === b.id && formReklas(b)}
              {batalId === b.id && formBatal(b)}
              {balikForm?.id === b.id && formBalik(b)}
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
    </section>
  );
}
