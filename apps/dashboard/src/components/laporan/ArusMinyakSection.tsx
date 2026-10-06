import { arusQualityNote, arusTag, type ArusMinyak, type ArusRow, type ZeroFlag } from "@/lib/arus-minyak";
import { num2 as liter2 } from "@/lib/format";
import { GL_UNVERIFIED, GL_UNVERIFIED_TITLE } from "@/lib/gl-verification";

/**
 * ARUS MINYAK HARIAN — padanan blok "ARUS MINYAK" pada LAPORAN RESUME
 * OPERASIONAL EasyMax. Bukan angka baru: Losses di sini ≡ Gain/Losses panel
 * "Omset Penjualan, Gain (Losses) & Tera" pada halaman yang sama (lihat
 * lib/arus-minyak.ts). Kolom "Persediaan (L)" EasyMax sengaja TIDAK dirender
 * (keputusan owner; = Stock Awal + Penerimaan, nol informasi baru).
 *
 * Komponen TERPISAH — bukan JSX inline seperti section tetangganya — supaya
 * harness verifikasi bisa merender KOMPONEN YANG SAMA dengan produksi terhadap
 * data live dan membaca angkanya dari HTML hasil render, bukan dari fungsi
 * query yang membangunnya (`arus-minyak.render.test.tsx`). Halaman Laporan
 * terkunci Google OAuth (sesi DB) sehingga tidak bisa dibuka agen, dan token
 * sesi tidak boleh disentuh.
 */
export function ArusMinyakSection({ arus }: { arus: ArusMinyak }) {
  const qualityNote = arusQualityNote(arus, liter2);
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Arus Minyak Harian</div>
        <span className="fs16 t-tertiary">
          per produk · stok awal → penerimaan → penjualan → losses
        </span>
        {arus.provisional && (
          <span className="anom-tag" title="opname penutup D+1 belum ada">
            belum final
          </span>
        )}
      </div>
      <div className="card tbl-card mt4 tbl-scroll">
        <div className="grid-head cols-arus">
          <span>Produk</span>
          <span className="right">Stock Awal (L)</span>
          <span className="right">Penerimaan (L)</span>
          <span className="right">Penjualan (L)</span>
          <span className="right">Stock Teori (L)</span>
          <span className="right">Stock Fisik (L)</span>
          <span className="right">Losses (L)</span>
          <span className="right">%</span>
        </div>
        {qualityNote && (
          <div className="empty-inline t-warning zc-note">
            <strong>⚠ {qualityNote}</strong>
          </div>
        )}
        {arus.rows.length === 0 && (
          <div className="empty-inline">
            Belum ada opname penutup pada tanggal bisnis ini — arus minyak belum bisa disusun.
          </div>
        )}
        {arus.rows.map((p) => (
          <div key={p.ckdbbm} className="grid-row cols-arus" data-arus-row={p.nama}>
            <span className="text-caption w600">
              {p.nama}
              {arusTag(p) && (
                <span className="anom-tag zc-tag" title={tagPesan(p)}>
                  {arusTag(p)}
                </span>
              )}
            </span>
            <span className="right fs16 t-secondary num">{liter2(p.awal)}</span>
            <span className="right fs16 t-secondary num">{liter2(p.penerimaan)}</span>
            <span className="right fs16 t-secondary num">{liter2(p.penjualan)}</span>
            <span className="right fs16 t-secondary num">{liter2(p.teori)}</span>
            <span className="right fs16 t-secondary num">{liter2(p.fisik)}</span>
            <span className={`right fs16 num ${lossTone(p.losses)}`}>{liter2(p.losses)}</span>
            <span className={`right fs16 num ${lossTone(p.losses)}`} title={pctTitle(p)}>
              {liter2(p.pct)}
            </span>
          </div>
        ))}
        {arus.rows.length > 0 && (
          <div className="grid-total cols-arus" data-arus-row="TOTAL">
            <span className="text-caption w700">TOTAL</span>
            <span className="right w700 num lap-totnum">{liter2(arus.total.awal)}</span>
            <span className="right w700 num lap-totnum">{liter2(arus.total.penerimaan)}</span>
            <span className="right w700 num lap-totnum">{liter2(arus.total.penjualan)}</span>
            <span className="right w700 num lap-totnum">{liter2(arus.total.teori)}</span>
            <span className="right w700 num lap-totnum">{liter2(arus.total.fisik)}</span>
            <span className={`right w700 num lap-totnum ${lossTone(arus.total.losses)}`}>
              {liter2(arus.total.losses)}
            </span>
            <span className={`right w700 num lap-totnum ${lossTone(arus.total.losses)}`}>
              {liter2(arus.total.pct)}
            </span>
          </div>
        )}
        <div className="lap-cardfoot">
          Stock Teori = Stock Awal + Penerimaan − Penjualan · Losses = Stock Fisik − Stock Teori ·
          % = Losses ÷ penjualan kotor. Stock Awal = Stock Fisik hari-bisnis sebelumnya; Penjualan
          = jual kotor dikurangi tera resmi; Penerimaan = volume DO.
          {arus.teraTotal > 0 && (
            <>
              {" "}
              <strong>Tera {liter2(arus.teraTotal)} L hari ini.</strong> Mengikuti definisi
              EasyMax, kolom Penjualan sudah dikurangi tera, tetapi TOTAL Penjualan dan seluruh
              kolom % memakai penjualan KOTOR (belum dikurangi tera) — karena itu TOTAL Penjualan
              lebih besar {liter2(arus.teraTotal)} L daripada jumlah kolom di atasnya. Bukan
              tabel yang rusak.
            </>
          )}
          {arus.excludedTanks > 0 &&
            ` ${arus.excludedTanks} baris dengan stok atau identitas produk/tangki tidak valid membuat Stock Fisik tidak lengkap (lihat anomali kualitas data).`}
          {arus.incomplete &&
            " Nilai dengan stok/identitas sumber tidak lengkap bertanda “—”; total G/L yang bergantung padanya belum tersedia. Stock Teori dan total stok juga tidak tersedia bila inputnya tidak lengkap. Bila mutasi sumber tidak lengkap, angka penerimaan/penjualan/tera yang tersedia hanya bersifat diagnostik."}
        </div>
      </div>
    </div>
  );
}

