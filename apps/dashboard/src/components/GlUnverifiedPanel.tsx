import { dateShort } from "@/lib/format";
import {
  GL_AUDIT_HEADING,
  GL_AUDIT_MISSING,
  GL_UNVERIFIED,
  GL_UNVERIFIED_TITLE,
  GL_VERIFY_CAVEATS,
  GL_VERIFY_STEPS,
  glAuditText,
  glReasonText,
  glTankText,
  glUnverifiedPanel,
  type GlUnverifiedItem,
} from "@/lib/gl-verification";

/**
 * Panel "G/L Belum terverifikasi" — rincian per tanggal/(SPBU)/produk/tangki,
 * sebab spesifik dari data sumber, hitungan mentah berlabel, dan langkah
 * verifikasi per sebab. Isi & urutan dari lib/gl-verification (sama dengan
 * PDF); komponen ini hanya merender. Kosong → tidak dirender.
 */
export function GlUnverifiedPanel({
  items,
  hint,
  withUnit = false,
}: {
  items: GlUnverifiedItem[];
  hint: string;
  withUnit?: boolean;
}) {
  if (items.length === 0) return null;
  const p = glUnverifiedPanel(items);
  const cols = `cols-glverif${withUnit ? " unit" : ""}`;
  return (
    <div className="mt10" data-gl-unverified="">
      <div className="section-h">
        <div className="text-h5 t-brand">{GL_UNVERIFIED_TITLE}</div>
        <span className="fs16 t-tertiary">{hint}</span>
        <span className="anom-tag">{p.total} nilai ditahan</span>
      </div>
      <div className="card tbl-card mt4 tbl-scroll">
        <div className={`grid-head ${cols}`}>
          <span>Tanggal</span>
          {withUnit && <span>SPBU</span>}
          <span>Produk</span>
          <span>Tangki</span>
          <span>Sebab</span>
          <span>{GL_AUDIT_HEADING}</span>
        </div>
        {p.shown.map((it, i) => (
          <div key={`${it.unit?.code ?? ""}|${it.d}|${it.ckdbbm ?? ""}|${i}`} className={`grid-row ${cols}`}>
            <span className="fs16 num">{dateShort(it.d)}</span>
            {withUnit && <span className="fs16">{it.unit?.name ?? "—"}</span>}
            <span className="text-caption w600">
              {it.produk}
              <span className="anom-tag zc-tag">{GL_UNVERIFIED}</span>
            </span>
            <span className="fs16 t-secondary">{glTankText(it)}</span>
            <span className="fs16 t-secondary">{glReasonText(it)}</span>
            <span className="fs16 t-secondary num">{glAuditText(it.audit) ?? GL_AUDIT_MISSING}</span>
          </div>
        ))}
        {p.hidden > 0 && (
          <div className="empty-inline">
            +{p.hidden} nilai lain yang lebih lama tidak ditampilkan — semuanya tetap ditahan dari total.
          </div>
        )}
        <div className="lap-cardfoot">
          <div className="w600 t-secondary">Cara memverifikasi</div>
          {p.reasons.map((r) => (
            <div key={r} className="mt2">
              <div className="w600 t-secondary">{GL_VERIFY_STEPS[r].judul}</div>
              <ol className="glverif-steps mt1">
                {GL_VERIFY_STEPS[r].langkah.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ol>
            </div>
          ))}
          <div className="mt2">{GL_VERIFY_CAVEATS}</div>
        </div>
      </div>
    </div>
  );
}
