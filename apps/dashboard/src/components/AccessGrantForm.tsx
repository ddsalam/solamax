"use client";

import { useState } from "react";

/**
 * Form "beri akses" — HANYA dirender untuk super_admin (gerbangnya server-side di
 * admin-actions.ts, ini sekadar lapisan pengalaman).
 *
 * Cascade tenant → unit: daftar unit yang tampil SELALU difilter ke tenant terpilih,
 * sehingga penugasan lintas-tenant tak bisa dirakit di layar. Penegak sesungguhnya
 * tetap FK komposit 0019 di DB — ini hanya mencegah pengguna menyusun sesuatu yang
 * nanti ditolak.
 */
export interface UserOpt {
  id: number;
  email: string | null;
  name: string | null;
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
}: {
  users: UserOpt[];
  tenants: TenantOpt[];
  units: UnitOpt[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [tenantId, setTenantId] = useState("");
  const [unitMode, setUnitMode] = useState<"all" | "list">("all");
  const [userId, setUserId] = useState("");

  const unitsOfTenant = units.filter((u) => u.tenant_id === tenantId);
  const picked = users.find((u) => String(u.id) === userId);

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
          onChange={(e) => setUserId(e.target.value)}
          className="seg-btn"
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="">— pilih pengguna —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} {u.name ? `(${u.name})` : ""}
              {u.role ? ` · ${u.role}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="fs15 w600 t-secondary">
        Role
        <select
          name="role"
          required
          className="seg-btn"
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="direksi">Direksi</option>
          <option value="admin_perusahaan">Admin Perusahaan</option>
          <option value="pengawas">Pengawas</option>
        </select>
      </label>
      {picked?.role && (
        <p className="fs15 t-tertiary" style={{ margin: 0 }}>
          ⚠️ {picked.email} sudah ber-role <strong>{picked.role}</strong>. Role bersifat
          tunggal per orang: mengubahnya di sini berlaku di <strong>semua perusahaan</strong>{" "}
          tempat ia punya penugasan.
        </p>
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
            onChange={() => setUnitMode("all")}
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
            onChange={() => setUnitMode("list")}
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
