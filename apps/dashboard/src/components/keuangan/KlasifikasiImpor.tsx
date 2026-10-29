"use client";

/**
 * Layar klasifikasi rekening koran per unit × bulan (rencana 2026-10-29 U11;
 * R9, R11, R21, R23, R25, R27; KTD6, KTD8).
 *
 *   · tabel baris impor terurut tanggal bank, saring status (terbuka /
 *     tercocokkan / diparkir / pra-cut-over) & cari nominal/keterangan; sisa
 *     baris terbuka selalu terlihat;
 *   · satu baris dibuka di tempat menjadi SATU formulir dengan satu pilihan
 *     "Jenis penyelesaian" — hanya isian jenis itu yang tampil;
 *   · mode "cocokkan N:M" memilih banyak baris bank & baris buku, Σ berjalan,
 *     Simpan aktif hanya di Rp 0 (per rekening — server memeriksa ulang);
 *   · baris diparkir punya tombol "Pindahkan dari penampung";
 *   · daftar "baris buku tanpa pasangan" + selisihnya.
 *
 * Semua keputusan ditegakkan server (`klasifikasi-actions.ts`,
 * `cocokkanManual`, `simpanPenebusan`); komponen ini hanya pintunya. Nominal
 * baris impor tak pernah dikirim balik — server membacanya ulang.
 */
