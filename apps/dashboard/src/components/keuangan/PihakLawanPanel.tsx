"use client";

/**
 * Pihak lawan per unit (rencana 2026-10-29 U3) — formulir tindakan BERNAMA.
 *
 * ⛔ Tak ada "Edit": pihak lawan ditambah atau dinonaktifkan; saldo pembuka
 * diganti (yang lama di-void, keduanya tercatat); baris kas lama hanya diberi
 * pihak lawannya SEKALI. Wewenang tiap tombol dihitung server (props `boleh*`);
 * menyembunyikan tombol bukan kontrol akses — gerbangnya di server action.
 *
 * Pihak lawan NONAKTIF tetap tampil berikut saldonya (alasan predikat
 * `canNonaktifkanPihakLawan`); yang hilang hanya kemungkinan memilihnya.
 */
import { useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import { PratinjauAngka } from "./PratinjauAngka";
import {
  nonaktifkanPihakLawan,
  tambahPihakLawan,
  tetapkanPihakLawanBaris,
  tetapkanSaldoAwalPihakLawan,
} from "@/lib/pihak-lawan-actions";
import {
  JENIS_DIBUAT_KEUANGAN,
  JENIS_PIHAK_LAWAN,
  LABEL_JENIS,
  pihakLawanUntuk,
  rpSen,
  type JenisPihakLawan,
  type SaldoAwalPihakLawan,
} from "@/lib/pihak-lawan-model";
import type { BarisTanpaPihakLawan } from "@/lib/pihak-lawan-queries";

export interface PihakLawanTampil {
  id: string;
  jenis: JenisPihakLawan;
  nama: string;
  aktif: boolean;
  saldoAwal: SaldoAwalPihakLawan | null;
  saldoSen: number;
  nMutasi: number;
  nPraSaldoAwal: number;
  /** Untuk jenis `unit`: apakah pengguna juga memegang unit lawannya. */
  lawanDipegang: boolean;
}

const tandaSaldo = (sen: number): string =>
  sen === 0 ? "Rp 0" : `${sen > 0 ? "piutang" : "hutang"} ${rpSen(sen)}`;

export function PihakLawanPanel({
  code,
  per,
  pihak,
  barisLama,
  bolehTambah,
  bolehNonaktif,
  bolehSaldoAwal,
  bolehTetapkanBaris,
}: {
  code: string;
  per: string;
  pihak: PihakLawanTampil[];
  barisLama: BarisTanpaPihakLawan[];
  bolehTambah: boolean;
  bolehNonaktif: boolean;
  bolehSaldoAwal: boolean;
  bolehTetapkanBaris: boolean;
}) {
  const [pending, start] = useTransition();
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  // Tambah
  const [jenisBaru, setJenisBaru] = useState<string>("kreditur");
  const [namaBaru, setNamaBaru] = useState("");
  // Nonaktifkan — konfirmasi di tempat, seperti "Batalkan" di buku kas.
  const [yakin, setYakin] = useState<string | null>(null);
  // Saldo pembuka
  const [bukaSa, setBukaSa] = useState<string | null>(null);
  const [saTanggal, setSaTanggal] = useState("");
  const [saNominal, setSaNominal] = useState("");
  const [saSementara, setSaSementara] = useState(false);
  const [saAlasan, setSaAlasan] = useState("");
  // Tetapkan pihak lawan baris lama
  const [pilihan, setPilihan] = useState<Record<string, string>>({});

  const hSa = bacaRupiah(saNominal, { bolehNegatif: true });
  const saNol = hSa.keadaan === "sah" && hSa.nilai === 0;

  const jalankan = (f: () => Promise<{ ok: true; pesan?: string } | { ok: false; error: string }>, selesai?: () => void) => {
    setGalat(null);
    setPesan(null);
    start(async () => {
      const r = await f();
      if (!r.ok) setGalat(r.error);
      else {
        setPesan(r.pesan ?? "Tersimpan.");
        selesai?.();
      }
    });
  };

  const aktif = pihak.filter((p) => p.aktif);
  const pilihanUntuk = (kategori: string) => pihakLawanUntuk(kategori, aktif);
  const bukaPihak = pihak.find((p) => p.id === bukaSa) ?? null;

  return (
    <>
      {pesan !== null && (
        <div className="banner info keu-banner" role="status">
          {pesan}
        </div>
      )}
      {galat !== null && (
        <div className="banner danger keu-banner" role="alert">
          {galat}
        </div>
      )}

      <section className="card card-pad-lg" aria-labelledby="daftar-pihak-lawan">
        <div className="section-h">
          <h3 id="daftar-pihak-lawan" className="text-h3">
            Daftar pihak lawan
          </h3>
          <span className="fs16 t-tertiary">saldo per akhir {per}</span>
        </div>

        {JENIS_PIHAK_LAWAN.map((j) => {
          const grup = pihak.filter((p) => p.jenis === j);
          if (grup.length === 0) return null;
          return (
            <div className="mt6" key={j}>
              <h4 className="fs16 w600">{LABEL_JENIS[j]}</h4>
              {grup.map((p) => (
                <div className="grid-row cols-akun" key={p.id}>
                  <span className="w600">
                    {p.nama}
                    {!p.aktif && <span className="keu-pill">nonaktif</span>}
                  </span>
                  <span className="fs16">
                    <span className="num">{tandaSaldo(p.saldoSen)}</span>
                    <span className="fs16 t-tertiary keu-p">
                      {p.saldoAwal === null
                        ? "saldo pembuka belum ditetapkan"
                        : `pembuka ${rpSen(p.saldoAwal.amountSen)}${p.saldoAwal.amountSen < 0 ? " (hutang)" : ""} sejak ${p.saldoAwal.tanggal}`}
                      {p.saldoAwal?.sementara && " · sementara"} · {p.nMutasi} mutasi
                    </span>
                    {p.nPraSaldoAwal > 0 && (
                      <span className="fs16 t-danger keu-p">
                        {p.nPraSaldoAwal} mutasi bertanggal sebelum saldo pembuka tidak dijumlah — sudah
                        termuat di saldo pembukanya.
                      </span>
                    )}
                  </span>
                  <span className="fs16">
                    {bolehSaldoAwal && p.lawanDipegang && (
                      <button
                        type="button"
                        className="btn-tint sm"
                        disabled={pending}
                        onClick={() => {
                          setBukaSa(bukaSa === p.id ? null : p.id);
                          setGalat(null);
                        }}
                      >
                        {p.saldoAwal === null ? "Tetapkan pembuka" : "Ganti pembuka"}
                      </button>
                    )}{" "}
                    {bolehNonaktif && p.aktif && (
                      yakin === p.id ? (
                        <span className="keu-yakin">
                          <button
                            type="button"
                            className="btn-outline sm t-danger"
                            disabled={pending}
                            onClick={() => {
                              setYakin(null);
                              jalankan(() => nonaktifkanPihakLawan({ code, id: p.id }));
                            }}
                          >
                            Ya, nonaktifkan
                          </button>
                          <button type="button" className="btn-outline sm" onClick={() => setYakin(null)}>
                            Tidak
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setYakin(p.id)}>
                          Nonaktifkan
                        </button>
                      )
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}

        {bukaPihak !== null && (
          <div className="card card-pad-lg keu-form mt6">
            <h4 className="text-h3">
              {bukaPihak.saldoAwal === null ? "Tetapkan" : "Ganti"} saldo pembuka — {bukaPihak.nama}
            </h4>
            <p className="fs16 t-tertiary mt2">
              Positif = piutang (mereka berhutang ke unit ini), negatif = hutang unit ini. Angka lama
              tidak disunting — ia dibatalkan dan diganti, dan keduanya tercatat.
              {bukaPihak.jenis === "unit" &&
                " Untuk unit SolaMax, satu pengisian berlaku untuk KEDUA buku: unit lawan otomatis mendapat angka yang sama dengan tanda berlawanan."}
            </p>
            <div className="keu-2col">
              <label className="keu-fld">
                <span className="keu-label">Tanggal cut-over</span>
                <input className="manual-input" type="date" value={saTanggal} onChange={(e) => setSaTanggal(e.target.value)} />
              </label>
              <label className="keu-fld">
                <span className="keu-label">Nominal (boleh negatif)</span>
                <input
                  className="manual-input num"
                  inputMode="text"
                  value={saNominal}
                  onChange={(e) => setSaNominal(e.target.value)}
                  placeholder="contoh -125.000.000"
                />
                <PratinjauAngka hasil={hSa} />
              </label>
            </div>
            <label className="keu-check mt4">
              <input
                type="checkbox"
                checked={saSementara || saNol}
                disabled={saNol}
                onChange={(e) => setSaSementara(e.target.checked)}
              />{" "}
              <span className="fs16">
                Tandai <strong>sementara</strong> — angka konfirmasi menyusul{saNol && " (wajib untuk Rp 0)"}
              </span>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Alasan — dari mana angka ini berasal</span>
              <input className="manual-input" value={saAlasan} onChange={(e) => setSaAlasan(e.target.value)} />
            </label>
            <div className="manual-form-actions">
              <button
                type="button"
                className="btn-navy"
                disabled={pending || hSa.keadaan !== "sah"}
                onClick={() => {
                  if (hSa.keadaan !== "sah") return;
                  const nilai = hSa.nilai;
                  jalankan(
                    () =>
                      tetapkanSaldoAwalPihakLawan({
                        code,
                        pihakLawanId: bukaPihak.id,
                        tanggal: saTanggal,
                        amount: nilai,
                        sementara: saSementara || saNol,
                        alasan: saAlasan,
                      }),
                    () => {
                      setBukaSa(null);
                      setSaTanggal("");
                      setSaNominal("");
                      setSaAlasan("");
                      setSaSementara(false);
                    },
                  );
                }}
              >
                {pending ? "Menyimpan…" : "Simpan saldo pembuka"}
              </button>
              <button type="button" className="btn-outline" disabled={pending} onClick={() => setBukaSa(null)}>
                Batal
              </button>
            </div>
          </div>
        )}

        {bolehTambah && (
          <div className="card card-pad-lg keu-form mt6">
            <h4 className="text-h3">Tambah pihak lawan</h4>
            <p className="fs16 t-tertiary mt2">Unit SolaMax sudah tersedia otomatis — tidak perlu ditambah.</p>
            <div className="keu-2col">
              <label className="keu-fld">
                <span className="keu-label">Jenis</span>
                <select className="manual-input" value={jenisBaru} onChange={(e) => setJenisBaru(e.target.value)}>
                  {JENIS_DIBUAT_KEUANGAN.map((j) => (
                    <option key={j} value={j}>
                      {LABEL_JENIS[j]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="keu-fld">
                <span className="keu-label">Nama</span>
                <input
                  className="manual-input"
                  value={namaBaru}
                  onChange={(e) => setNamaBaru(e.target.value)}
                  placeholder="contoh BPR Utari"
                />
              </label>
            </div>
            <div className="manual-form-actions">
              <button
                type="button"
                className="btn-navy"
                disabled={pending}
                onClick={() =>
                  jalankan(() => tambahPihakLawan({ code, jenis: jenisBaru, nama: namaBaru }), () => setNamaBaru(""))
                }
              >
                {pending ? "Menyimpan…" : "Tambah"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad-lg mt10" aria-labelledby="baris-lama">
        <div className="section-h">
          <h3 id="baris-lama" className="text-h3">
            Mutasi lama tanpa pihak lawan
          </h3>
          <span className="fs16 t-tertiary">{barisLama.length} baris</span>
        </div>
        <p className="fs16 t-tertiary mt2">
          Baris Hutang Piutang yang dicatat sebelum pihak lawan wajib. Tetapkan pihak lawannya sekali —
          nominal, tanggal, dan kategorinya tidak berubah.
        </p>
        {barisLama.length === 0 ? (
          <div className="empty-inline mt6">Semua mutasi Hutang Piutang sudah menyebut pihak lawan.</div>
        ) : (
          <div className="mt6">
            {barisLama.map((b) => (
              <div className="grid-row cols-akun" key={b.id}>
                <span className="w600">
                  {b.keterangan}
                  <span className="fs16 t-tertiary keu-p">
                    {b.businessDate} · {b.akun} · {b.categoryLabel}
                  </span>
                </span>
                <span className={`num ${b.amountSen < 0 ? "t-danger" : ""}`}>
                  {b.amountSen < 0 ? "−" : ""}
                  {rpSen(b.amountSen)}
                </span>
                <span className="fs16">
                  {bolehTetapkanBaris && (
                    <>
                      <select
                        className="manual-input"
                        value={pilihan[b.id] ?? ""}
                        onChange={(e) => setPilihan({ ...pilihan, [b.id]: e.target.value })}
                      >
                        <option value="">— pilih pihak lawan —</option>
                        {pilihanUntuk(b.categoryLabel).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nama}
                          </option>
                        ))}
                      </select>{" "}
                      <button
                        type="button"
                        className="btn-tint sm"
                        disabled={pending || !pilihan[b.id]}
                        onClick={() =>
                          jalankan(() =>
                            tetapkanPihakLawanBaris({ code, cashLedgerId: b.id, pihakLawanId: pilihan[b.id]! }),
                          )
                        }
                      >
                        Tetapkan pihak lawan
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
