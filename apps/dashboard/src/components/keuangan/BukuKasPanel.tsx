"use client";

import { useState, useTransition } from "react";
import { setujuiSetoran, simpanMutasiKas, voidMutasiKas } from "@/lib/kas-actions";
import type { JenisMutasi, SisiKategori } from "@/lib/keuangan-kas";
import type { AkunKas, BarisBuku, KakiBuku, TawaranSetoran } from "@/lib/keuangan-kas-model";

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
}) {
  const kasBesar = akun.find((a) => a.kind === "kas") ?? akun[0] ?? null;
  const [akunAktif, setAkunAktif] = useState<string>(kasBesar?.id ?? "");
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [bukaForm, setBukaForm] = useState(false);
  const [ket, setKet] = useState("");
  const [jenis, setJenis] = useState<JenisMutasi>("debet");
  const [katKey, setKatKey] = useState("");
  const [nominal, setNominal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tertunda = tawaran.filter((t) => !t.sudahDibukukan);
  const baris = bukuPerAkun[akunAktif] ?? [];
  const kaki = kakiPerAkun[akunAktif] ?? { nMutasi: 0, totalMutasi: 0, saldoAkhir: 0 };
  const saldoAwal = saldoAwalPerAkun[akunAktif] ?? 0;
  const kategoriSisi = kategori.filter((k) => k.side === (jenis === "kredit" ? "kredit" : "debet"));

  const angka = (): number => {
    const n = Number(nominal.replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n === 0) return NaN;
    // Tanda ditentukan JENIS, bukan diketik: minus yang terlupa adalah cara
    // termudah membuat kredit menaikkan saldo.
    return jenis === "kredit" ? -n : n;
  };

  const simpan = (): void => {
    setErr(null);
    setMsg(null);
    const amount = angka();
    if (Number.isNaN(amount)) {
      setErr("Nominal harus angka dan bukan nol.");
      return;
    }
    const kat = kategoriSisi.find((k) => `${k.side}|${k.label}` === katKey) ?? null;
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
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Mutasi tersimpan. Saldo di atas dihitung ulang dari mutasi.");
        setKet("");
        setNominal("");
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

  const batalkan = (id: string): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await voidMutasiKas({ code, date, id });
      if (!res.ok) setErr(res.error);
      else setMsg("Baris dibatalkan — tercatat, tidak dihapus.");
    });
  };

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
        <div className={`grid-head cols-buku${bolehTulis ? "" : " ro"}`}>
          <span>Keterangan</span>
          <span>Kategori</span>
          <span className="right">Nominal</span>
          <span className="right">Saldo</span>
          {bolehTulis && <span className="right">Tindakan</span>}
        </div>

        {/* Saldo awal: HASIL HITUNG dari mutasi sebelum hari ini, bukan isian. */}
        <div className={`grid-row cols-buku${bolehTulis ? "" : " ro"}`}>
          <span className="t-secondary">Saldo awal hari ini</span>
          <span className="fs16 t-tertiary">dihitung dari mutasi sebelumnya</span>
          <span className="right num t-tertiary">—</span>
          <span className="right num w600">{rp(saldoAwal)}</span>
          {bolehTulis && <span />}
        </div>

        {baris.length === 0 ? (
          <div className="empty-inline">Belum ada mutasi pada tanggal ini.</div>
        ) : (
          baris.map((b) => (
            <div className={`grid-row cols-buku${bolehTulis ? "" : " ro"}`} key={b.id}>
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
              {bolehTulis && (
                <span className="right">
                  <button
                    type="button"
                    className="btn-outline sm"
                    onClick={() => batalkan(b.id)}
                    disabled={pending}
                  >
                    Batalkan
                  </button>
                </span>
              )}
            </div>
          ))
        )}

        <div className={`grid-total cols-buku${bolehTulis ? "" : " ro"}`}>
          <span>
            {kaki.nMutasi} mutasi hari ini
          </span>
          <span />
          <span className="right num">{rp(kaki.totalMutasi)}</span>
          <span className="right num">{rp(kaki.saldoAkhir)}</span>
          {bolehTulis && <span />}
        </div>
      </div>

      {bolehTulis && !bukaForm && (
        <div className="manual-form-actions">
          <button type="button" className="btn-tint sm" onClick={() => setBukaForm(true)}>
            Tambah mutasi yang tidak lewat Rincian…
          </button>
        </div>
      )}

      {bolehTulis && bukaForm && (
        <div className="card card-pad-lg keu-form">
          <h4 className="text-h3">Tambah mutasi</h4>
          <p className="fs16 t-tertiary mt2">
            Tanda nominal mengikuti jenis — Anda tidak perlu (dan tidak bisa) mengetik minus.
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
                inputMode="numeric"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
          {jenis !== "adjustment" && (
            <label className="keu-fld">
              <span className="keu-label">Kategori</span>
              <select
                className="manual-input"
                value={katKey}
                onChange={(e) => setKatKey(e.target.value)}
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
          <div className="manual-form-actions">
            <button type="button" className="btn-navy" onClick={simpan} disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan mutasi"}
            </button>
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
