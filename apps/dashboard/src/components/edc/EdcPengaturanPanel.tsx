"use client";

import { useState, useTransition } from "react";
import { aturRekeningEdc, batalkanRekeningEdc } from "@/lib/edc-rekening-actions";
import { simpanPetaKartu } from "@/lib/edc-shift-actions";
import type { BarisEdc, KartuEdc, VersiRekening } from "@/lib/edc-rekening-model";

/**
 * Pengaturan EDC (§10.28) — dua hal yang berubah bersama kesepakatan dengan bank:
 *
 *   1. **Rekening pencairan tiap EDC** — diatur tim Finance, BERTANGGAL BERLAKU.
 *      Tak ada "sunting": rekening baru = versi baru dengan tanggalnya, sehingga
 *      layar selalu bisa menjawab "dulu cair ke mana".
 *   2. **Kode kartu EasyMax → EDC** — peta yang sama dengan panel EDC di Rincian
 *      (§10.25), dikumpulkan di sini supaya seluruh pengaturan EDC ada di satu
 *      layar. Wewenangnya tetap `canPetakanKartuEdc`.
 *
 * Tak ada tombol hapus di mana pun: `dashboard_app` tak punya DELETE.
 */

const rp = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

interface AkunBank {
  id: string;
  nama: string;
}

type Sunting = { acquirer: string; baru: boolean } | null;

