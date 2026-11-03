"use client";

/**
 * Rekening koran bank lain — pembaca AI & input manual (rencana 2026-11-02
 * U10; R29, R30, AE8, KTD9).
 *
 *   · staf Keuangan: pilih rekening & bulan, ketik EMPAT angka kontrol dari
 *     cetakan, unggah PDF atau foto; foto diperkecil & dikodekan ulang ke JPEG
 *     di peramban sampai di bawah `MAKS_BERKAS_BYTE` (batas body server action
 *     tidak diubah). Gagal (tanpa kunci, tak terbaca, angka tak cocok) ⇒ jalur
 *     "input manual" dengan pemeriksaan yang sama;
 *   · HoF: daftar bacaan yang menunggu — jumlah baris, empat angka kontrol
 *     berdampingan dengan bacaan, tabel per baris, Konfirmasi / Tolak.
 *
 * Semua keputusan ditegakkan server (`bacaRekeningKoranAiAksi`,
 * `simpanMutasiManual`, `konfirmasiRekeningKoran`, `tarikRekeningKoran`);
 * komponen ini hanya pintunya.
 */
import { useRef, useState, useTransition } from "react";
import {
  bacaRekeningKoranAiAksi,
  konfirmasiRekeningKoran,
  simpanMutasiManual,
  tarikRekeningKoran,
  type BarisManualInput,
} from "@/lib/impor-bank-actions";
import {
  LABEL_ANGKA_KONTROL,
  periksaBerkas,
  perkecilSampaiMuat,
  type AngkaKontrolNama,
  type HasilBacaRekeningKoran,
  type Pelanggaran,
} from "@/lib/impor-bank-model";
import { rpSen } from "@/lib/pihak-lawan-model";

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const labelBulan = (b: string): string => `${NAMA_BULAN[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`;
const bertanda = (sen: number): string => `${sen < 0 ? "−" : ""}${rpSen(sen)}`;

type Kontrol = { saldoAwal: string; totalDebet: string; totalKredit: string; saldoAkhir: string };
const KONTROL_KOSONG: Kontrol = { saldoAwal: "", totalDebet: "", totalKredit: "", saldoAkhir: "" };
const FIELD_KONTROL: { kunci: keyof Kontrol; label: string }[] = [
  { kunci: "saldoAwal", label: "Saldo awal" },
  { kunci: "totalDebet", label: "Total debet" },
  { kunci: "totalKredit", label: "Total kredit" },
  { kunci: "saldoAkhir", label: "Saldo akhir" },
];

export interface RekeningBankLain {
  id: string;
  nama: string;
}

export interface BacaanMenunggu {
  id: string;
  accountId: string;
  namaRekening: string;
  periode: string;
  sumber: "ai" | "manual";
  /** Angka kontrol yang tersimpan (= ketikan staf). */
  kontrol: Record<AngkaKontrolNama, number>;
  baris: { tanggal: string; keterangan: string; amountSen: number; saldoSen: number | null }[];
}

// ---------------------------------------------------------------------------
// Foto → JPEG di bawah batas (kanvas peramban)
// ---------------------------------------------------------------------------

async function kodekanJpeg(bmp: ImageBitmap, lebarMaks: number, mutu: number): Promise<Blob> {
  const skala = Math.min(1, lebarMaks / Math.max(bmp.width, bmp.height));
  const kanvas = document.createElement("canvas");
  kanvas.width = Math.max(1, Math.round(bmp.width * skala));
  kanvas.height = Math.max(1, Math.round(bmp.height * skala));
  const ctx = kanvas.getContext("2d");
  if (!ctx) throw new Error("Peramban tidak bisa memproses foto.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, kanvas.width, kanvas.height);
  ctx.drawImage(bmp, 0, 0, kanvas.width, kanvas.height);
  return new Promise((res, rej) => kanvas.toBlob((b) => (b ? res(b) : rej(new Error("Foto gagal dikodekan."))), "image/jpeg", mutu));
}

/** PDF diperiksa ukurannya saja; foto diperkecil. `string` = pesan penolakan. */
async function siapkanBerkas(berkas: File): Promise<Blob | string> {
  if (berkas.type === "application/pdf" || berkas.name.toLowerCase().endsWith(".pdf")) {
    return periksaBerkas(berkas.size, "ai") ?? berkas;
  }
  if (!berkas.type.startsWith("image/")) return "Berkas harus PDF atau foto (JPEG/PNG).";
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(berkas);
  } catch {
    return "Foto tidak bisa dibuka peramban — simpan ulang sebagai JPEG lalu coba lagi.";
  }
  try {
    const r = await perkecilSampaiMuat((lebar, mutu) => kodekanJpeg(bmp, lebar, mutu));
    return r.ok ? r.hasil : r.pesan;
  } finally {
    bmp.close();
  }
}

