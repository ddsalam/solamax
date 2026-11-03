"use client";

import {
  butuhKategoriOperasional,
  kategoriBeban,
  KATEGORI_OP_MANAGEMENT_FEE,
  PENJELASAN_BARIS_SISTEM,
  type BarisSistem,
} from "@/lib/keuangan-kas-model";
import { KATEGORI_OPERASIONAL } from "@/lib/klasifikasi-model";
import { bacaRupiah } from "@/lib/angka-input";
import { PratinjauAngka } from "./PratinjauAngka";
import { useState, useTransition } from "react";
import { batalkanPencairan } from "@/lib/edc-actions";
import { setujuiSetoran, simpanMutasiBeban, simpanMutasiKas, voidMutasiKas } from "@/lib/kas-actions";
import { PESAN_PENCAIRAN_DAN_BATCH_DIBATALKAN, PESAN_PENCAIRAN_DIBATALKAN } from "@/lib/keuangan-edc";
import type { JenisMutasi, SisiKategori } from "@/lib/keuangan-kas";
import type { AkunKas, BarisBuku, KakiBuku, TawaranSetoran } from "@/lib/keuangan-kas-model";
import { kategoriPihakLawan, pihakLawanUntuk, type PilihanPihakLawan } from "@/lib/pihak-lawan-model";
import { PecahMutasiForm } from "./PecahMutasiForm";
import { simpanPenebusan } from "@/lib/penebusan-actions";
import { KOMPONEN, LABEL_KOMPONEN, lewatPenebusan, ringkasKomponen, type Komponen } from "@/lib/penebusan-model";
import { KakiKomponen } from "./PenebusanForm";

type TeksKomponen = Record<Komponen, string>;
const KOMPONEN_KOSONG: TeksKomponen = { net: "", ppn: "", pph: "", pbbkb: "", nota: "" };

/**
 * Blok 2 Layar 3 — Buku kas besar & lima buku bank (mockup layar 3).
 *
 * ⛔ **KOLOM SALDO ADALAH ANGKA HITUNGAN, BUKAN ISIAN.** Tak ada satu pun
 * `<input>` untuk saldo di berkas ini, dan tak ada kolom saldo di `cash_ledger`
 * (0029). Kalau kelak ada yang menambahkan "input saldo awal biar cepat", yang
 * ia bangun adalah kolom yang bisa berselisih dengan mutasinya sendiri —
 * persis cacat workbook yang modul ini dibuat untuk menggantikan.
 *
 * Tawaran setoran: **ditawarkan, bukan diposting** (§1.4). Nominalnya sudah
 * terisi dari Rincian Penjualan, tetapi barisnya baru lahir setelah ada yang
 * MENYETUJUI — dan jejak siapa menyetujui tersimpan di baris itu.
 */