/**
 * Pesan penanda — menyebut APA YANG HARUS DILAKUKAN, bukan sekadar bahwa ada
 * sesuatu. Kelas 2 menyebut tangkinya karena di situlah ralatnya.
 */
function tagPesan(p: ArusRow): string {
  if (arusTag(p) === GL_UNVERIFIED) {
    const mentah = p.glMentah !== null ? ` Hitungan mentah Fisik − Teori ${liter2(p.glMentah)} L hanya untuk audit.` : "";
    return `G/L ${GL_UNVERIFIED}: Losses & % ditahan dan tidak dihitung.${mentah} Sebab dan cara verifikasinya ada di panel “${GL_UNVERIFIED_TITLE}”.`;
  }
  return `${zcAsal(p.zeroClosing!)} Losses yang tampil tetap hasil ukur kanonis; peringatan ini saja tidak membuktikan kerugian maupun saldo yang tidak sah. Periksa entri di EasyMax; bila salah, ralat lalu muat ulang.`;
}

function zcAsal(z: ZeroFlag): string {
  return z.kelas === 2
    ? `Tangki ${z.tangki.join(", ")}: penutup opname 0 sementara hari sebelum & sesudahnya berisi, tanpa DO yang menjelaskan.`
    : "Penutup opname 0 padahal Stock Teori menunjukkan tangki mestinya berisi ribuan liter.";
}

/** Warna Losses/% — konvensi sama dgn kolom Gain/Losses panel Omset. */
function lossTone(v: number | null): string {
  if (v === null) return "t-tertiary";
  if (v < 0) return "t-danger w700";
  return v > 0 ? "t-success" : "t-tertiary";
}

/** "—" pada kolom % hanya terjadi bila Penjualan = 0 sementara Losses ≠ 0. */
function pctTitle(p: Pick<ArusRow, "pct" | "penjualan" | "losses">): string {
  if (p.pct !== null) return "Losses ÷ Penjualan";
  if (p.losses === null) return "Losses belum terhitung";
  return "Penjualan 0 L — rasio terhadap penjualan tak terdefinisi";
}