// ---------------------------------------------------------------------------
// Hasil
// ---------------------------------------------------------------------------

function TabelPelanggaran({ p }: { p: Pelanggaran[] }) {
  return (
    <ul className="fs14 mt2">
      {p.map((x, i) => (
        <li key={i}>
          {x.jenis === "kontrol" &&
            `${LABEL_ANGKA_KONTROL[x.angka]}: terbaca ${bertanda(x.terbaca)}, angka kontrol ${bertanda(x.kontrol)} (selisih ${bertanda(x.selisih)})`}
          {x.jenis === "saldo-berjalan" &&
            `Baris ${x.baris} (${x.tanggal}): saldo tercetak ${bertanda(x.tercetak)}, seharusnya ${bertanda(x.dihitung)}`}
          {x.jenis === "tanggal" &&
            (x.alasan === "mundur" ? `Baris ${x.baris}: tanggal ${x.tanggal} mundur` : `Baris ${x.baris}: tanggal ${x.tanggal} di luar bulan`)}
          {x.jenis === "jangkar" &&
            `Saldo awal ${bertanda(x.saldoAwal)} ≠ ${x.sumber === "buku-bank" ? "saldo buku bank" : "saldo akhir rekening koran bulan lalu"} ${bertanda(x.jangkarSen)} (selisih ${bertanda(x.selisih)})`}
          {x.jenis === "tanpa-jangkar" && x.pesan}
        </li>
      ))}
    </ul>
  );
}