/** Label chip pengganti tombol "Batalkan" pada baris sistem. */
const LABEL_BARIS_SISTEM: Record<BarisSistem, string> = {
  saldo_awal: "saldo pembuka",
  pencairan_edc: "pencairan EDC",
  penebusan: "penebusan",
  antar_unit: "antar unit",
};

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function BukuKasPanel({
  code,
  date,
  akun,
  bukuPerAkun,
  saldoAwalPerAkun,
  kakiPerAkun,
  kategori,
  tawaran,
  nilaiTertunda,
  bolehTulis,
  bolehSettlement,
  pihakLawan,
  peta = [],
}: {
  code: string;
  date: string;
  akun: AkunKas[];
  bukuPerAkun: Record<string, BarisBuku[]>;
  saldoAwalPerAkun: Record<string, number>;
  kakiPerAkun: Record<string, KakiBuku>;
  kategori: { side: SisiKategori; label: string }[];
  tawaran: TawaranSetoran[];
  nilaiTertunda: number;
  bolehTulis: boolean;
  /**
   * Rencana 2026-11-02 — `canKelolaSettlementEdc` (staf Keuangan DAN HoF):
   * tombol "Batalkan pencairan" pada kaki pencairan EDC. Tidak membuka
   * "Batalkan" mutasi biasa bagi HoF — itu tetap `bolehTulis` (§10.12).
   */
  bolehSettlement: boolean;
  pihakLawan: PilihanPihakLawan[];
  /** Peta kategori operasional → pos, hanya untuk kalimat "akan tercatat di pos …" (K6 U3). */
  peta?: { category: string; account: string }[];
}) {
  const kasBesar = akun.find((a) => a.kind === "kas") ?? akun[0] ?? null;
  const [akunAktif, setAkunAktif] = useState<string>(kasBesar?.id ?? "");
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [bukaForm, setBukaForm] = useState(false);
  const [ket, setKet] = useState("");
  const [jenis, setJenis] = useState<JenisMutasi>("debet");
  const [katKey, setKatKey] = useState("");
  const [pihakId, setPihakId] = useState("");
  const [bukaPecah, setBukaPecah] = useState(false);
  const [nominal, setNominal] = useState("");
  const [jenisBiaya, setJenisBiaya] = useState("");
  const [noSo, setNoSo] = useState("");
  const [komponen, setKomponen] = useState<TeksKomponen>(KOMPONEN_KOSONG);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tertunda = tawaran.filter((t) => !t.sudahDibukukan);
  const baris = bukuPerAkun[akunAktif] ?? [];
  const kaki = kakiPerAkun[akunAktif] ?? { nMutasi: 0, totalMutasi: 0, saldoAkhir: 0 };
  const saldoAwal = saldoAwalPerAkun[akunAktif] ?? 0;
  const kategoriSisi = kategori.filter((k) => k.side === (jenis === "kredit" ? "kredit" : "debet"));
  const katTerpilih = kategoriSisi.find((k) => `${k.side}|${k.label}` === katKey) ?? null;
  const pilihanPihak = jenis === "adjustment" ? [] : pihakLawanUntuk(katTerpilih?.label ?? null, pihakLawan);
  const butuhPihak = jenis !== "adjustment" && kategoriPihakLawan(katTerpilih?.label);
  // K6 U4 (R19–R20): rekening bank + "Pembelian BBM" ⇒ field penebusan; Nominal
  // = Harga Gross. Predikat yang sama ditegakkan ulang di `simpanMutasiKas`.
  const akunTerbuka = akun.find((a) => a.id === akunAktif) ?? null;
  const modePenebusan = jenis !== "adjustment" && lewatPenebusan(akunTerbuka?.kind, katTerpilih?.label);
  const ringkas = ringkasKomponen({ ...komponen, gross: nominal });
  const siapPenebusan = ringkas.lengkap && ringkas.selisih === 0 && noSo.trim() !== "";
  // K6 U3 (R23): biaya / pendapatan lain-lain / management fee ⇒ satu simpan
  // menulis mutasi + baris Biaya. Field kedua HANYA untuk Biaya Operasional —
  // predikat yang sama ditegakkan `simpanMutasiBeban`.
  const modeBeban = jenis !== "adjustment" ? kategoriBeban(katTerpilih?.label) : null;
  const butuhJenisBiaya = jenis !== "adjustment" && butuhKategoriOperasional(katTerpilih?.label);
  const posDari = (k: string): string | null => peta.find((p) => p.category === k)?.account ?? null;
  const catatanBeban =
    modeBeban === "biaya_operasional"
      ? jenisBiaya === ""
        ? "Akan tercatat juga di Biaya Operasional — pilih jenis biayanya."
        : `Akan tercatat juga di Biaya Operasional → pos ${posDari(jenisBiaya) ?? "— belum ada pemetaan"}.`
      : modeBeban === "pendapatan_lain"
        ? "Akan tercatat juga di Pendapatan Lain-lain → pos 4200."
        : modeBeban === "management_fee"
          ? `Akan tercatat juga di Biaya → pos management fee (${KATEGORI_OP_MANAGEMENT_FEE.map(posDari).find((x) => x !== null) ?? "—"}).`
          : null;

  // Penyesuaian satu-satunya jenis yang arahnya tak tersirat dari namanya —
  // hanya di sana minus boleh diketik (dulu mustahil: semua non-digit dibuang).
  const hNominal = bacaRupiah(nominal, { bolehNegatif: jenis === "adjustment" });
  const angka = (): number => {
    if (hNominal.keadaan !== "sah" || hNominal.nilai === 0) return NaN;
    const n = hNominal.nilai;
    // Tanda debet/kredit ditentukan JENIS, bukan diketik: minus yang terlupa
    // adalah cara termudah membuat kredit menaikkan saldo.
    if (jenis === "adjustment") return n;
    return jenis === "kredit" ? -Math.abs(n) : Math.abs(n);
  };

  const simpan = (): void => {
    setErr(null);
    setMsg(null);
    const amount = angka();
    if (Number.isNaN(amount)) {
      setErr(
        hNominal.keadaan === "tolak" ? hNominal.pesan : "Nominal harus diisi dan bukan nol.",
      );
      return;
    }
    const kat = kategoriSisi.find((k) => `${k.side}|${k.label}` === katKey) ?? null;
    if (modePenebusan) {
      if (!siapPenebusan) return;
      const nilai = (f: Komponen): number => {
        const h = bacaRupiah(komponen[f], { bolehNegatif: f === "nota" });
        return h.keadaan === "sah" ? h.nilai : 0;
      };
      // Rekening & tanggal bayar = buku yang terbuka; server membuat baris kas
      // dan penebusannya dalam SATU transaksi (R21).
      start(async () => {
        const res = await simpanPenebusan({
          code,
          dariBukuBank: true,
          keterangan: ket,
          noSo,
          tanggalBayar: date,
          accountId: akunAktif,
          net: nilai("net"),
          ppn: nilai("ppn"),
          pph: nilai("pph"),
          pbbkb: nilai("pbbkb"),
          nota: nilai("nota"),
          gross: Math.abs(amount),
        });
        if (!res.ok) setErr(res.error);
        else {
          setMsg(`${res.pesan} Tampil juga di halaman Penebusan SO.`);
          setKet("");
          setNominal("");
          setNoSo("");
          setKomponen(KOMPONEN_KOSONG);
          setBukaForm(false);
        }
      });
      return;
    }
    if (modeBeban !== null && kat !== null && jenis !== "adjustment") {
      start(async () => {
        const res = await simpanMutasiBeban({
          code,
          date,
          accountId: akunAktif,
          keterangan: ket,
          jenis,
          categoryLabel: kat.label,
          amount,
          operationalCategory: butuhJenisBiaya ? jenisBiaya : null,
        });
        if (!res.ok) setErr(res.error);
        else {
          setMsg(
            `Mutasi dan baris ${modeBeban === "pendapatan_lain" ? "Pendapatan Lain-lain" : "Biaya"} tersimpan` +
              (res.hariBuku && res.hariBuku !== date ? ` di hari buku ${res.hariBuku} (hari ini sudah tutup hari).` : ".") +
              " Tampil juga di blok Biaya.",
          );
          setKet("");
          setNominal("");
          setJenisBiaya("");
          setBukaForm(false);
        }
      });
      return;
    }
    start(async () => {
      const res = await simpanMutasiKas({
        code,
        date,
        accountId: akunAktif,
        keterangan: ket,
        jenis,
        categorySide: jenis === "adjustment" ? null : (kat?.side ?? null),
        categoryLabel: jenis === "adjustment" ? null : (kat?.label ?? null),
        amount,
        pihakLawanId: butuhPihak && pihakId !== "" ? pihakId : null,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Mutasi tersimpan. Saldo di atas dihitung ulang dari mutasi.");
        setKet("");
        setNominal("");
        setPihakId("");
        setBukaForm(false);
      }
    });
  };

  const setujui = (): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await setujuiSetoran({
        code,
        date,
        accountId: akunAktif,
        manualEntryIds: [...pilih],
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`${res.n ?? 0} setoran disetujui dan masuk buku — tercatat atas nama Anda.`);
        setPilih(new Set());
      }
    });
  };

  // Konfirmasi DI TEMPAT (bukan `confirm()`): klik pertama menanyakan, klik
  // kedua membatalkan. Pembatalan tercatat selamanya atas nama pelakunya —
  // satu klik yang meleset tidak boleh cukup.
  const [yakin, setYakin] = useState<string | null>(null);
  const batalkan = (id: string): void => {
    setErr(null);
    setMsg(null);
    setYakin(null);
    start(async () => {
      const res = await voidMutasiKas({ code, date, id });
      if (!res.ok) setErr(res.error);
      else setMsg("Baris dibatalkan — tercatat, tidak dihapus.");
    });
  };

  // Kaki pencairan EDC: dibatalkan KETIGANYA lewat batch-nya, tak pernah satu.
  const batalPencairan = (settlementId: string, jugaBatch: boolean): void => {
    setErr(null);
    setMsg(null);
    setYakin(null);
    start(async () => {
      const res = await batalkanPencairan({ code, date, settlementId, jugaBatch });
      if (!res.ok) setErr(res.error);
      else setMsg(jugaBatch ? PESAN_PENCAIRAN_DAN_BATCH_DIBATALKAN : PESAN_PENCAIRAN_DIBATALKAN);
    });
  };

  // Kolom Tindakan tampil bagi pengetik buku DAN bagi pengelola settlement
  // (HoF) — isi tiap sel tetap memakai gerbangnya sendiri.
  const kolomTindakan = bolehTulis || bolehSettlement;

  return (
    <section aria-labelledby="blok-buku-kas">
      <div className="section-h">
        <h3 id="blok-buku-kas" className="text-h3">
          2 · Buku kas besar &amp; buku bank
        </h3>
        <span className="fs16 t-tertiary">
          Saldo dihitung dari mutasi — tidak pernah diketik, tidak pernah disimpan
        </span>
      </div>

      {bolehTulis && tertunda.length > 0 && (
        <div className="banner info keu-banner" role="status">
          <b>
            {tertunda.length} setoran senilai {rp(nilaiTertunda)} menunggu persetujuan
          </b>
          <p className="keu-p">
            Nilainya sudah diketahui SolaMax dari Rincian Penjualan — tidak perlu diketik ulang.
            Yang Anda lakukan di sini adalah <strong>menyetujui</strong>, dan persetujuannya
            tercatat atas nama Anda.
          </p>
          <ul className="keu-list">
            {tertunda.map((t) => (
              <li key={t.id}>
                <label className="keu-attest">
                  <input
                    type="checkbox"
                    checked={pilih.has(t.id)}
                    onChange={(e) => {
                      const n = new Set(pilih);
                      if (e.target.checked) n.add(t.id);
                      else n.delete(t.id);
                      setPilih(n);
                    }}
                  />
                  <span>
                    {t.keterangan} — <strong className="num">{rp(t.amount)}</strong>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              onClick={setujui}
              disabled={pending || pilih.size === 0}
            >
              Setujui {pilih.size > 0 ? `${pilih.size} setoran` : "setoran terpilih"}
            </button>
          </div>
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

      {/* Pemilih akun: kas besar + lima bank + EDC penampungan. */}
      <div className="keu-tabs" role="tablist" aria-label="Pilih buku">
        {akun.map((a) => (
          <button
            key={a.id}
            role="tab"
            type="button"
            aria-selected={a.id === akunAktif}
            className="keu-tab"
            onClick={() => setAkunAktif(a.id)}
          >
            {a.nama}
            {!a.active && <span className="keu-pill">nonaktif</span>}
          </button>
        ))}
      </div>

      <div className="card tbl-card tbl-scroll">
        <div className={`grid-head cols-buku${kolomTindakan ? "" : " ro"}`}>
          <span>Keterangan</span>
          <span>Kategori</span>
          <span className="right">Nominal</span>
          <span className="right">Saldo</span>
          {kolomTindakan && <span className="right">Tindakan</span>}
        </div>

        {/* Saldo awal: HASIL HITUNG dari mutasi sebelum hari ini, bukan isian. */}
        <div className={`grid-row cols-buku${kolomTindakan ? "" : " ro"}`}>
          <span className="t-secondary">Saldo awal hari ini</span>
          <span className="fs16 t-tertiary">dihitung dari mutasi sebelumnya</span>
          <span className="right num t-tertiary">—</span>
          <span className="right num w600">{rp(saldoAwal)}</span>
          {kolomTindakan && <span />}
        </div>

        {baris.length === 0 ? (
          <div className="empty-inline">Belum ada mutasi pada tanggal ini.</div>
        ) : (
          baris.map((b) => (
            <div className={`grid-row cols-buku${kolomTindakan ? "" : " ro"}`} key={b.id}>
              <span className="w600">
                {b.keterangan}
                {b.dariSetoranPengawas && (
                  <span className="keu-pill" title="Lahir dari setoran pengawas yang disetujui">
                    dari Rincian
                  </span>
                )}
              </span>
              <span className="fs16 t-secondary">{b.categoryLabel ?? "—"}</span>
              <span className={`right num ${b.amount < 0 ? "t-danger" : ""}`}>{rp(b.amount)}</span>
              <span className="right num t-secondary">{rp(b.saldoBerjalan)}</span>
              {kolomTindakan && (
                <span className="right">
                  {b.barisSistem === "pencairan_edc" && bolehSettlement && b.edcSettlementId ? (
                    yakin === b.id ? (
                      <span className="keu-yakin">
                        <button
                          type="button"
                          className="btn-outline sm"
                          onClick={() => batalPencairan(b.edcSettlementId as string, false)}
                          disabled={pending}
                        >
                          Batalkan pencairan saja (untuk dikoreksi)
                        </button>
                        <button
                          type="button"
                          className="btn-outline sm t-danger"
                          onClick={() => batalPencairan(b.edcSettlementId as string, true)}
                          disabled={pending}
                        >
                          Batalkan pencairan &amp; batch (ganda)
                        </button>
                        <button
                          type="button"
                          className="btn-outline sm"
                          onClick={() => setYakin(null)}
                          disabled={pending}
                        >
                          Tidak
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-outline sm"
                        title={PENJELASAN_BARIS_SISTEM.pencairan_edc}
                        onClick={() => setYakin(b.id)}
                        disabled={pending}
                      >
                        Batalkan pencairan
                      </button>
                    )
                  ) : b.barisSistem !== null ? (
                    <span className="keu-chip" title={PENJELASAN_BARIS_SISTEM[b.barisSistem]}>
                      {LABEL_BARIS_SISTEM[b.barisSistem]}
                    </span>
                  ) : yakin === b.id ? (
                    <span className="keu-yakin">
                      <button
                        type="button"
                        className="btn-outline sm t-danger"
                        onClick={() => batalkan(b.id)}
                        disabled={pending}
                      >
                        Ya, batalkan
                      </button>
                      <button
                        type="button"
                        className="btn-outline sm"
                        onClick={() => setYakin(null)}
                        disabled={pending}
                      >
                        Tidak
                      </button>
                    </span>
                  ) : bolehTulis ? (
                    <button
                      type="button"
                      className="btn-outline sm"
                      onClick={() => setYakin(b.id)}
                      disabled={pending}
                    >
                      Batalkan
                    </button>
                  ) : null}
                </span>
              )}
            </div>
          ))
        )}

        <div className={`grid-total cols-buku${kolomTindakan ? "" : " ro"}`}>
          <span>
            {kaki.nMutasi} mutasi hari ini
          </span>
          <span />
          <span className="right num">{rp(kaki.totalMutasi)}</span>
          <span className="right num">{rp(kaki.saldoAkhir)}</span>
          {kolomTindakan && <span />}
        </div>
      </div>

      {bolehTulis && !bukaForm && !bukaPecah && (
        <div className="manual-form-actions">
          <button type="button" className="btn-tint sm" onClick={() => setBukaForm(true)}>
            Tambah mutasi yang tidak lewat Rincian…
          </button>
          <button type="button" className="btn-tint sm" onClick={() => setBukaPecah(true)}>
            Pecah satu mutasi jadi beberapa baris…
          </button>
        </div>
      )}

      {bolehTulis && bukaPecah && akunAktif !== "" && (
        <PecahMutasiForm
          code={code}
          date={date}
          accountId={akunAktif}
          namaAkun={akun.find((a) => a.id === akunAktif)?.nama ?? ""}
          kategori={kategori}
          pihakLawan={pihakLawan}
          onSelesai={(m) => {
            setBukaPecah(false);
            if (m !== null) setMsg(m);
          }}
        />
      )}

      {bolehTulis && bukaForm && (
        <div className="card card-pad-lg keu-form">
          <h4 className="text-h3">Tambah mutasi</h4>
          <p className="fs16 t-tertiary mt2">
            Tanda nominal mengikuti jenis — ketik angkanya saja. Khusus <strong>Penyesuaian</strong>:
            ketik minus bila saldo berkurang.
          </p>
          <label className="keu-fld">
            <span className="keu-label">Keterangan</span>
            <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
          </label>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Jenis</span>
              <select
                className="manual-input"
                value={jenis}
                onChange={(e) => {
                  setJenis(e.target.value as JenisMutasi);
                  setKatKey("");
                  setPihakId("");
                }}
              >
                <option value="debet">Debet (kas masuk)</option>
                <option value="kredit">Kredit (kas keluar)</option>
                <option value="adjustment">Penyesuaian</option>
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nominal</span>
              <input
                className="manual-input num"
                // Keypad angka ponsel tak punya tombol minus — Penyesuaian butuh itu.
                inputMode={jenis === "adjustment" ? "text" : "numeric"}
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="contoh 1.500.000"
              />
              <PratinjauAngka hasil={hNominal} />
            </label>
          </div>
          {jenis !== "adjustment" && (
            <label className="keu-fld">
              <span className="keu-label">Kategori</span>
              <select
                className="manual-input"
                value={katKey}
                onChange={(e) => {
                  setKatKey(e.target.value);
                  setPihakId("");
                  setJenisBiaya("");
                }}
              >
                <option value="">— pilih kategori —</option>
                {kategoriSisi.map((k) => (
                  <option key={`${k.side}|${k.label}`} value={`${k.side}|${k.label}`}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {butuhJenisBiaya && (
            <label className="keu-fld">
              <span className="keu-label">Jenis biaya (wajib untuk Biaya Operasional)</span>
              <select className="manual-input" value={jenisBiaya} onChange={(e) => setJenisBiaya(e.target.value)}>
                <option value="">— pilih jenis biaya —</option>
                {KATEGORI_OPERASIONAL.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          {catatanBeban !== null && <p className="fs16 t-tertiary keu-p">{catatanBeban}</p>}
          {modePenebusan && (
            <fieldset className="keu-fld">
              <legend className="keu-label">Penebusan SO — muncul karena kategori Pembelian BBM</legend>
              <p className="fs16 t-tertiary">
                Nominal di atas adalah <strong>Harga Gross</strong>. Tanggal bayar {date} dan rekening{" "}
                {akunTerbuka?.nama ?? ""} diambil dari buku ini.
              </p>
              <div className="keu-2col">
                <label className="keu-fld">
                  <span className="keu-label">Nomor SO</span>
                  <input className="manual-input" value={noSo} onChange={(e) => setNoSo(e.target.value)} />
                </label>
                {KOMPONEN.map((f) => (
                  <label className="keu-fld" key={f}>
                    <span className="keu-label">{LABEL_KOMPONEN[f]}</span>
                    <input
                      className="manual-input num"
                      inputMode="text"
                      value={komponen[f]}
                      onChange={(e) => setKomponen((t) => ({ ...t, [f]: e.target.value }))}
                      placeholder={f === "nota" ? "0 — atau −5.000 untuk nota kredit" : "contoh 11.000.000"}
                    />
                    <PratinjauAngka hasil={bacaRupiah(komponen[f], { bolehNegatif: f === "nota" })} />
                  </label>
                ))}
              </div>
              <KakiKomponen k={ringkas} />
            </fieldset>
          )}
          {butuhPihak && (
            <label className="keu-fld">
              <span className="keu-label">Pihak lawan (wajib untuk kategori ini)</span>
              <select className="manual-input" value={pihakId} onChange={(e) => setPihakId(e.target.value)}>
                <option value="">— pilih pihak lawan —</option>
                {pilihanPihak.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama}
                  </option>
                ))}
              </select>
              {pilihanPihak.length === 0 && (
                <span className="fs16 t-warning keu-p">
                  Belum ada pihak lawan aktif yang cocok —{" "}
                  <a href={`/keuangan/unit/${code}/pihak-lawan`}>tambahkan di halaman Pihak lawan</a>.
                </span>
              )}
            </label>
          )}
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              onClick={simpan}
              disabled={
                pending ||
                hNominal.keadaan === "tolak" ||
                (modePenebusan && !siapPenebusan) ||
                (butuhJenisBiaya && jenisBiaya === "")
              }
            >
              {pending ? "Menyimpan…" : modePenebusan ? "Simpan mutasi & penebusan" : "Simpan mutasi"}
            </button>
            {modePenebusan && ringkas.lengkap && ringkas.selisih !== 0 && (
              <span className="fs16 t-danger">Simpan aktif bila selisihnya Rp 0.</span>
            )}
            <button
              type="button"
              className="btn-outline"
              onClick={() => setBukaForm(false)}
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
