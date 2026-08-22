"use client";

import { useState, useTransition } from "react";
import {
  aktifkanKembaliAkunKas,
  nonaktifkanAkunKas,
  tambahAkunKas,
  ubahNamaAkunKas,
} from "@/lib/akun-kas-actions";
import {
  AMBANG_DORMAN_HARI,
  keadaanPakai,
  kandidatAktifkanKembali,
  NAMA_BAKU,
  periksaNama,
  periksaNonaktif,
  PESAN_SALAH_NAMA,
  type AkunKasRow,
  type KindAkun,
} from "@/lib/keuangan-akun-model";

/**
 * Kelola Akun Kas (§10.18).
 *
 * ⛔ **TIDAK ADA TOMBOL HAPUS**, dan itu bukan pilihan gaya: `dashboard_app`
 * tak punya `DELETE` pada tabel ini. Yang ada **Ubah nama** (menyembuhkan salah
 * ketik — kebutuhan yang sebenarnya) dan **Nonaktifkan**.
 *
 * ⛔ **Nonaktifkan MEWAJIBKAN tanggal tutup.** `active` dan `closed_at` dilas
 * CHECK 0029:72; tak ada keadaan "berhenti dipakai tapi belum ditutup". Form
 * ini karena itu tidak pernah menawarkan keduanya terpisah.
 *
 * Penanda **dorman** diturunkan dari tanggal mutasi terakhir — begitu
 * rekeningnya dipakai lagi, tandanya hilang sendiri.
 */