function PanelHasil({ h, onManual }: { h: HasilBacaRekeningKoran; onManual: () => void }) {
  const sisa = h.sisaPercobaan === null ? null : <div className="fs14 t-tertiary">Sisa baca AI bulan ini untuk rekening ini: {h.sisaPercobaan}</div>;
  if (h.status === "menunggu-konfirmasi") {
    return (
      <div className="banner info keu-banner" role="status">
        <strong>Lolos pemeriksaan — rekening koran {labelBulan(h.periode)} ({h.nBaris} baris) menunggu konfirmasi Head of Finance.</strong>{" "}
        Barisnya belum ikut pencocokan sampai dikonfirmasi.
        {sisa}
      </div>
    );
  }
  const manual = h.status === "ditolak-gerbang" || h.inputManual;
  return (
    <div className="banner danger keu-banner" role="alert">
      <strong>{h.status === "ditolak-gerbang" ? "Ditolak — bacaan tidak cocok dengan angka kontrol." : "Ditolak."}</strong>{" "}
      {h.status === "ditolak-gerbang" ? "Tidak ada baris yang disimpan." : h.pesan}
      {h.status === "ditolak-gerbang" && <TabelPelanggaran p={h.pelanggaran} />}
      {sisa}
      {manual && (
        <div className="mt2">
          <button type="button" className="btn-outline sm" onClick={onManual}>
            Ketik baris secara manual
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form staf Keuangan
// ---------------------------------------------------------------------------

const BARIS_KOSONG = (periode: string): BarisManualInput => ({ tanggal: `${periode}-01`, keterangan: "", arah: "kredit", nominal: "", saldo: "" });

function FormBaca({ code, rekening, bulan }: { code: string; rekening: RekeningBankLain[]; bulan: string[] }) {
  const [accountId, setAccountId] = useState(rekening[0]?.id ?? "");
  const [periode, setPeriode] = useState(bulan[bulan.length - 1] ?? "");
  const [kontrol, setKontrol] = useState<Kontrol>(KONTROL_KOSONG);
  const [tahap, setTahap] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilBacaRekeningKoran | null>(null);
  const [manual, setManual] = useState(false);
  const [baris, setBaris] = useState<BarisManualInput[]>([]);
  const [pending, start] = useTransition();
  const masukan = useRef<HTMLInputElement>(null);

  const kontrolLengkap = FIELD_KONTROL.every((f) => kontrol[f.kunci].trim() !== "");
  const tolakLokal = (pesan: string) =>
    setHasil({ status: "ditolak", sebab: "berkas", pesan, inputManual: false, sisaPercobaan: null });

  const baca = () => {
    const berkas = masukan.current?.files?.[0];
    if (!berkas) return tolakLokal("Pilih PDF atau foto rekening koran.");
    setHasil(null);
    start(async () => {
      setTahap(berkas.type.startsWith("image/") ? "Memperkecil foto…" : "Menyiapkan berkas…");
      const siap = await siapkanBerkas(berkas);
      if (typeof siap === "string") {
        setTahap(null);
        return tolakLokal(siap);
      }
      const f = new FormData();
      f.set("code", code);
      f.set("accountId", accountId);
      f.set("periode", periode);
      for (const { kunci } of FIELD_KONTROL) f.set(kunci, kontrol[kunci]);
      f.set("berkas", siap, siap === berkas ? berkas.name : "rekening-koran.jpg");
      setTahap("Membaca rekening koran dengan AI & memeriksa angka kontrol…");
      try {
        const r = await bacaRekeningKoranAiAksi(f);
        setHasil(r);
        if (r.status === "menunggu-konfirmasi" && masukan.current) masukan.current.value = "";
      } catch {
        setHasil({
          status: "ditolak",
          sebab: "galat",
          pesan: "Unggahan gagal sampai ke server (koneksi terputus atau berkas terlalu besar). Tidak ada yang disimpan — coba lagi.",
          inputManual: true,
          sisaPercobaan: null,
        });
      } finally {
        setTahap(null);
      }
    });
  };

  const simpanManual = () => {
    setHasil(null);
    start(async () => {
      setTahap("Memeriksa baris terhadap angka kontrol…");
      try {
        const r = await simpanMutasiManual({ code, accountId, periode, kontrol, baris });
        setHasil(r);
        if (r.status === "menunggu-konfirmasi") {
          setBaris([]);
          setManual(false);
        }
      } catch {
        setHasil({ status: "ditolak", sebab: "galat", pesan: "Gagal sampai ke server — tidak ada yang disimpan. Coba lagi.", inputManual: true, sisaPercobaan: null });
      } finally {
        setTahap(null);
      }
    });
  };

  const bukaManual = () => {
    setManual(true);
    if (baris.length === 0) setBaris([BARIS_KOSONG(periode)]);
  };
  const ubahBaris = (i: number, ubah: Partial<BarisManualInput>) => setBaris((bs) => bs.map((b, j) => (j === i ? { ...b, ...ubah } : b)));

  return (
    <div className="mt4">
      <div className="manual-form-actions">
        <select className="manual-input" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={pending} aria-label="Rekening">
          {rekening.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nama}
            </option>
          ))}
        </select>
        <select className="manual-input" value={periode} onChange={(e) => setPeriode(e.target.value)} disabled={pending} aria-label="Bulan rekening koran">
          {bulan.map((b) => (
            <option key={b} value={b}>
              {labelBulan(b)}
            </option>
          ))}
        </select>
      </div>
      <div className="fs14 t-secondary mt4">Empat angka kontrol — ketik persis dari cetakan rekening koran (contoh 12.500.000,00):</div>
      <div className="manual-form-actions mt2">
        {FIELD_KONTROL.map(({ kunci, label }) => (
          <label key={kunci} className="fs14">
            {label}
            <input
              className="manual-input num"
              inputMode="decimal"
              value={kontrol[kunci]}
              onChange={(e) => setKontrol((k) => ({ ...k, [kunci]: e.target.value }))}
              disabled={pending}
              aria-label={label}
            />
          </label>
        ))}
      </div>

      {!manual && (
        <div className="manual-form-actions mt4">
          <input ref={masukan} type="file" accept="application/pdf,.pdf,image/jpeg,image/png" disabled={pending} aria-label="PDF atau foto rekening koran" />
          <button type="button" className="btn-outline sm" disabled={pending || !kontrolLengkap || accountId === ""} onClick={baca}>
            {pending ? "Membaca…" : "Baca dengan AI"}
          </button>
          <button type="button" className="btn-outline sm" disabled={pending} onClick={bukaManual}>
            Input manual
          </button>
        </div>
      )}

      {manual && (
        <div className="mt4">
          <div className="tbl-scroll">
            <table className="fs14">
              <thead>
                <tr>
                  <th className="left">Tanggal</th>
                  <th className="left">Keterangan</th>
                  <th className="left">Arah</th>
                  <th className="right">Nominal</th>
                  <th className="right">Saldo tercetak (boleh kosong)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {baris.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <input type="date" className="manual-input" value={b.tanggal} onChange={(e) => ubahBaris(i, { tanggal: e.target.value })} aria-label={`Tanggal baris ${i + 1}`} />
                    </td>
                    <td>
                      <input className="manual-input" value={b.keterangan} onChange={(e) => ubahBaris(i, { keterangan: e.target.value })} aria-label={`Keterangan baris ${i + 1}`} />
                    </td>
                    <td>
                      <select className="manual-input" value={b.arah} onChange={(e) => ubahBaris(i, { arah: e.target.value as BarisManualInput["arah"] })} aria-label={`Arah baris ${i + 1}`}>
                        <option value="kredit">Kredit (masuk)</option>
                        <option value="debet">Debet (keluar)</option>
                      </select>
                    </td>
                    <td>
                      <input className="manual-input num" inputMode="decimal" value={b.nominal} onChange={(e) => ubahBaris(i, { nominal: e.target.value })} aria-label={`Nominal baris ${i + 1}`} />
                    </td>
                    <td>
                      <input className="manual-input num" inputMode="decimal" value={b.saldo} onChange={(e) => ubahBaris(i, { saldo: e.target.value })} aria-label={`Saldo baris ${i + 1}`} />
                    </td>
                    <td>
                      <button type="button" className="btn-outline sm" onClick={() => setBaris((bs) => bs.filter((_, j) => j !== i))} aria-label={`Hapus baris ${i + 1}`}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="manual-form-actions mt2">
            <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setBaris((bs) => [...bs, { ...BARIS_KOSONG(periode), tanggal: bs[bs.length - 1]?.tanggal ?? `${periode}-01` }])}>
              Tambah baris
            </button>
            <button type="button" className="btn-outline sm" disabled={pending || !kontrolLengkap || accountId === ""} onClick={simpanManual}>
              {pending ? "Memeriksa…" : `Periksa & simpan ${baris.length} baris`}
            </button>
            <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setManual(false)}>
              Kembali ke unggah
            </button>
          </div>
        </div>
      )}

      {tahap !== null && (
        <div className="fs14 t-tertiary mt2" role="status">
          {tahap} Jangan tutup halaman ini.
        </div>
      )}
      {hasil !== null && !pending && <PanelHasil h={hasil} onManual={bukaManual} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Konfirmasi HoF
// ---------------------------------------------------------------------------

function Konfirmasi({ code, b, bolehKonfirmasi, kodeAlasan }: { code: string; b: BacaanMenunggu; bolehKonfirmasi: boolean; kodeAlasan: { code: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [tolak, setTolak] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [catatan, setCatatan] = useState("");

  // Sisi "bacaan" dihitung ulang dari baris yang tersimpan — bukan disalin dari angka kontrol.
  const kredit = b.baris.filter((x) => x.amountSen >= 0).reduce((s, x) => s + x.amountSen, 0);
  const debet = -b.baris.filter((x) => x.amountSen < 0).reduce((s, x) => s + x.amountSen, 0);
  const bacaan: Record<AngkaKontrolNama, number> = {
    "saldo-awal": b.kontrol["saldo-awal"],
    "total-debet": debet,
    "total-kredit": kredit,
    "saldo-akhir": b.kontrol["saldo-awal"] + kredit - debet,
  };
  const urut: AngkaKontrolNama[] = ["saldo-awal", "total-debet", "total-kredit", "saldo-akhir"];

  const konfirmasi = () =>
    start(async () => {
      const r = await konfirmasiRekeningKoran({ code, rekeningKoranId: b.id });
      setPesan(r.ok ? { ok: true, teks: r.pesan + (r.cocok.status === "selesai" ? ` ${r.cocok.nOtomatis} baris dicocokkan otomatis.` : ` ${r.cocok.pesan}`) } : { ok: false, teks: r.error });
    });
  const kirimTolak = () =>
    start(async () => {
      const r = await tarikRekeningKoran({ code, rekeningKoranId: b.id, reasonCode: alasan, catatan });
      setPesan(r.ok ? { ok: true, teks: r.pesan } : { ok: false, teks: r.error });
      if (r.ok) setTolak(false);
    });

  return (
    <div className="card card-pad-lg mt4">
      <div className="w600">
        {b.namaRekening} · {labelBulan(b.periode)}
      </div>
      <div className="fs14 t-tertiary">
        {b.sumber === "ai" ? "Dibaca AI" : "Diketik manual"} · {b.baris.length} baris · menunggu konfirmasi Head of Finance
      </div>
      <div className="tbl-scroll mt2">
        <table className="fs14">
          <thead>
            <tr>
              <th className="left">Angka</th>
              <th className="right">Angka kontrol (ketikan staf)</th>
              <th className="right">Bacaan (dari baris)</th>
            </tr>
          </thead>
          <tbody>
            {urut.map((k) => (
              <tr key={k}>
                <td>{LABEL_ANGKA_KONTROL[k]}</td>
                <td className="right num">{bertanda(b.kontrol[k])}</td>
                <td className={`right num ${bacaan[k] === b.kontrol[k] ? "" : "t-danger w600"}`}>{bertanda(bacaan[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt2">
        <summary className="fs14">Lihat {b.baris.length} baris</summary>
        <div className="tbl-scroll mt2">
          <table className="fs14">
            <thead>
              <tr>
                <th className="right">#</th>
                <th className="left">Tanggal</th>
                <th className="left">Keterangan</th>
                <th className="right">Debet</th>
                <th className="right">Kredit</th>
                <th className="right">Saldo tercetak</th>
              </tr>
            </thead>
            <tbody>
              {b.baris.map((x, i) => (
                <tr key={i}>
                  <td className="right num">{i + 1}</td>
                  <td>{x.tanggal}</td>
                  <td>{x.keterangan}</td>
                  <td className="right num">{x.amountSen < 0 ? rpSen(-x.amountSen) : ""}</td>
                  <td className="right num">{x.amountSen >= 0 ? rpSen(x.amountSen) : ""}</td>
                  <td className="right num">{x.saldoSen === null ? "" : bertanda(x.saldoSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {bolehKonfirmasi && !tolak && (
        <div className="manual-form-actions mt2">
          <button type="button" className="btn-outline sm" disabled={pending} onClick={konfirmasi}>
            {pending ? "Memproses…" : "Konfirmasi"}
          </button>
          <button type="button" className="btn-outline sm t-danger" disabled={pending} onClick={() => setTolak(true)}>
            Tolak
          </button>
        </div>
      )}
      {bolehKonfirmasi && tolak && (
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
            placeholder="Catatan wajib: kenapa bacaan ini ditolak"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            aria-label="Catatan penolakan"
          />
          <div className="manual-form-actions mt2">
            <button type="button" className="btn-outline sm t-danger" disabled={pending || alasan === "" || catatan.trim() === ""} onClick={kirimTolak}>
              {pending ? "Menolak…" : "Ya, tolak"}
            </button>
            <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setTolak(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
      {pesan !== null && (
        <div className={`banner ${pesan.ok ? "info" : "danger"} keu-banner`} role={pesan.ok ? "status" : "alert"}>
          {pesan.teks}
        </div>
      )}
    </div>
  );
}

export function ImporBankAi({
  code,
  rekening,
  bulan,
  menunggu,
  bolehUnggah,
  bolehKonfirmasi,
  kodeAlasan,
}: {
  code: string;
  rekening: RekeningBankLain[];
  bulan: string[];
  menunggu: BacaanMenunggu[];
  bolehUnggah: boolean;
  bolehKonfirmasi: boolean;
  kodeAlasan: { code: string; label: string }[];
}) {
  return (
    <>
      {bolehUnggah && rekening.length > 0 && <FormBaca code={code} rekening={rekening} bulan={bulan} />}
      {menunggu.length > 0 && (
        <div className="mt6">
          <h4 className="text-h4">Menunggu konfirmasi Head of Finance</h4>
          {menunggu.map((b) => (
            <Konfirmasi key={b.id} code={code} b={b} bolehKonfirmasi={bolehKonfirmasi} kodeAlasan={kodeAlasan} />
          ))}
        </div>
      )}
    </>
  );
}