import { useMemo, useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import { rekeningAntarUnit } from "@/lib/antar-unit-actions";
import { JENIS_ANTAR_UNIT, LABEL_JENIS_ANTAR_UNIT } from "@/lib/antar-unit-model";
import { cocokkanManual } from "@/lib/cocok-bank-actions";
import {
  klasifikasiAntarUnit,
  klasifikasiKategori,
  klasifikasiParkir,
  klasifikasiPecah,
  pindahkanDariPenampung,
} from "@/lib/klasifikasi-actions";
import { KATEGORI_OPERASIONAL, LABEL_STATUS_IMPOR, sectionBeban, type StatusBarisImpor } from "@/lib/klasifikasi-model";
import type { BarisImporTampil, BukuTanpaPasangan } from "@/lib/klasifikasi-queries";
import { KATEGORI_PENAMPUNG } from "@/lib/keuangan-sisi-kas";
import { kategoriPihakLawan, pihakLawanUntuk, rpSen, rupiahKeSen, type PilihanPihakLawan } from "@/lib/pihak-lawan-model";
import { PenebusanForm } from "./PenebusanForm";

type Kategori = { side: "debet" | "kredit"; label: string };

const bertanda = (sen: number): string => `${sen < 0 ? "−" : sen > 0 ? "+" : ""}${rpSen(sen)}`;

const JENIS = ["cocok", "kategori", "antar", "penebusan", "pecah", "parkir"] as const;
type Jenis = (typeof JENIS)[number];
const LABEL_JENIS: Record<Jenis, string> = {
  cocok: "Cocokkan kandidat",
  kategori: "Kategori + pihak lawan",
  antar: "Antar unit",
  penebusan: "Penebusan",
  pecah: "Pecah",
  parkir: "Parkir (belum teridentifikasi)",
};

interface Bersama {
  code: string;
  kategori: Kategori[];
  pihakLawan: PilihanPihakLawan[];
  unitLain: { code: string; name: string }[];
  rekeningNama: Record<string, string>;
  onSelesai: (pesan: string) => void;
}

function Galat({ teks }: { teks: string | null }) {
  return teks === null ? null : (
    <div className="banner danger keu-banner" role="alert">
      {teks}
    </div>
  );
}

/** Kategori + pihak lawan + kategori operasional — dipakai Kategori, Pecah, dan Pindahkan. */
function PilihKategori({
  sisi,
  kategori,
  pihakLawan,
  nilai,
  ubah,
  bolehPenampung = false,
}: {
  sisi: "debet" | "kredit";
  kategori: Kategori[];
  pihakLawan: PilihanPihakLawan[];
  nilai: { kat: string; pihak: string; op: string };
  ubah: (v: { kat: string; pihak: string; op: string }) => void;
  bolehPenampung?: boolean;
}) {
  const daftar = kategori.filter((k) => k.side === sisi && (bolehPenampung || k.label !== KATEGORI_PENAMPUNG));
  return (
    <>
      <label className="keu-fld">
        <span className="keu-label">Kategori ({sisi})</span>
        <select className="manual-input" value={nilai.kat} onChange={(e) => ubah({ kat: e.target.value, pihak: "", op: "" })}>
          <option value="">— pilih kategori —</option>
          {daftar.map((k) => (
            <option key={k.label} value={k.label}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {kategoriPihakLawan(nilai.kat) && (
        <label className="keu-fld">
          <span className="keu-label">Pihak lawan (wajib)</span>
          <select className="manual-input" value={nilai.pihak} onChange={(e) => ubah({ ...nilai, pihak: e.target.value })}>
            <option value="">— pilih pihak lawan —</option>
            {pihakLawanUntuk(nilai.kat, pihakLawan).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama}
              </option>
            ))}
          </select>
        </label>
      )}
      {sectionBeban(nilai.kat) !== null && (
        <label className="keu-fld">
          <span className="keu-label">Kategori operasional (wajib — masuk laba)</span>
          <select className="manual-input" value={nilai.op} onChange={(e) => ubah({ ...nilai, op: e.target.value })}>
            <option value="">— pilih kategori operasional —</option>
            {KATEGORI_OPERASIONAL.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

const pilihanLengkap = (v: { kat: string; pihak: string; op: string }): boolean =>
  v.kat !== "" && (!kategoriPihakLawan(v.kat) || v.pihak !== "") && (sectionBeban(v.kat) === null || v.op !== "");

/** Satu formulir, satu "Jenis penyelesaian" (U11 butir 5). */
function FormPenyelesaian({ b, ctx }: { b: BarisImporTampil; ctx: Bersama }) {
  const debit = b.amountSen < 0;
  const sisi = debit ? "kredit" : "debet";
  const [jenis, setJenis] = useState<Jenis>(b.kandidat.length > 0 ? "cocok" : b.so && debit ? "penebusan" : "kategori");
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [kandidat, setKandidat] = useState(b.kandidat.length === 1 ? b.kandidat[0]!.cashLedgerId : "");
  const [kat, setKat] = useState({ kat: "", pihak: "", op: "" });
  const [ket, setKet] = useState("");
  const [lawan, setLawan] = useState("");
  const [rekLawan, setRekLawan] = useState<{ id: string; nama: string }[] | null>(null);
  const [akunLawan, setAkunLawan] = useState("");
  const [jenisAu, setJenisAu] = useState<string>("titipan");
  const [catatan, setCatatan] = useState("");
  const [pecahan, setPecahan] = useState([
    { n: "", v: { kat: "", pihak: "", op: "" }, ket: "" },
    { n: "", v: { kat: "", pihak: "", op: "" }, ket: "" },
  ]);

  const jalankan = (f: () => Promise<{ ok: true; pesan: string } | { ok: false; error: string }>) => {
    setGalat(null);
    start(async () => {
      const r = await f();
      if (!r.ok) setGalat(r.error);
      else ctx.onSelesai(r.pesan);
    });
  };

  const pecahSen = pecahan.map((p) => {
    const h = bacaRupiah(p.n);
    return h.keadaan === "sah" && h.nilai > 0 ? rupiahKeSen(h.nilai) : null;
  });
  const selisihPecah = pecahSen.some((s) => s === null) ? null : pecahSen.reduce<number>((a, s) => a + s!, 0) - Math.abs(b.amountSen);

  const pilihLawan = (code: string) => {
    setLawan(code);
    setRekLawan(null);
    setAkunLawan("");
    if (code === "") return;
    start(async () => {
      const r = await rekeningAntarUnit({ code });
      if (r.ok) setRekLawan(r.rekening);
      else setGalat(r.error);
    });
  };

  return (
    <div className="card card-pad-lg keu-form mt4">
      <fieldset>
        <legend className="keu-label">Jenis penyelesaian</legend>
        <div className="grid-row">
          {JENIS.filter((j) => j !== "penebusan" || debit).map((j) => (
            <label key={j} className="fs16">
              <input type="radio" name={`jenis-${b.id}`} checked={jenis === j} onChange={() => setJenis(j)} /> {LABEL_JENIS[j]}
            </label>
          ))}
        </div>
      </fieldset>
      <Galat teks={galat} />

      {jenis === "cocok" &&
        (b.kandidat.length === 0 ? (
          <div className="empty-inline mt4">
            Tak ada kandidat baris buku{b.tanda ? ` (${b.tanda})` : ""}. Pilih jenis lain, atau pakai “Cocokkan N:M”.
          </div>
        ) : (
          <fieldset className="mt4">
            {b.kandidat.map((k) => (
              <label key={k.cashLedgerId} className="keu-fld">
                <span className="fs16">
                  <input type="radio" name={`kand-${b.id}`} checked={kandidat === k.cashLedgerId} onChange={() => setKandidat(k.cashLedgerId)} />{" "}
                  {k.businessDate}
                  {k.tanggalAsal && k.tanggalAsal !== k.businessDate ? ` (asal ${k.tanggalAsal})` : ""} ·{" "}
                  <span className="num">{bertanda(k.amountSen)}</span> · {k.categoryLabel ?? "—"} · {k.keterangan} ·{" "}
                  <span className="t-tertiary">{k.aturan}</span>
                </span>
              </label>
            ))}
            <div className="manual-form-actions">
              <button
                type="button"
                className="btn-navy"
                disabled={pending || kandidat === ""}
                onClick={() => jalankan(() => cocokkanManual({ code: ctx.code, mutasiIds: [b.id], kasIds: [kandidat] }))}
              >
                {pending ? "Menyimpan…" : "Cocokkan"}
              </button>
            </div>
          </fieldset>
        ))}

      {jenis === "kategori" && (
        <div className="keu-2col mt4">
          <PilihKategori sisi={sisi} kategori={ctx.kategori} pihakLawan={ctx.pihakLawan} nilai={kat} ubah={setKat} />
          <label className="keu-fld">
            <span className="keu-label">Keterangan (kosong = keterangan bank)</span>
            <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
          </label>
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending || !pilihanLengkap(kat)}
              onClick={() =>
                jalankan(() =>
                  klasifikasiKategori({
                    code: ctx.code,
                    mutasiId: b.id,
                    categoryLabel: kat.kat,
                    pihakLawanId: kat.pihak || null,
                    operationalCategory: kat.op || null,
                    keterangan: ket || null,
                  }),
                )
              }
            >
              {pending ? "Menyimpan…" : "Simpan klasifikasi"}
            </button>
          </div>
        </div>
      )}

      {jenis === "antar" && (
        <div className="keu-2col mt4">
          <p className="fs16 t-tertiary">
            {debit
              ? "Debit ini keluar ke unit lawan: unit ini memberi (piutang ke unit lawan)."
              : "Kredit ini masuk dari unit lawan: unit ini berhutang ke unit lawan."}{" "}
            Kaki unit lawan dibukukan di bukunya dan menunggu rekening korannya sendiri. Wajib berperan Keuangan di kedua unit.
          </p>
          <p className="fs14 t-warning">
            Bukan untuk pembayaran pelanggan unit lain ke rekening ini — kaki unit lain jadi baris kas yang tak ada di
            rekening korannya dan menahan tutup bulannya. Parkir saja; HoF yang menyelesaikan.
          </p>
          <label className="keu-fld">
            <span className="keu-label">Unit lawan</span>
            <select className="manual-input" value={lawan} onChange={(e) => pilihLawan(e.target.value)}>
              <option value="">— pilih unit —</option>
              {ctx.unitLain.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="keu-fld">
            <span className="keu-label">Rekening unit lawan</span>
            <select className="manual-input" value={akunLawan} disabled={rekLawan === null} onChange={(e) => setAkunLawan(e.target.value)}>
              <option value="">— pilih rekening —</option>
              {(rekLawan ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nama}
                </option>
              ))}
            </select>
          </label>
          <label className="keu-fld">
            <span className="keu-label">Jenis</span>
            <select className="manual-input" value={jenisAu} onChange={(e) => setJenisAu(e.target.value)}>
              {JENIS_ANTAR_UNIT.map((j) => (
                <option key={j} value={j}>
                  {LABEL_JENIS_ANTAR_UNIT[j]}
                </option>
              ))}
            </select>
          </label>
          <label className="keu-fld">
            <span className="keu-label">Catatan (kosong = keterangan bank)</span>
            <input className="manual-input" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </label>
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending || lawan === "" || akunLawan === ""}
              onClick={() =>
                jalankan(() =>
                  klasifikasiAntarUnit({ code: ctx.code, mutasiId: b.id, lawanCode: lawan, lawanAccountId: akunLawan, jenis: jenisAu, catatan }),
                )
              }
            >
              {pending ? "Menyimpan…" : "Catat pasangan antar unit"}
            </button>
          </div>
        </div>
      )}

      {jenis === "penebusan" && (
        <PenebusanForm
          code={ctx.code}
          rekening={[{ id: b.accountId, nama: ctx.rekeningNama[b.accountId] ?? "Rekening" }]}
          isianAwal={{ noSo: b.so ?? "", tanggalBayar: b.tanggalBank, accountId: b.accountId, gross: -b.amountSen / 100, mutasiBankId: b.id }}
          onSelesai={ctx.onSelesai}
        />
      )}

      {jenis === "pecah" && (
        <div className="mt4">
          {pecahan.map((p, i) => (
            <div className="keu-2col mt4" key={i}>
              <label className="keu-fld">
                <span className="keu-label">Baris {i + 1} · nominal (tanpa tanda)</span>
                <input
                  className="manual-input num"
                  inputMode="numeric"
                  value={p.n}
                  onChange={(e) => setPecahan(pecahan.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))}
                />
              </label>
              <PilihKategori
                sisi={sisi}
                kategori={ctx.kategori}
                pihakLawan={ctx.pihakLawan}
                nilai={p.v}
                ubah={(v) => setPecahan(pecahan.map((x, j) => (j === i ? { ...x, v } : x)))}
              />
              <label className="keu-fld">
                <span className="keu-label">Keterangan baris (opsional)</span>
                <input
                  className="manual-input"
                  value={p.ket}
                  onChange={(e) => setPecahan(pecahan.map((x, j) => (j === i ? { ...x, ket: e.target.value } : x)))}
                />
              </label>
            </div>
          ))}
          <div className="manual-form-actions">
            <button type="button" className="btn-outline sm" onClick={() => setPecahan([...pecahan, { n: "", v: { kat: "", pihak: "", op: "" }, ket: "" }])}>
              Tambah baris
            </button>
            {pecahan.length > 2 && (
              <button type="button" className="btn-outline sm" onClick={() => setPecahan(pecahan.slice(0, -1))}>
                Hapus baris terakhir
              </button>
            )}
            <span className={`fs16 ${selisihPecah === 0 ? "t-secondary" : "t-danger"}`} aria-live="polite">
              {selisihPecah === null ? "Isi semua nominal" : selisihPecah === 0 ? "Selisih Rp 0" : `Selisih ${bertanda(selisihPecah)}`}
            </span>
            <button
              type="button"
              className="btn-navy"
              disabled={pending || selisihPecah !== 0 || !pecahan.every((p) => pilihanLengkap(p.v))}
              onClick={() =>
                jalankan(() =>
                  klasifikasiPecah({
                    code: ctx.code,
                    mutasiId: b.id,
                    baris: pecahan.map((p, i) => ({
                      amount: pecahSen[i]! / 100,
                      categoryLabel: p.v.kat,
                      pihakLawanId: p.v.pihak || null,
                      operationalCategory: p.v.op || null,
                      keterangan: p.ket || null,
                    })),
                  }),
                )
              }
            >
              {pending ? "Menyimpan…" : "Simpan pecahan"}
            </button>
          </div>
        </div>
      )}

      {jenis === "parkir" && (
        <div className="keu-2col mt4">
          <p className="fs16 t-tertiary">
            Diparkir di “{KATEGORI_PENAMPUNG}”: saldo bank tetap benar, penampung wajib nol sebelum bulan ditutup.
          </p>
          <label className="keu-fld">
            <span className="keu-label">Catatan (opsional)</span>
            <input className="manual-input" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </label>
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending}
              onClick={() => jalankan(() => klasifikasiParkir({ code: ctx.code, mutasiId: b.id, catatan: catatan || null }))}
            >
              {pending ? "Menyimpan…" : "Parkir"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FormPindah({ b, ctx, hariIni }: { b: BarisImporTampil; ctx: Bersama; hariIni: string }) {
  const [v, setV] = useState({ kat: "", pihak: "", op: "" });
  const [tanggal, setTanggal] = useState(hariIni);
  const [ket, setKet] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card card-pad-lg keu-form mt4">
      <p className="fs16 t-tertiary">
        Dua baris baru di rekening yang sama: pembalik di penampung + baris tujuan. Baris parkir tidak disunting.
      </p>
      <Galat teks={galat} />
      <div className="keu-2col">
        <label className="keu-fld">
          <span className="keu-label">Tanggal pemindahan</span>
          <input className="manual-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </label>
        <PilihKategori sisi={b.amountSen < 0 ? "kredit" : "debet"} kategori={ctx.kategori} pihakLawan={ctx.pihakLawan} nilai={v} ubah={setV} />
        <label className="keu-fld">
          <span className="keu-label">Keterangan (opsional)</span>
          <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
        </label>
      </div>
      <div className="manual-form-actions">
        <button
          type="button"
          className="btn-navy"
          disabled={pending || !pilihanLengkap(v) || b.parkirId === null}
          onClick={() => {
            setGalat(null);
            start(async () => {
              const r = await pindahkanDariPenampung({
                code: ctx.code,
                parkirId: b.parkirId!,
                tanggal,
                categoryLabel: v.kat,
                pihakLawanId: v.pihak || null,
                operationalCategory: v.op || null,
                keterangan: ket || null,
              });
              if (!r.ok) setGalat(r.error);
              else ctx.onSelesai(r.pesan);
            });
          }}
        >
          {pending ? "Menyimpan…" : "Pindahkan dari penampung"}
        </button>
      </div>
    </div>
  );
}

export function KlasifikasiImpor({
  code,
  baris,
  buku,
  kategori,
  pihakLawan,
  unitLain,
  rekeningNama,
  bolehTulis,
  hariIni,
}: {
  code: string;
  baris: BarisImporTampil[];
  buku: BukuTanpaPasangan[];
  kategori: Kategori[];
  pihakLawan: PilihanPihakLawan[];
  unitLain: { code: string; name: string }[];
  rekeningNama: Record<string, string>;
  bolehTulis: boolean;
  hariIni: string;
}) {
  const [status, setStatus] = useState<StatusBarisImpor | "semua">("terbuka");
  const [cari, setCari] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [nm, setNm] = useState(false);
  const [pilihBank, setPilihBank] = useState<Set<string>>(new Set());
  const [pilihBuku, setPilihBuku] = useState<Set<string>>(new Set());
  const [galatNm, setGalatNm] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sisa = baris.filter((b) => b.status === "terbuka").length;
  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    // Nominal dibaca dengan pembaca angka bersama (titik ribuan, koma desimal) —
    // cocok bila sama dengan |nominal| baris; selainnya dicari sebagai teks.
    const n = bacaRupiah(q);
    const senCari = n.keadaan === "sah" ? rupiahKeSen(Math.abs(n.nilai)) : null;
    return baris.filter(
      (b) =>
        (status === "semua" || b.status === status) &&
        (q === "" ||
          b.keterangan.toLowerCase().includes(q) ||
          (senCari !== null && Math.abs(b.amountSen) === senCari) ||
          (b.so ?? "").toLowerCase().includes(q)),
    );
  }, [baris, status, cari]);

  const ctx: Bersama = {
    code,
    kategori,
    pihakLawan,
    unitLain,
    rekeningNama,
    onSelesai: (p) => {
      setPesan(p);
      setBuka(null);
    },
  };

  const sigmaBank = baris.filter((b) => pilihBank.has(b.id)).reduce((s, b) => s + b.amountSen, 0);
  const sigmaBuku = buku.filter((k) => pilihBuku.has(k.id)).reduce((s, k) => s + k.amountSen, 0);
  const selisihNm = sigmaBank - sigmaBuku;
  const toggle = (set: Set<string>, id: string, ubah: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    ubah(n);
  };

  const sigmaTerbuka = baris.filter((b) => b.status === "terbuka").reduce((s, b) => s + b.amountSen, 0);
  const sigmaBukuTanpa = buku.reduce((s, k) => s + k.amountSen, 0);

  return (
    <>
      {pesan !== null && (
        <div className="banner info keu-banner mt4" role="status">
          {pesan}
        </div>
      )}
      <div className="grid-row mt4">
        <label className="keu-fld">
          <span className="keu-label">Status</span>
          <select className="manual-input" value={status} onChange={(e) => setStatus(e.target.value as StatusBarisImpor | "semua")}>
            <option value="semua">Semua</option>
            {(Object.keys(LABEL_STATUS_IMPOR) as StatusBarisImpor[]).map((s) => (
              <option key={s} value={s}>
                {LABEL_STATUS_IMPOR[s]} ({baris.filter((b) => b.status === s).length})
              </option>
            ))}
          </select>
        </label>
        <label className="keu-fld">
          <span className="keu-label">Cari nominal / keterangan / SO</span>
          <input className="manual-input" value={cari} onChange={(e) => setCari(e.target.value)} />
        </label>
        <span className="fs16 w600" aria-live="polite">
          Sisa terbuka: {sisa} dari {baris.filter((b) => b.status !== "pra-cut-over").length} baris
        </span>
        {bolehTulis && (
          <button
            type="button"
            className="btn-outline sm"
            onClick={() => {
              setNm(!nm);
              setPilihBank(new Set());
              setPilihBuku(new Set());
              setGalatNm(null);
            }}
          >
            {nm ? "Tutup mode N:M" : "Cocokkan N:M"}
          </button>
        )}
      </div>

      {nm && (
        <div className="card card-pad-lg mt4" aria-live="polite">
          <div className="grid-row">
            <span className="fs16">
              Σ bank <span className="num w600">{bertanda(sigmaBank)}</span>
            </span>
            <span className="fs16">
              Σ buku <span className="num w600">{bertanda(sigmaBuku)}</span>
            </span>
            <span className={`fs16 ${selisihNm === 0 ? "t-secondary" : "t-danger"}`}>
              Selisih <span className="num w600">{bertanda(selisihNm)}</span>
            </span>
            <button
              type="button"
              className="btn-navy"
              disabled={pending || pilihBank.size === 0 || selisihNm !== 0}
              onClick={() => {
                setGalatNm(null);
                start(async () => {
                  const r = await cocokkanManual({ code, mutasiIds: [...pilihBank], kasIds: [...pilihBuku] });
                  if (!r.ok) setGalatNm(r.error);
                  else {
                    setPesan(r.pesan);
                    setNm(false);
                    setPilihBank(new Set());
                    setPilihBuku(new Set());
                  }
                });
              }}
            >
              {pending ? "Menyimpan…" : "Simpan kelompok"}
            </button>
          </div>
          <p className="fs14 t-tertiary mt2">Centang baris bank (tabel atas) dan baris buku (tabel bawah). Simpan aktif hanya bila selisihnya Rp 0.</p>
          <Galat teks={galatNm} />
        </div>
      )}

      <div className="tbl-scroll mt4">
        <table className="fs16">
          <thead>
            <tr>
              {nm && <th />}
              <th className="left">Tanggal bank</th>
              <th className="left">Rekening</th>
              <th className="left">Keterangan</th>
              <th>Nominal</th>
              <th className="left">Status</th>
              {bolehTulis && <th />}
            </tr>
          </thead>
          <tbody>
            {tampil.length === 0 && (
              <tr>
                <td colSpan={7} className="t-tertiary">
                  Tak ada baris untuk saringan ini.
                </td>
              </tr>
            )}
            {tampil.map((b) => (
              <FragmentBaris
                key={b.id}
                b={b}
                nm={nm}
                dipilih={pilihBank.has(b.id)}
                onPilih={() => toggle(pilihBank, b.id, setPilihBank)}
                bolehTulis={bolehTulis}
                terbuka={buka === b.id}
                onBuka={() => setBuka(buka === b.id ? null : b.id)}
                ctx={ctx}
                hariIni={hariIni}
              />
            ))}
          </tbody>
        </table>
      </div>

      <section className="card card-pad-lg mt6" aria-labelledby="buku-tanpa">
        <h3 id="buku-tanpa" className="text-h3">
          Baris buku tanpa pasangan
        </h3>
        <div className="grid-row mt2">
          <span className="fs16">
            Σ baris bank terbuka <span className="num w600">{bertanda(sigmaTerbuka)}</span>
          </span>
          <span className="fs16">
            Σ baris buku tanpa pasangan <span className="num w600">{bertanda(sigmaBukuTanpa)}</span>
          </span>
          <span className={`fs16 ${sigmaTerbuka - sigmaBukuTanpa === 0 ? "t-secondary" : "t-danger"}`}>
            Selisih <span className="num w600">{bertanda(sigmaTerbuka - sigmaBukuTanpa)}</span>
          </span>
        </div>
        {buku.length === 0 ? (
          <div className="empty-inline mt4">Semua baris buku rekening ini bulan ini sudah berpasangan.</div>
        ) : (
          <div className="tbl-scroll mt4">
            <table className="fs16">
              <thead>
                <tr>
                  {nm && <th />}
                  <th className="left">Tanggal</th>
                  <th className="left">Rekening</th>
                  <th className="left">Kategori</th>
                  <th className="left">Keterangan</th>
                  <th>Nominal</th>
                </tr>
              </thead>
              <tbody>
                {buku.map((k) => (
                  <tr key={k.id}>
                    {nm && (
                      <td>
                        <input type="checkbox" aria-label="pilih baris buku" checked={pilihBuku.has(k.id)} onChange={() => toggle(pilihBuku, k.id, setPilihBuku)} />
                      </td>
                    )}
                    <td>
                      {k.tanggalAsal ?? k.businessDate}
                      {k.tanggalAsal && k.tanggalAsal !== k.businessDate && <div className="fs14 t-tertiary">dibukukan {k.businessDate}</div>}
                    </td>
                    <td>{rekeningNama[k.accountId] ?? "—"}</td>
                    <td>{k.categoryLabel ?? "—"}</td>
                    <td>{k.keterangan}</td>
                    <td className="num">{bertanda(k.amountSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function FragmentBaris({
  b,
  nm,
  dipilih,
  onPilih,
  bolehTulis,
  terbuka,
  onBuka,
  ctx,
  hariIni,
}: {
  b: BarisImporTampil;
  nm: boolean;
  dipilih: boolean;
  onPilih: () => void;
  bolehTulis: boolean;
  terbuka: boolean;
  onBuka: () => void;
  ctx: Bersama;
  hariIni: string;
}) {
  const bisaSelesai = bolehTulis && b.status === "terbuka";
  const bisaPindah = bolehTulis && b.status === "diparkir" && b.parkirId !== null;
  return (
    <>
      <tr>
        {nm && (
          <td>{b.status === "terbuka" && <input type="checkbox" aria-label="pilih baris bank" checked={dipilih} onChange={onPilih} />}</td>
        )}
        <td>{b.tanggalBank}</td>
        <td>{ctx.rekeningNama[b.accountId] ?? "—"}</td>
        <td>
          {b.keterangan}
          {b.so && <div className="fs14 t-tertiary">SO {b.so}</div>}
          {b.tanda && <div className="fs14 t-warning">{b.tanda}</div>}
        </td>
        <td className="num">{bertanda(b.amountSen)}</td>
        <td>
          {LABEL_STATUS_IMPOR[b.status]}
          {b.status === "terbuka" && b.kandidat.length > 0 && <div className="fs14 t-tertiary">{b.kandidat.length} kandidat</div>}
        </td>
        {bolehTulis && (
          <td>
            {(bisaSelesai || bisaPindah) && !nm && (
              <button type="button" className="btn-outline sm" onClick={onBuka} aria-expanded={terbuka}>
                {terbuka ? "Tutup" : bisaPindah ? "Pindahkan" : "Selesaikan"}
              </button>
            )}
          </td>
        )}
      </tr>
      {terbuka && (bisaSelesai || bisaPindah) && (
        <tr>
          <td colSpan={7}>{bisaPindah ? <FormPindah b={b} ctx={ctx} hariIni={hariIni} /> : <FormPenyelesaian b={b} ctx={ctx} />}</td>
        </tr>
      )}
    </>
  );
}