export function AkunKasPanel({
  code,
  namaUnit,
  hariIni,
  akun,
  bolehTulis,
  bolehNonaktif,
}: {
  code: string;
  namaUnit: string;
  hariIni: string;
  akun: AkunKasRow[];
  bolehTulis: boolean;
  bolehNonaktif: boolean;
}) {
  const [nama, setNama] = useState("");
  const [kind, setKind] = useState<KindAkun>("bank");
  const [sunting, setSunting] = useState<string | null>(null);
  const [namaBaru, setNamaBaru] = useState("");
  const [tutupId, setTutupId] = useState<string | null>(null);
  const [tglTutup, setTglTutup] = useState(hariIni);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ringkas = akun.map((a) => ({ id: a.id, nama: a.nama, active: a.active }));
  const salah = nama.trim() === "" ? [] : periksaNama(nama, { kind, namaUnit, akun: ringkas });
  const reaktivasi = kandidatAktifkanKembali(nama, ringkas);

  const jalankan = (fn: () => Promise<{ ok: boolean; error?: string; pesan?: string }>): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Gagal.");
      else {
        setMsg(r.pesan ?? "Tersimpan.");
        setNama("");
        setSunting(null);
        setTutupId(null);
      }
    });
  };

  return (
    <section aria-labelledby="akun-kas">
      <div className="section-h">
        <h2 id="akun-kas" className="text-h3">
          Akun kas &amp; bank
        </h2>
        <span className="fs16 t-tertiary">
          daftar rekening unit ini — tidak lagi hidup di migrasi
        </span>
      </div>

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
        <div className="grid-head cols-akun">
          <span>Nama rekening</span>
          <span>Jenis</span>
          <span className="right">Mutasi</span>
          <span>Keadaan</span>
          <span>Tindakan</span>
        </div>
        {akun.length === 0 ? (
          <div className="empty-inline">
            Unit ini belum punya satu pun akun kas. Tambahkan rekening riilnya di bawah —
            sampai itu, Cash Flow dan Balance Sheet-nya belum bisa disusun.
          </div>
        ) : (
          akun.map((a) => {
            const keadaan = keadaanPakai(a, hariIni);
            const cek = periksaNonaktif(a);
            return (
              <div className="grid-row cols-akun" key={a.id}>
                <span className="w600">
                  {sunting === a.id ? (
                    <input
                      className="manual-input"
                      value={namaBaru}
                      onChange={(e) => setNamaBaru(e.target.value)}
                      aria-label={`Nama baru untuk ${a.nama}`}
                    />
                  ) : (
                    a.nama
                  )}
                </span>
                <span className="fs16 t-secondary">{a.kind}</span>
                <span className="right num t-secondary">{a.nMutasi}</span>
                <span className="fs16">
                  {/* ⛔ EMPAT keadaan, bukan tiga. "Belum pernah dipakai" TIDAK
                      memakai lencana peringatan: rekening yang baru didaftarkan
                      bukan masalah, dan lencana yang menyala pada semua rekening
                      baru berhenti berarti apa-apa. Lihat `keadaanPakai`. */}
                  {keadaan === "tidak_aktif" ? (
                    <>
                      <span className="keu-chip keadaan-belum">Tidak aktif</span>
                      <span className="fs16 t-tertiary keu-p">ditutup {a.closedAt}</span>
                    </>
                  ) : keadaan === "belum_pernah_dipakai" ? (
                    <>
                      <span className="keu-chip keadaan-siap">Aktif</span>
                      <span className="fs16 t-tertiary keu-p">
                        belum pernah dipakai — wajar untuk rekening yang baru didaftarkan
                      </span>
                    </>
                  ) : keadaan === "dorman" ? (
                    <>
                      <span className="keu-chip keadaan-sebagian">Dorman</span>
                      <span className="fs16 t-tertiary keu-p">
                        mutasi terakhir {a.mutasiTerakhir} — tandanya hilang sendiri begitu
                        dipakai lagi (ambang {AMBANG_DORMAN_HARI} hari)
                      </span>
                    </>
                  ) : (
                    <span className="keu-chip keadaan-siap">Aktif</span>
                  )}
                </span>
                <span className="fs16">
                  {sunting === a.id ? (
                    <>
                      <button
                        type="button"
                        className="btn-navy sm"
                        disabled={pending}
                        onClick={() =>
                          jalankan(() =>
                            ubahNamaAkunKas({ code, namaUnit, id: a.id, nama: namaBaru }),
                          )
                        }
                      >
                        Simpan
                      </button>{" "}
                      <button type="button" className="btn-outline sm" onClick={() => setSunting(null)}>
                        Batal
                      </button>
                    </>
                  ) : tutupId === a.id ? (
                    <span className="keu-fld">
                      <span className="keu-label">Tanggal tutup (wajib)</span>
                      <input
                        className="manual-input"
                        type="date"
                        value={tglTutup}
                        onChange={(e) => setTglTutup(e.target.value)}
                      />
                      <span className="fs16 t-tertiary">
                        {cek.peringatan ??
                          "Skema tak mengenal “nonaktif tetapi belum ditutup”. Kalau tanggalnya " +
                            "belum diketahui, biarkan rekening ini aktif."}
                      </span>
                      <span className="manual-form-actions">
                        <button
                          type="button"
                          className="btn-navy sm"
                          disabled={pending}
                          onClick={() =>
                            jalankan(() =>
                              nonaktifkanAkunKas({ code, id: a.id, closedAt: tglTutup }),
                            )
                          }
                        >
                          Nonaktifkan
                        </button>{" "}
                        <button type="button" className="btn-outline sm" onClick={() => setTutupId(null)}>
                          Batal
                        </button>
                      </span>
                    </span>
                  ) : (
                    <>
                      {bolehTulis && a.active && (
                        <button
                          type="button"
                          className="btn-outline sm"
                          onClick={() => {
                            setSunting(a.id);
                            setNamaBaru(a.nama);
                          }}
                        >
                          Ubah nama
                        </button>
                      )}{" "}
                      {bolehNonaktif && a.active && (
                        <button type="button" className="btn-outline sm" onClick={() => setTutupId(a.id)}>
                          Nonaktifkan
                        </button>
                      )}
                      {bolehTulis && !a.active && (
                        <button
                          type="button"
                          className="btn-tint sm"
                          disabled={pending}
                          onClick={() => jalankan(() => aktifkanKembaliAkunKas({ code, id: a.id }))}
                        >
                          Aktifkan kembali
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      {bolehTulis && (
        <div className="card card-pad-lg keu-form">
          <h3 className="text-h3">Tambah rekening</h3>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Jenis</span>
              <select
                className="manual-input"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as KindAkun;
                  setKind(k);
                  // Nama baku ditawarkan, bukan diketik bebas — papan grup
                  // membandingkan berdasarkan nama.
                  if (k !== "bank") setNama(NAMA_BAKU[k]);
                  else setNama("");
                }}
              >
                <option value="bank">Bank</option>
                <option value="kas">Kas besar</option>
                <option value="edc_penampungan">EDC penampungan</option>
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nama rekening</span>
              <input
                className="manual-input"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder={kind === "bank" ? "Bank BCA - 5125036811" : NAMA_BAKU[kind]}
                readOnly={kind !== "bank"}
                aria-invalid={salah.length > 0}
              />
              <span className="fs16 t-tertiary">
                {kind === "bank"
                  ? "Sertakan nomor rekening penuh — unit bisa punya lebih dari satu rekening di bank yang sama."
                  : "Nama baku, sama persis di setiap unit."}
              </span>
            </label>
          </div>

          {salah.length > 0 && (
            <div className="banner warning keu-banner" role="status">
              <ul className="keu-list">
                {salah.map((s) => (
                  <li key={s}>{PESAN_SALAH_NAMA[s]}</li>
                ))}
              </ul>
            </div>
          )}

          {reaktivasi !== null && (
            <div className="banner info keu-banner" role="status">
              <b>Rekening ini pernah ada dan sedang tidak aktif</b>
              <p className="keu-p">
                “{reaktivasi.nama}” masih tersimpan beserta riwayat mutasinya. Aktifkan kembali
                alih-alih membuat baru — membuat baru akan ditolak karena namanya harus unik
                per unit.
              </p>
              <div className="manual-form-actions">
                <button
                  type="button"
                  className="btn-navy"
                  disabled={pending}
                  onClick={() => jalankan(() => aktifkanKembaliAkunKas({ code, id: reaktivasi.id }))}
                >
                  Aktifkan kembali
                </button>
              </div>
            </div>
          )}

          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending || salah.length > 0 || nama.trim() === "" || reaktivasi !== null}
              onClick={() => jalankan(() => tambahAkunKas({ code, namaUnit, nama, kind }))}
            >
              {pending ? "Menyimpan…" : "Tambah rekening"}
            </button>
          </div>
        </div>
      )}

      {!bolehNonaktif && bolehTulis && (
        <p className="fs16 t-tertiary mt4">
          Menonaktifkan rekening adalah wewenang Head of Finance — menghilangkan akun adalah
          cara membuat saldo hilang dari pandangan, dan yang menghilang tidak menampakkan diri.
        </p>
      )}
    </section>
  );
}