export function EdcPengaturanPanel({
  code,
  hariIni,
  dari,
  edc,
  kartu,
  kartuTanpaPeta,
  akunBank,
  bolehAtur,
  bolehPetakan,
}: {
  code: string;
  hariIni: string;
  /** Awal jendela penjualan yang ditampilkan (`YYYY-MM-DD`). */
  dari: string;
  edc: BarisEdc[];
  kartu: KartuEdc[];
  kartuTanpaPeta: KartuEdc[];
  akunBank: AkunBank[];
  bolehAtur: boolean;
  bolehPetakan: boolean;
}) {
  const [sunting, setSunting] = useState<Sunting>(null);
  const [namaBaru, setNamaBaru] = useState("");
  const [akunDipilih, setAkunDipilih] = useState("");
  const [tanggal, setTanggal] = useState(hariIni);
  const [catatan, setCatatan] = useState("");
  const [riwayatBuka, setRiwayatBuka] = useState<string | null>(null);
  const [yakinBatal, setYakinBatal] = useState<string | null>(null);
  const [petaSunting, setPetaSunting] = useState<string | null>(null);
  const [peta, setPeta] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const namaEdc = edc.map((e) => e.acquirer);
  const tanpaRekening = edc.filter((e) => e.kini === null && e.n > 0);

  const jalankan = (fn: () => Promise<{ ok: boolean; error?: string }>, sukses: string): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Gagal.");
      else {
        setMsg(sukses);
        setSunting(null);
        setYakinBatal(null);
        setPetaSunting(null);
        setCatatan("");
        setNamaBaru("");
      }
    });
  };

  const bukaSunting = (acquirer: string, baru: boolean, kini: VersiRekening | null): void => {
    setErr(null);
    setMsg(null);
    setSunting({ acquirer, baru });
    setAkunDipilih(kini?.toAccountId ?? akunBank[0]?.id ?? "");
    setTanggal(hariIni);
    setCatatan("");
  };

  const simpanRekening = (): void => {
    if (sunting === null) return;
    const acquirer = sunting.baru ? namaBaru : sunting.acquirer;
    const namaAkun = akunBank.find((a) => a.id === akunDipilih)?.nama ?? "rekening terpilih";
    jalankan(
      () => aturRekeningEdc({ code, acquirer, toAccountId: akunDipilih, berlakuSejak: tanggal, catatan }),
      `${acquirer.trim().toUpperCase()} kini cair ke ${namaAkun} mulai ${tanggal}.`,
    );
  };

  const formRekening = (
    <div className="card card-pad-lg keu-form mt4">
      <h4 className="text-h3">
        {sunting?.baru ? "Tambah EDC" : `Rekening pencairan ${sunting?.acquirer ?? ""}`}
      </h4>
      <p className="fs16 t-tertiary mt2">
        Dana penjualan EDC ini yang cair <strong>mulai tanggal berlaku</strong> disarankan masuk ke
        rekening di bawah. Batch settlement yang sudah tercatat tidak berubah — pengaturan lama tetap
        tersimpan di riwayat.
      </p>
      <div className="keu-2col">
        {sunting?.baru && (
          <label className="keu-fld">
            <span className="keu-label">Nama EDC</span>
            <input
              className="manual-input"
              value={namaBaru}
              onChange={(e) => setNamaBaru(e.target.value)}
              placeholder="contoh: BCA, MANDIRI, LINKAJA"
              list="edc-nama-dikenal"
            />
          </label>
        )}
        <label className="keu-fld">
          <span className="keu-label">Rekening tujuan pencairan</span>
          <select
            className="manual-input"
            value={akunDipilih}
            onChange={(e) => setAkunDipilih(e.target.value)}
          >
            {akunBank.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nama}
              </option>
            ))}
          </select>
        </label>
        <label className="keu-fld">
          <span className="keu-label">Berlaku sejak</span>
          <input
            className="manual-input"
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
          />
        </label>
        <label className="keu-fld">
          <span className="keu-label">Catatan (opsional)</span>
          <input
            className="manual-input"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="contoh: perjanjian baru dengan bank per 1 Okt"
          />
        </label>
      </div>
      <div className="manual-form-actions">
        <button
          type="button"
          className="btn-navy"
          onClick={simpanRekening}
          disabled={pending || akunDipilih === "" || (sunting?.baru === true && namaBaru.trim() === "")}
        >
          {pending ? "Menyimpan…" : "Simpan pengaturan"}
        </button>
        <button type="button" className="btn-outline" onClick={() => setSunting(null)} disabled={pending}>
          Batal
        </button>
      </div>
    </div>
  );

  return (
    <>
      <datalist id="edc-nama-dikenal">
        {namaEdc.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

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

      {/* ─────────────── 1 · Rekening pencairan ─────────────── */}
      <section aria-labelledby="edc-rekening-h" className="mt6">
        <div className="section-h">
          <h2 id="edc-rekening-h" className="text-h3">
            Rekening pencairan tiap EDC
          </h2>
          <span className="fs16 t-tertiary">penjualan sejak {dari}</span>
        </div>

        {akunBank.length === 0 && (
          <div className="banner warning keu-banner" role="status">
            <b>Unit ini belum punya rekening bank aktif</b>
            <p className="keu-p">
              Daftarkan rekeningnya dulu di{" "}
              <a href={`/keuangan/unit/${code}/akun-kas`}>Kelola akun kas</a>, lalu kembali ke sini.
            </p>
          </div>
        )}
        {tanpaRekening.length > 0 && (
          <div className="banner warning keu-banner" role="status">
            <b>
              {tanpaRekening.length} EDC berjualan tanpa rekening pencairan:{" "}
              {tanpaRekening.map((e) => e.acquirer).join(", ")}
            </b>
            <p className="keu-p">
              Formulir batch settlement tak bisa menyarankan rekening tujuannya, dan Pemantauan tak bisa
              memeriksa apakah dananya masuk ke rekening yang benar.
            </p>
          </div>
        )}

        <div className="card tbl-card tbl-scroll">
          <div className="grid-head cols-edcrek">
            <span>EDC</span>
            <span>Kode kartu EasyMax</span>
            <span className="right">Penjualan</span>
            <span>Rekening pencairan</span>
            <span>Tindakan</span>
          </div>
          {edc.length === 0 ? (
            <div className="empty-inline">
              Belum ada EDC di unit ini — petakan kode kartu EasyMax ke EDC-nya di bagian bawah.
            </div>
          ) : (
            edc.map((e) => (
              <div key={e.acquirer}>
                <div className="grid-row cols-edcrek">
                  <span className="w600">{e.acquirer}</span>
                  <span className="fs16 t-secondary">
                    {e.kartu.length === 0
                      ? "—"
                      : e.kartu.map((k) => (
                          <span key={k.ckdkartu} className="edc-kode">
                            <span className="mono">{k.ckdkartu}</span> {k.namaKartu}
                          </span>
                        ))}
                  </span>
                  <span className="right num">
                    {rp(e.rp)}
                    <span className="keu-p t-tertiary">{e.n} trx</span>
                  </span>
                  <span className="fs16">
                    {e.kini === null ? (
                      <span className="keu-chip nada-kuning">Belum diatur</span>
                    ) : (
                      <>
                        <span className="w600">{e.kini.namaAkun}</span>
                        <span className="keu-p t-tertiary">sejak {e.kini.berlakuSejak}</span>
                      </>
                    )}
                    {e.berikutnya !== null && (
                      <span className="keu-p t-warning">
                        mulai {e.berikutnya.berlakuSejak} → {e.berikutnya.namaAkun}
                      </span>
                    )}
                  </span>
                  <span className="fs16 edc-rek-aksi">
                    {bolehAtur && akunBank.length > 0 && (
                      <button
                        type="button"
                        className="btn-outline sm"
                        disabled={pending}
                        onClick={() => bukaSunting(e.acquirer, false, e.kini)}
                      >
                        {e.kini === null ? "Atur rekening" : "Ganti rekening"}
                      </button>
                    )}
                    {e.riwayat.length > 0 && (
                      <button
                        type="button"
                        className="btn-outline sm"
                        aria-expanded={riwayatBuka === e.acquirer}
                        onClick={() => setRiwayatBuka(riwayatBuka === e.acquirer ? null : e.acquirer)}
                      >
                        Riwayat ({e.riwayat.length})
                      </button>
                    )}
                  </span>
                </div>

                {sunting !== null && !sunting.baru && sunting.acquirer === e.acquirer && formRekening}

                {riwayatBuka === e.acquirer && (
                  <div className="edc-riwayat">
                    {e.riwayat.map((v) => (
                      <div key={v.id} className={`edc-riwayat-baris${v.void ? " dibatalkan" : ""}`}>
                        <span className="fs16">
                          <strong>sejak {v.berlakuSejak}</strong> → {v.namaAkun}
                          {v.void && <span className="keu-chip">dibatalkan</span>}
                          <span className="keu-p t-tertiary">
                            dicatat {v.dibuat}
                            {v.oleh !== null && ` oleh ${v.oleh}`}
                            {v.catatan !== null && ` · ${v.catatan}`}
                          </span>
                        </span>
                        {bolehAtur && !v.void && (
                          <span className="keu-yakin">
                            {yakinBatal === v.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-outline sm"
                                  disabled={pending}
                                  onClick={() =>
                                    jalankan(
                                      () => batalkanRekeningEdc({ code, id: v.id }),
                                      `Pengaturan ${v.acquirer} sejak ${v.berlakuSejak} dibatalkan.`,
                                    )
                                  }
                                >
                                  Ya, batalkan
                                </button>
                                <button type="button" className="btn-outline sm" onClick={() => setYakinBatal(null)}>
                                  Tidak
                                </button>
                              </>
                            ) : (
                              <button type="button" className="btn-outline sm" onClick={() => setYakinBatal(v.id)}>
                                Batalkan (salah isi)
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {bolehAtur && akunBank.length > 0 && (
          <div className="manual-form-actions">
            {sunting?.baru ? null : (
              <button type="button" className="btn-tint sm" onClick={() => bukaSunting("", true, null)}>
                Tambah EDC lain…
              </button>
            )}
          </div>
        )}
        {sunting?.baru && formRekening}
        {!bolehAtur && (
          <p className="fs16 t-tertiary mt2">
            Rekening pencairan diatur oleh tim Finance (staf Keuangan / Head of Finance).
          </p>
        )}
      </section>

      {/* ─────────────── 2 · Kode kartu → EDC ─────────────── */}
      <section aria-labelledby="edc-kode-h" className="mt8">
        <div className="section-h">
          <h2 id="edc-kode-h" className="text-h3">
            Kode kartu EasyMax → EDC
          </h2>
          <span className="fs16 t-tertiary">peta yang sama dengan panel EDC di Rincian</span>
        </div>

        {kartuTanpaPeta.length > 0 && (
          <div className="banner warning keu-banner" role="status">
            <b>{kartuTanpaPeta.length} kode kartu berjualan tanpa EDC</b>
            <p className="keu-p">
              Penjualannya belum bisa dicocokkan dengan slip maupun dibukukan sampai EDC-nya ditetapkan.
            </p>
          </div>
        )}

        <div className="card tbl-card tbl-scroll">
          <div className="grid-head cols-edckode">
            <span>Kode</span>
            <span>Nama di EasyMax</span>
            <span className="right">Penjualan</span>
            <span>EDC</span>
          </div>
          {kartu.length === 0 && (
            <div className="empty-inline">Belum ada transaksi EDC berkode kartu dalam 30 hari terakhir.</div>
          )}
          {kartu.map((k) => (
            <div className="grid-row cols-edckode" key={k.ckdkartu}>
              <span className="mono w600">{k.ckdkartu}</span>
              <span className="fs16 t-secondary">{k.namaKartu}</span>
              <span className="right num">
                {rp(k.rp)}
                <span className="keu-p t-tertiary">{k.n} trx</span>
              </span>
              <span className="fs16">
                {petaSunting === k.ckdkartu ? (
                  <span className="edc-peta-aksi">
                    <input
                      className="manual-input"
                      aria-label={`EDC untuk kode kartu ${k.ckdkartu}`}
                      list="edc-nama-dikenal"
                      value={peta[k.ckdkartu] ?? k.acquirer ?? ""}
                      onChange={(ev) => setPeta((p) => ({ ...p, [k.ckdkartu]: ev.target.value }))}
                      placeholder="contoh: BCA"
                    />
                    <button
                      type="button"
                      className="btn-navy sm"
                      disabled={pending || (peta[k.ckdkartu] ?? k.acquirer ?? "").trim() === ""}
                      onClick={() =>
                        jalankan(
                          () =>
                            simpanPetaKartu({
                              code,
                              date: hariIni,
                              ckdkartu: k.ckdkartu,
                              acquirer: peta[k.ckdkartu] ?? k.acquirer ?? "",
                            }),
                          `Kode kartu ${k.ckdkartu} dipetakan.`,
                        )
                      }
                    >
                      Simpan
                    </button>
                    <button type="button" className="btn-outline sm" onClick={() => setPetaSunting(null)}>
                      Batal
                    </button>
                  </span>
                ) : (
                  <>
                    {k.acquirer === null ? (
                      <span className="keu-chip nada-kuning">Belum dipetakan</span>
                    ) : (
                      <span className="w600">{k.acquirer}</span>
                    )}
                    {bolehPetakan && (
                      <button
                        type="button"
                        className="btn-outline sm"
                        onClick={() => {
                          setErr(null);
                          setMsg(null);
                          setPetaSunting(k.ckdkartu);
                        }}
                      >
                        {k.acquirer === null ? "Petakan" : "Ubah"}
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
        <p className="fs16 t-tertiary mt2">
          {bolehPetakan
            ? "Mengubah EDC sebuah kode memindahkan penjualan shift yang BELUM dibukukan ke EDC barunya; " +
              "yang sudah dibukukan tidak berubah."
            : "Peta kode kartu diisi Head of Finance, Direksi, super admin, atau pengawas SPBU."}
        </p>
      </section>
    </>
  );
}
