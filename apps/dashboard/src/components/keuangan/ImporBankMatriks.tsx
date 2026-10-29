"use client";

/**
 * Matriks impor rekening koran (rencana 2026-10-29 U9; R17–R19, R31):
 * rekening BCA (baris) × bulan (kolom), unggah per rekening dengan panel hasil,
 * dan Tarik (HoF) per sel aktif. Semua keputusan ditegakkan server
 * (`unggahRekeningKoran`, `tarikRekeningKoran`); komponen ini hanya pintunya —
 * kecuali batas ukuran, yang WAJIB diperiksa di sini juga: berkas di atas
 * `bodySizeLimit` ditolak Next sebelum aksi berjalan, dengan galat tak berpesan.
 */
import { useRef, useState, useTransition } from "react";
import { tarikRekeningKoran, unggahRekeningKoran } from "@/lib/impor-bank-actions";
import { periksaBerkas, type HasilUnggah, type PerbandinganSaldoAwal, type SelMatriks } from "@/lib/impor-bank-model";
import type { Ketidakcocokan } from "@/lib/impor-bank-parser";
import { rpSen } from "@/lib/pihak-lawan-model";

export type SelTampil =
  | Exclude<SelMatriks, { status: "diunggah" }>
  | (Extract<SelMatriks, { status: "diunggah" }> & { saldoAwal: PerbandinganSaldoAwal | null });

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const labelBulan = (b: string): string => `${NAMA_BULAN[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`;

const bertanda = (sen: number): string => `${sen < 0 ? "−" : sen > 0 ? "+" : ""}${rpSen(sen)}`;

const LABEL_CEK: Record<Ketidakcocokan["pemeriksaan"], string> = {
  "mutasi-cr": "Total mutasi CR",
  "jumlah-cr": "Jumlah mutasi CR",
  "mutasi-db": "Total mutasi DB",
  "jumlah-db": "Jumlah mutasi DB",
  "saldo-awal": "Saldo awal",
  "saldo-akhir": "Saldo akhir (awal + CR − DB)",
};

function SaldoAwal({ p }: { p: PerbandinganSaldoAwal | null }) {
  if (p === null) return null;
  if (p.status === "tanpa-saldo-pembuka") return <div className="fs14 t-tertiary">Rekening belum punya saldo pembuka</div>;
  if (p.status === "sebelum-cut-over") {
    return <div className="fs14 t-tertiary">Sebelum saldo pembuka ({p.cutOver}) — tidak dibukukan</div>;
  }
  const kelas = p.sementara ? "t-warning" : p.status === "cocok" ? "t-success" : "t-danger";
  return (
    <div className={`fs14 ${kelas}`}>
      {p.status === "cocok"
        ? "Saldo awal cocok dengan buku"
        : `Saldo awal selisih ${bertanda(p.selisihSen)} dari buku (${rpSen(p.bukuSen)})`}
      {p.sementara && " · saldo pembuka buku masih sementara"}
    </div>
  );
}

