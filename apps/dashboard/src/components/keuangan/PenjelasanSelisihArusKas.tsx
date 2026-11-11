import {
  kalimatCocok,
  kalimatPiutangWaktu,
  rpTeks,
  tanggalPendek,
  TEKS_AKSI_PIUTANG_WAKTU,
  TEKS_SISA_DI_LUAR_TOLERANSI,
  TEKS_TANPA_HARI_BERLAWANAN,
  type HariPiutang,
  type PenjelasanSelisihArusKas as Penjelasan,
  type PetunjukHari,
} from "@/lib/selisih-arus-kas-model";

/** Petunjuk yang ditampilkan — tiga hari terdekat. */
const MAKS_PETUNJUK = 3;

/**
 * "Penjelasan selisih arus kas" di Tutup hari (rencana 2026-11-11-2210 U3;
 * R1, R3–R5, R8). Presentasi saja: angka & pilihan teks datang dari
 * `jelaskanSelisihArusKas`. Kartu Cash flow check tidak diubah.
 */
export function PenjelasanSelisihArusKas({ penjelasan }: { penjelasan: Penjelasan | { galat: string } }) {
  if ("galat" in penjelasan) {
    return (
      <div className="banner danger keu-banner" role="alert" data-penjelasan-arus-kas="galat">
        Penjelasan selisih tidak bisa dimuat: {penjelasan.galat}
      </div>
    );
  }
  const p = penjelasan;
  const [piutang, sisa] = p.baris;
  const nada = p.aksi === null ? "info" : "warning";
  const kalimat = kalimatPiutangWaktu(p);
  return (
    <div className={`banner ${nada} keu-banner`} role="status" data-penjelasan-arus-kas={p.aksi ?? "pembulatan"}>
      <b>Penjelasan selisih arus kas</b>
      <div className="card tbl-card tbl-scroll mt2">
        <div className="grid-head cols-saldo2">
          <span>Penyebab</span>
          <span>Baris</span>
          <span>Rupiah</span>
        </div>
        <div className="grid-row cols-saldo2" data-baris="piutang_waktu">
          <span className="fs16">Waktu pembayaran piutang</span>
          <span className="fs16 t-secondary">
            EasyMax {p.easymax.n} · bank {p.bank.n}
          </span>
          <span className="num">{rpTeks(piutang.rp)}</span>
        </div>
        <div className="grid-row cols-saldo2" data-baris="sisa">
          <span className="fs16">
            Sisa (pembulatan setoran, dll.)
            {p.sisaDiLuarToleransi && <span className="keu-pill">di luar toleransi</span>}
          </span>
          <span className="fs16 t-secondary">—</span>
          <span className="num">{rpTeks(sisa.rp)}</span>
        </div>
        <div className="grid-row cols-saldo2" data-baris="jumlah">
          <span className="w600">Cash flow check</span>
          <span />
          <span className="num w600">{rpTeks(p.check)}</span>
        </div>
      </div>
      <p className="keu-p">
        Pembayaran/pengurangan piutang di EasyMax {tanggalPendek(p.date)}: Rp {rpTeks(p.easymax.rp)} ({p.easymax.n} baris).
        Diterima rekening dengan kategori “Transfer Pembayaran Piutang Pelanggan”: Rp {rpTeks(p.bank.rp)} ({p.bank.n}{" "}
        baris).
      </p>
      {(p.hariIni.easymax.length > 0 || p.hariIni.bank.length > 0) && (
        <p className="keu-p t-secondary" data-hari-ini>
          <RincianBaris h={p.hariIni} />
        </p>
      )}
      {kalimat !== null && <p className="keu-p">{kalimat}</p>}
      {p.petunjuk.length > 0 && (
        <ul className="keu-p" data-petunjuk>
          {p.petunjuk.slice(0, MAKS_PETUNJUK).map((h) => (
            <Petunjuk key={h.tanggal} h={h} />
          ))}
        </ul>
      )}
      {p.tanpaHariBerlawanan && <p className="keu-p">{TEKS_TANPA_HARI_BERLAWANAN}</p>}
      {p.aksi === "piutang_waktu" && (
        <p className="keu-p" data-aksi="piutang_waktu">
          <strong>{TEKS_AKSI_PIUTANG_WAKTU}</strong>
        </p>
      )}
      {p.sisaDiLuarToleransi && (
        <p className="keu-p" data-aksi="sisa_di_luar_toleransi">
          <strong>{TEKS_SISA_DI_LUAR_TOLERANSI}</strong>
        </p>
      )}
      {p.aksi === null && <p className="keu-p">Sisa dalam toleransi — pembulatan setoran.</p>}
    </div>
  );
}

function Petunjuk({ h }: { h: PetunjukHari }) {
  return (
    <li data-hari={h.tanggal}>
      <b>{tanggalPendek(h.tanggal)}</b> — selisih waktu pembayaran piutang hari itu <span className="num">{rpTeks(h.selisihRp)}</span>.
      {h.cocok !== null && <> {kalimatCocok(h.cocok)}</>}{" "}
      <span className="t-secondary">
        <RincianBaris h={h} />
      </span>
    </li>
  );
}

/** Baris EasyMax (pelanggan, nominal, keterangan) & bank (id8, rekening …4 digit, nominal, keterangan). */
function RincianBaris({ h }: { h: HariPiutang }) {
  const ket = (k: string | null) => (k ? ` (${k})` : "");
  return (
    <>
      {h.easymax.length > 0 && <>EasyMax: {h.easymax.map((e) => `${e.pelanggan} ${rpTeks(e.rp)}${ket(e.keterangan)}`).join(", ")}. </>}
      {h.bank.length > 0 && <>Bank: {h.bank.map((b) => `${b.id.slice(0, 8)} ${b.rekening} ${rpTeks(b.rp)}${ket(b.keterangan)}`).join(", ")}.</>}
    </>
  );
}
