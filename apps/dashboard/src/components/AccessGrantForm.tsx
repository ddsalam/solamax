"use client";

import { GRANTABLE_ROLES, ROLE_LABEL, roleLabel } from "@/lib/admin-rules";
import { useState } from "react";

/**
 * Form "beri akses / tambah perusahaan" — HANYA dirender untuk super_admin
 * (gerbangnya server-side di admin-actions.ts; ini lapisan pengalaman).
 *
 * Tiga hal yang WAJIB tetap benar di sini:
 *
 * 1. **Role TIDAK diubah dari form ini.** Role bersifat global per orang. Versi
 *    sebelumnya memakai `<select name="role">` tak-terkendali yang default-nya
 *    "Direksi", sementara server meng-upsert `app.user_role` — sehingga menambahkan
 *    perusahaan kedua untuk seorang PENGAWAS, tanpa menyentuh select itu, diam-diam
 *    menaikkannya jadi direksi di SEMUA perusahaannya. Kini role ditampilkan
 *    read-only dan dikirim lewat `<input type="hidden">` — `<select disabled>` TIDAK
 *    ikut terkirim di FormData, jadi cara itu justru memunculkan "role tidak valid".
 *    Pengguna yang belum punya role sama sekali (membership pertamanya) tetap boleh
 *    memilih; itu satu-satunya kasus sah.
 *
 * 2. **Default cakupan unit mengikuti ROLE EFEKTIF pengguna terpilih** — pengawas →
 *    "unit tertentu"; direksi/admin → "semua unit PT". Diturunkan dari orangnya,
 *    bukan dari isi select mentah, dan TIDAK menimpa radio yang sudah diubah admin.
 *
 * 3. **Cascade tenant → unit**: daftar unit selalu difilter ke tenant terpilih,
 *    sehingga penugasan lintas-tenant tak bisa dirakit di layar. Penegak
 *    sesungguhnya tetap FK komposit 0019 di DB.
 */
export interface UserOpt {
  id: number;
  email: string | null;
  name: string | null;
  /** Role yang SUDAH dimiliki (app.user_role); null = belum punya sama sekali. */
  role: string | null;
}
export interface TenantOpt {
  id: string;
  name: string;
}
export interface UnitOpt {
  unit_id: number;
  code: string;
  name: string;
  tenant_id: string | null;
}



export function AccessGrantForm({
  users,
  tenants,
  units,
  action,
  preselectUserId,
}: {
  users: UserOpt[];
  tenants: TenantOpt[];
  units: UnitOpt[];
  action: (formData: FormData) => Promise<void>;
  /** Diisi lewat ?tambah=<id> oleh tombol "Tambah perusahaan" di blok pengguna. */
  preselectUserId?: string;
}) {
  const [userId, setUserId] = useState(preselectUserId ?? "");
  const [tenantId, setTenantId] = useState("");
  const [modeTouched, setModeTouched] = useState(false);
  const [modePilihan, setModePilihan] = useState<"all" | "list">("all");
  /** Role untuk pengguna yang BELUM punya role (satu-satunya yang bisa dipilih). */
  const [roleBaru, setRoleBaru] = useState("pengawas");

  const picked = users.find((u) => String(u.id) === userId);
  const roleTerkunci = picked?.role ?? null;
  const roleEfektif = roleTerkunci ?? roleBaru;

  // Default diturunkan dari role EFEKTIF; pilihan sadar admin tidak ditimpa.
  const unitMode: "all" | "list" = modeTouched
    ? modePilihan
    : roleEfektif === "pengawas" || roleEfektif === "keuangan"
      ? // Default SEMPIT untuk peran yang bekerja di unit tertentu. "all" boleh,
        // tapi harus pilihan sadar admin — bukan yang terjadi kalau ia diam.
        "list"
      : "all";
  const pilihMode = (m: "all" | "list") => {
    setModeTouched(true);
    setModePilihan(m);
  };

  const unitsOfTenant = units.filter((u) => u.tenant_id === tenantId);

  return (
    <form
      action={action}
      className="card card-pad-lg mt4"
      style={{ display: "grid", gap: "var(--space-4)" }}
    >
      <label className="fs15 w600 t-secondary">
        Pengguna (sudah pernah login)
        <select
          name="userId"
          required
          value={userId}
          onChange={(e) => {
            setUserId(e.target.value);
            setModeTouched(false); // default ikut role pengguna baru terpilih
          }}
          className="seg-btn"
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="">— pilih pengguna —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} {u.name ? `(${u.name})` : ""}
              {u.role ? ` · ${roleLabel(u.role)}` : " · belum punya role"}
            </option>
          ))}
        </select>
      </label>

      {/* Role: TERKUNCI bila pengguna sudah punya; bisa dipilih hanya untuk yang belum. */}
      {roleTerkunci ? (
        <div className="fs15 w600 t-secondary">
          Role
          <input type="hidden" name="role" value={roleTerkunci} />
          <div
            className="fs16"
            style={{
              marginTop: 6,
              padding: "8px 12px",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              background: "var(--surface-subtle, transparent)",
            }}
          >
            {roleLabel(roleTerkunci)} <span className="t-tertiary">· terkunci</span>
          </div>
          <p className="fs15 t-tertiary" style={{ marginTop: 6, marginBottom: 0, fontWeight: 400 }}>
            Role berlaku di <strong>semua perusahaan</strong> orang ini, jadi form ini tidak
            mengubahnya. Untuk mengubah role, pakai kontrol <strong>Set</strong> di baris
            penugasannya.
          </p>
        </div>
      ) : (
        <label className="fs15 w600 t-secondary">
          Role <span className="t-tertiary">(pengguna ini belum punya role)</span>
          <select
            name="role"
            required
            value={roleBaru}
            onChange={(e) => {
              setRoleBaru(e.target.value);
              setModeTouched(false);
            }}
            className="seg-btn"
            style={{ display: "block", width: "100%", marginTop: 6 }}
          >
            {GRANTABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="fs15 w600 t-secondary">
        Perusahaan (tenant)
        <select
          name="tenantId"
          required
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="seg-btn"
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="">— pilih tenant —</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset
        style={{
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: "var(--space-3)",
        }}
      >
        <legend className="fs15 w600 t-secondary">Cakupan unit</legend>
        <label className="fs15 t-secondary" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="radio"
            name="unitMode"
            value="all"
            checked={unitMode === "all"}
            onChange={() => pilihMode("all")}
          />
          Semua unit perusahaan ini <span className="t-tertiary">(unit baru ikut otomatis)</span>
        </label>
        <label
          className="fs15 t-secondary"
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}
        >
          <input
            type="radio"
            name="unitMode"
            value="list"
            checked={unitMode === "list"}
            onChange={() => pilihMode("list")}
          />
          Unit tertentu saja <span className="t-tertiary">(beku — unit baru tidak ikut)</span>
        </label>

        {unitMode === "list" && (
          <div style={{ display: "grid", gap: 6, marginTop: 8, paddingLeft: 22 }}>
            {!tenantId && <span className="fs15 t-tertiary">Pilih perusahaan dulu.</span>}
            {tenantId && unitsOfTenant.length === 0 && (
              <span className="fs15 t-tertiary">Perusahaan ini belum punya unit aktif.</span>
            )}
            {unitsOfTenant.map((u) => (
              <label
                key={u.unit_id}
                className="fs15 t-secondary"
                style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <input type="checkbox" name="unitIds" value={u.unit_id} />
                {u.code} · {u.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <button type="submit" className="btn-navy" style={{ justifySelf: "start" }}>
        Simpan akses
      </button>
    </form>
  );
}