function PanelHasil({ h }: { h: HasilUnggah }) {
  if (h.status === "diterima") {
    return (
      <div className="banner info keu-banner" role="status">
        <strong>Diterima — rekening koran {labelBulan(h.periode)}.</strong> {h.nBaris} mutasi tersimpan ({h.nCr} CR, {h.nDb}{" "}
        DB)
        {h.nPraCutover > 0 && `; ${h.nPraCutover} bertanggal sebelum saldo pembuka — disimpan, tidak dibukukan`}.
        <SaldoAwal p={h.saldoAwal} />
      </div>
    );
  }
  if (h.status === "sudah-ada") {
    return (
      <div className="banner info keu-banner" role="status">
        <strong>Sudah ada.</strong> Berkas yang sama untuk {labelBulan(h.periode)} sudah diimpor ({h.nBaris} mutasi) —
        tidak ada yang ditambahkan.
      </div>
    );
  }
  if (h.status === "ditolak-kaki") {
    return (
      <div className="banner danger keu-banner" role="alert">
        <strong>Ditolak utuh — kaki rekening koran tidak cocok dengan hasil baca.</strong> Tidak ada mutasi yang diimpor.
        <div className="tbl-scroll mt2">
          <table className="fs14">
            <thead>
              <tr>
                <th className="left">Pemeriksaan</th>
                <th className="right">Terbaca</th>
                <th className="right">Kaki</th>
                <th className="right">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {h.ketidakcocokan.map((k) => {
                const jumlah = k.pemeriksaan.startsWith("jumlah");
                const f = (n: number) => (jumlah ? String(n) : rpSen(n));
                return (
                  <tr key={k.pemeriksaan}>
                    <td>{LABEL_CEK[k.pemeriksaan]}</td>
                    <td className="right num">{f(k.terbaca)}</td>
                    <td className="right num">{f(k.kaki)}</td>
                    <td className="right num w600">{jumlah ? String(k.selisih) : bertanda(k.selisih)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <div className="banner danger keu-banner" role="alert">
      <strong>Ditolak.</strong> {h.pesan}
    </div>
  );
}

function BarisUnggah({ code, accountId }: { code: string; accountId: string }) {
  const [pending, start] = useTransition();
  const [hasil, setHasil] = useState<HasilUnggah | null>(null);
  const masukan = useRef<HTMLInputElement>(null);

  const unggah = () => {
    const berkas = masukan.current?.files?.[0];
    if (!berkas) {
      setHasil({ status: "ditolak", sebab: "berkas", pesan: "Pilih berkas e-statement PDF dari BCA." });
      return;
    }
    // Di sisi peramban juga: berkas di atas bodySizeLimit tak pernah sampai ke aksi.
    const salah = periksaBerkas(berkas.size);
    if (salah !== null) {
      setHasil({ status: "ditolak", sebab: "berkas", pesan: salah });
      return;
    }
    const f = new FormData();
    f.set("code", code);
    f.set("accountId", accountId);
    f.set("berkas", berkas);
    setHasil(null);
    start(async () => {
      try {
        setHasil(await unggahRekeningKoran(f));
        if (masukan.current) masukan.current.value = "";
      } catch {
        setHasil({
          status: "ditolak",
          sebab: "galat",
          pesan: "Unggahan gagal sampai ke server (koneksi terputus atau berkas terlalu besar). Tidak ada yang diimpor — coba lagi.",
        });
      }
    });
  };

  return (
    <div className="mt2">
      <div className="manual-form-actions">
        <input ref={masukan} type="file" accept="application/pdf,.pdf" disabled={pending} aria-label="Berkas e-statement PDF" />
        <button type="button" className="btn-outline sm" disabled={pending} onClick={unggah}>
          {pending ? "Membaca rekening koran…" : "Unggah"}
        </button>
      </div>
      {pending && (
        <div className="fs14 t-tertiary mt2" role="status">
          Sedang membaca & memeriksa kaki rekening koran — jangan tutup halaman ini.
        </div>
      )}
      {hasil !== null && !pending && <PanelHasil h={hasil} />}
    </div>
  );
}

function Tarik({
  code,
  id,
  kodeAlasan,
}: {
  code: string;
  id: string;
  kodeAlasan: { code: string; label: string }[];
}) {
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!buka) {
    return (
      <button type="button" className="btn-outline sm mt2" onClick={() => setBuka(true)}>
        Tarik
      </button>
    );
  }
  const kirim = () => {
    setGalat(null);
    start(async () => {
      const r = await tarikRekeningKoran({ code, rekeningKoranId: id, reasonCode: alasan, catatan });
      if (!r.ok) setGalat(r.error);
      else setBuka(false);
    });
  };
  return (
    <div className="mt2">
      <select className="manual-input" value={alasan} onChange={(e) => setAlasan(e.target.value)} aria-label="Kode alasan">
        <option value="">Kode alasan…</option>
        {kodeAlasan.map((k) => (
          <option key={k.code} value={k.code}>
            {k.code} — {k.label}
          </option>
        ))}
      </select>
      <textarea
        className="manual-input mt2"
        rows={2}
        placeholder="Catatan wajib: kenapa impor ini ditarik"
        value={catatan}
        onChange={(e) => setCatatan(e.target.value)}
        aria-label="Catatan penarikan"
      />
      <div className="manual-form-actions mt2">
        <button
          type="button"
          className="btn-outline sm t-danger"
          disabled={pending || alasan === "" || catatan.trim() === ""}
          onClick={kirim}
        >
          {pending ? "Menarik…" : "Ya, tarik"}
        </button>
        <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setBuka(false)}>
          Batal
        </button>
      </div>
      {galat !== null && (
        <div className="banner danger keu-banner" role="alert">
          {galat}
        </div>
      )}
    </div>
  );
}

export function ImporBankMatriks({
  code,
  rekening,
  bulan,
  sel,
  bolehUnggah,
  bolehTarik,
  kodeAlasan,
}: {
  code: string;
  rekening: { id: string; nama: string; cutOver: string | null }[];
  bulan: string[];
  sel: Record<string, Record<string, SelTampil>>;
  bolehUnggah: boolean;
  bolehTarik: boolean;
  kodeAlasan: { code: string; label: string }[];
}) {
  return (
    <div className="tbl-scroll mt4">
      <table className="fs16">
        <thead>
          <tr>
            <th className="left">Rekening</th>
            {bulan.map((b) => (
              <th key={b} className="left">
                {labelBulan(b)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rekening.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="w600">{r.nama}</div>
                <div className="fs14 t-tertiary">
                  {r.cutOver ? `Saldo pembuka ${r.cutOver}` : "Belum ada saldo pembuka"}
                </div>
                {bolehUnggah && <BarisUnggah code={code} accountId={r.id} />}
              </td>
              {bulan.map((b) => {
                const s = sel[r.id]?.[b] ?? { status: "belum" as const };
                // U11 MEMASANG TAUTAN DI SINI ke `/keuangan/unit/${code}/impor-bank/${b}`
                // (layar klasifikasi) — sebelum halaman itu ada, tautan hanya 404.
                return (
                  <td key={b}>
                    {s.status === "belum" && <span className="t-tertiary">Belum diunggah</span>}
                    {s.status === "ditarik" && <span className="t-tertiary">Ditarik</span>}
                    {s.status === "diunggah" && (
                      <>
                        <div>
                          Diunggah ({s.nBaris} baris, {s.nTerbuka} terbuka)
                        </div>
                        <SaldoAwal p={s.saldoAwal} />
                        {bolehTarik && <Tarik code={code} id={s.id} kodeAlasan={kodeAlasan} />}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
