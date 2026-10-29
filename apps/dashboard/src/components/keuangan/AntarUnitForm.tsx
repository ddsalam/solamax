"use client";

/**
 * Pinjaman / pengembalian / titipan antar unit (rencana 2026-10-29 U4; R3, R5,
 * R30, R31) — SATU pencatatan, dua kaki terbentuk otomatis di kedua buku.
 *
 * Unit yang sedang dibuka terisi; tombol arah "Pinjamkan ke / Terima dari"
 * menentukan siapa membayar siapa. Unit lawan yang tidak dipegang pengguna
 * tampil NONAKTIF dengan sebabnya — menyembunyikan pilihan bukan kontrol
 * akses: gerbang dua unit (R30) ditegakkan server action, yang tetap
 * penentunya. Rekening unit lawan dibaca server sesudah unitnya dipilih.
 */
import { useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import { PratinjauAngka } from "./PratinjauAngka";
import { balikPasanganAntarUnit, catatAntarUnit, rekeningAntarUnit } from "@/lib/antar-unit-actions";
import {
  JENIS_ANTAR_UNIT,
  LABEL_JENIS_ANTAR_UNIT,
  LABEL_STATUS_KAKI,
  type PasanganRingkas,
} from "@/lib/antar-unit-model";
import { rpSen } from "@/lib/pihak-lawan-model";

export interface UnitLawanPilihan {
  code: string;
  name: string;
  /** Dalam jangkauan pengguna — hanya ini yang bisa dipilih. */
  dipegang: boolean;
  satuPt: boolean;
}

export interface PasanganTampil extends PasanganRingkas {
  lawanCode: string;
  lawanNama: string;
  satuPt: boolean;
  /** Pengguna memegang unit lawan — syarat gerbang dua unit untuk membalik. */
  lawanDipegang: boolean;
}

type Rekening = { id: string; nama: string };

export function AntarUnitForm({
  code,
  namaUnit,
  unitLawan,
  rekeningSaya,
  pasangan,
  kodeAlasan,
  bolehCatat,
  bolehBalik,
}: {
  code: string;
  namaUnit: string;
  unitLawan: UnitLawanPilihan[];
  rekeningSaya: Rekening[];
  pasangan: PasanganTampil[];
  kodeAlasan: { code: string; label: string }[];
  bolehCatat: boolean;
  bolehBalik: boolean;
}) {
  const [pending, start] = useTransition();
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  const [arah, setArah] = useState<"pinjamkan" | "terima">("pinjamkan");
  const [jenis, setJenis] = useState<string>("pinjaman");
  const [lawan, setLawan] = useState("");
  const [rekLawan, setRekLawan] = useState<Rekening[] | null>(null);
  const [akunSaya, setAkunSaya] = useState("");
  const [akunLawan, setAkunLawan] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [nominal, setNominal] = useState("");
  const [catatan, setCatatan] = useState("");
  // Balik pasangan (HoF)
  const [buka, setBuka] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");
  const [catatanBalik, setCatatanBalik] = useState("");

  const hNominal = bacaRupiah(nominal);
  const namaLawan = unitLawan.find((u) => u.code === lawan)?.name ?? "";

  const pilihLawan = (c: string) => {
    setLawan(c);
    setAkunLawan("");
    setRekLawan(null);
    setGalat(null);
    if (c === "") return;
    start(async () => {
      const r = await rekeningAntarUnit({ code: c });
      if (!r.ok) setGalat(r.error);
      else setRekLawan(r.rekening);
    });
  };

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

  const simpan = () => {
    if (hNominal.keadaan !== "sah") return;
    const nilai = hNominal.nilai;
    const saya = { code, accountId: akunSaya };
    const mereka = { code: lawan, accountId: akunLawan };
    const [pemberi, penerima] = arah === "pinjamkan" ? [saya, mereka] : [mereka, saya];
    jalankan(
      () =>
        catatAntarUnit({
          pemberiCode: pemberi.code,
          pemberiAccountId: pemberi.accountId,
          penerimaCode: penerima.code,
          penerimaAccountId: penerima.accountId,
          nominal: nilai,
          tanggal,
          jenis,
          catatan,
        }),
      () => {
        setNominal("");
        setCatatan("");
      },
    );
  };

  return (
    <section className="card card-pad-lg mt10" aria-labelledby="antar-unit">
      <div className="section-h">
        <h3 id="antar-unit" className="text-h3">
          Pinjaman antar unit
        </h3>
        <span className="fs16 t-tertiary">{pasangan.length} pasangan</span>
      </div>
      <p className="fs16 t-tertiary mt2">
        Dicatat sekali — kaki lawannya terbentuk otomatis di buku unit lain. Tiap kaki berstatus “dalam
        perjalanan” sampai mutasi bank unitnya sendiri dicocokkan.
      </p>

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

      {bolehCatat && (
        <div className="card card-pad-lg keu-form mt6">
          <div className="manual-form-actions">
            {(["pinjamkan", "terima"] as const).map((a) => (
              <button
                key={a}
                type="button"
                className={arah === a ? "btn-navy sm" : "btn-outline sm"}
                aria-pressed={arah === a}
                onClick={() => setArah(a)}
              >
                {a === "pinjamkan" ? "Pinjamkan ke" : "Terima dari"}
              </button>
            ))}
          </div>
          <p className="fs16 t-tertiary mt2">
            {arah === "pinjamkan"
              ? `Kas keluar dari ${namaUnit}${namaLawan ? ` ke ${namaLawan}` : ""}.`
              : `Kas masuk ke ${namaUnit}${namaLawan ? ` dari ${namaLawan}` : ""}.`}{" "}
            Untuk pengembalian, pilih arah sesuai siapa yang membayar.
          </p>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Jenis</span>
              <select className="manual-input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_ANTAR_UNIT.map((j) => (
                  <option key={j} value={j}>
                    {LABEL_JENIS_ANTAR_UNIT[j]}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Unit lawan</span>
              <select className="manual-input" value={lawan} onChange={(e) => pilihLawan(e.target.value)}>
                <option value="">— pilih unit —</option>
                {unitLawan.map((u) => (
                  <option key={u.code} value={u.code} disabled={!u.dipegang}>
                    {u.name}
                    {u.satuPt ? " · satu PT" : ""}
                    {!u.dipegang ? " — Anda tidak berperan Keuangan di unit ini" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Rekening {namaUnit}</span>
              <select className="manual-input" value={akunSaya} onChange={(e) => setAkunSaya(e.target.value)}>
                <option value="">— pilih rekening —</option>
                {rekeningSaya.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nama}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Rekening {namaLawan || "unit lawan"}</span>
              <select
                className="manual-input"
                value={akunLawan}
                disabled={rekLawan === null}
                onChange={(e) => setAkunLawan(e.target.value)}
              >
                <option value="">{rekLawan === null ? "— pilih unit lawan dulu —" : "— pilih rekening —"}</option>
                {(rekLawan ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nama}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Tanggal transaksi</span>
              <input className="manual-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nominal</span>
              <input
                className="manual-input num"
                inputMode="text"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="contoh 500.000.000"
              />
              <PratinjauAngka hasil={hNominal} />
            </label>
          </div>
          <label className="keu-fld">
            <span className="keu-label">Catatan</span>
            <input className="manual-input" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </label>
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending || hNominal.keadaan !== "sah" || !lawan || !akunSaya || !akunLawan || !tanggal}
              onClick={simpan}
            >
              {pending ? "Menyimpan…" : "Catat di kedua buku"}
            </button>
          </div>
        </div>
      )}

      {pasangan.length === 0 ? (
        <div className="empty-inline mt6">Belum ada pasangan antar unit di buku ini.</div>
      ) : (
        <div className="mt6">
          {pasangan.map((p) => (
            <div key={p.pasanganUuid}>
              <div className="grid-row cols-akun">
                <span className="w600">
                  {p.arah === "pinjamkan" ? "Ke" : "Dari"} {p.lawanNama}
                  {p.satuPt && <span className="keu-pill">satu PT</span>}
                  <span className="fs16 t-tertiary keu-p">
                    {p.tanggal}
                    {p.hariBuku !== p.tanggal && ` · dibukukan ${p.hariBuku}`} · {p.akun} · {p.keterangan}
                  </span>
                </span>
                <span className="fs16">
                  <span className="num">
                    {p.arah === "pinjamkan" ? "piutang" : "hutang"} {rpSen(p.amountSen)}
                  </span>
                  <span className={`fs16 keu-p ${p.dibalik ? "t-tertiary" : "t-secondary"}`}>{LABEL_STATUS_KAKI[p.status]}</span>
                </span>
                <span className="fs16">
                  {bolehBalik && !p.dibalik && p.lawanDipegang && (
                    <button
                      type="button"
                      className="btn-outline sm"
                      disabled={pending}
                      onClick={() => {
                        setBuka(buka === p.pasanganUuid ? null : p.pasanganUuid);
                        setGalat(null);
                      }}
                    >
                      Balik pasangan
                    </button>
                  )}
                </span>
              </div>
              {buka === p.pasanganUuid && (
                <div className="card card-pad-lg keu-form mt4">
                  <p className="fs16 t-tertiary">
                    Kedua kaki dibalik — di buku ini dan di {p.lawanNama}. Kaki yang harinya masih terbuka
                    dibatalkan; yang harinya sudah ditutup dibalik maju ke hari terbuka berikutnya.
                  </p>
                  <div className="keu-2col">
                    <label className="keu-fld">
                      <span className="keu-label">Kode alasan</span>
                      <select className="manual-input" value={alasan} onChange={(e) => setAlasan(e.target.value)}>
                        <option value="">— pilih —</option>
                        {kodeAlasan.map((k) => (
                          <option key={k.code} value={k.code}>
                            {k.code} — {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="keu-fld">
                      <span className="keu-label">Catatan</span>
                      <input className="manual-input" value={catatanBalik} onChange={(e) => setCatatanBalik(e.target.value)} />
                    </label>
                  </div>
                  <div className="manual-form-actions">
                    <button
                      type="button"
                      className="btn-outline t-danger"
                      disabled={pending || !alasan || catatanBalik.trim() === ""}
                      onClick={() =>
                        jalankan(
                          () =>
                            balikPasanganAntarUnit({ code, pasanganUuid: p.pasanganUuid, reasonCode: alasan, catatan: catatanBalik }),
                          () => {
                            setBuka(null);
                            setAlasan("");
                            setCatatanBalik("");
                          },
                        )
                      }
                    >
                      {pending ? "Membalik…" : "Ya, balik kedua kaki"}
                    </button>
                    <button type="button" className="btn-outline" disabled={pending} onClick={() => setBuka(null)}>
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
