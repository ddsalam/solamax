import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  canChangeRole,
  canCreateMembership,
  canHardDelete,
  canManageAccess,
  checkTouchMembership,
  kodeGagal,
  PESAN_HASIL,
  roleGrantAllowed,
  type AdminAuthority,
} from "./admin-rules";

/**
 * TES NEGATIF ADMIN TERDELEGASI (A1–A5). Aksi server di admin-actions.ts hanya
 * MEMANGGIL fungsi-fungsi ini — tidak menyalin logikanya — sehingga lolosnya tes ini
 * adalah jaminan atas jalur produksi, bukan atas salinan.
 */
const PT_A = "aaaa1111-1111-1111-1111-111111111111";
const PT_B = "bbbb2222-2222-2222-2222-222222222222";

const superAdmin: AdminAuthority = { userId: 1, role: "super_admin", tenantIds: [] };
const adminA: AdminAuthority = { userId: 2, role: "admin_perusahaan", tenantIds: [PT_A] };
const direksiA: AdminAuthority = { userId: 3, role: "direksi", tenantIds: [PT_A] };
const pengawasA: AdminAuthority = { userId: 4, role: "pengawas", tenantIds: [PT_A] };

describe("siapa boleh membuka /admin", () => {
  it("super_admin dan admin_perusahaan boleh", () => {
    expect(canManageAccess(superAdmin)).toBe(true);
    expect(canManageAccess(adminA)).toBe(true);
  });
  it("direksi dan pengawas TIDAK boleh", () => {
    expect(canManageAccess(direksiA)).toBe(false);
    expect(canManageAccess(pengawasA)).toBe(false);
  });
});

describe("wewenang eksklusif super_admin", () => {
  it("hanya super_admin boleh MEMBUAT membership (orang baru)", () => {
    expect(canCreateMembership(superAdmin)).toBe(true);
    expect(canCreateMembership(adminA)).toBe(false);
  });
  it("hanya super_admin boleh HARD-DELETE; admin terdelegasi memakai suspend", () => {
    expect(canHardDelete(superAdmin)).toBe(true);
    expect(canHardDelete(adminA)).toBe(false);
  });
});

describe("A1 — tenant di luar wewenang", () => {
  it("admin PT A DITOLAK menyentuh membership PT B", () => {
    const v = checkTouchMembership(adminA, { userId: 9, tenantId: PT_B, role: "pengawas" });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/tenant di luar wewenang/);
  });
  it("admin PT A BOLEH menyentuh membership PT A", () => {
    expect(checkTouchMembership(adminA, { userId: 9, tenantId: PT_A, role: "pengawas" }).ok).toBe(
      true,
    );
  });
  it("super_admin boleh menyentuh tenant mana pun", () => {
    expect(checkTouchMembership(superAdmin, { userId: 9, tenantId: PT_B, role: "direksi" }).ok).toBe(
      true,
    );
  });
});

describe("A2 — super_admin tak pernah dikelola lewat UI", () => {
  it("membership ber-role super_admin ditolak untuk SEMUA pelaku", () => {
    for (const a of [superAdmin, adminA]) {
      const v = checkTouchMembership(a, { userId: 9, tenantId: null, role: "super_admin" });
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toMatch(/super_admin/);
    }
  });
  it("admin terdelegasi tak bisa memberikan admin_perusahaan; super_admin bisa", () => {
    expect(assignableRoles(adminA)).toEqual(["direksi", "pengawas"]);
    expect(assignableRoles(adminA)).not.toContain("admin_perusahaan");
    expect(assignableRoles(superAdmin)).toContain("admin_perusahaan");
  });
  it("super_admin tidak pernah ada di daftar role yang bisa diberikan", () => {
    expect(assignableRoles(superAdmin)).not.toContain("super_admin");
    expect(assignableRoles(adminA)).not.toContain("super_admin");
  });
});

describe("A3 — role GLOBAL: eskalasi lintas-PT lewat admin terdelegasi", () => {
  it("DITOLAK bila target punya penugasan di PT lain", () => {
    const v = canChangeRole(adminA, [PT_A, PT_B]);
    expect(v.ok).toBe(false);
  });
  it("pesan penolakan TIDAK mengonfirmasi adanya penugasan lintas-tenant", () => {
    // Menyembunyikan/mengubah pesan BERDASARKAN keberadaan penugasan lain adalah
    // sinyal itu sendiri. Pesannya harus tak menjawab pertanyaan yang tak berhak
    // ditanyakan — dan harus SAMA untuk kedua sebab penolakan.
    const lintas = canChangeRole(adminA, [PT_A, PT_B]);
    const global = canChangeRole(adminA, [PT_A, null]);
    expect(lintas.ok).toBe(false);
    expect(global.ok).toBe(false);
    const pesan = lintas.ok === false ? lintas.reason : "";
    expect(pesan).not.toMatch(/perusahaan lain|tenant lain|PT lain|punya penugasan/i);
    expect(pesan).toMatch(/di luar wewenang Anda/);
    expect(global.ok === false && global.reason).toBe(pesan); // identik, tak bisa dibedakan
  });
  it("DITOLAK bila target punya membership global (tenant NULL)", () => {
    expect(canChangeRole(adminA, [PT_A, null]).ok).toBe(false);
  });
  it("DIIZINKAN bila seluruh penugasan target ada di dalam tenant si admin", () => {
    expect(canChangeRole(adminA, [PT_A, PT_A]).ok).toBe(true);
  });
  it("super_admin tidak tunduk A3", () => {
    expect(canChangeRole(superAdmin, [PT_A, PT_B, null]).ok).toBe(true);
  });
});

describe("A4 — tak pernah menyentuh diri sendiri", () => {
  it("admin terdelegasi DITOLAK mengubah membership-nya sendiri", () => {
    const v = checkTouchMembership(adminA, {
      userId: adminA.userId,
      tenantId: PT_A,
      role: "admin_perusahaan",
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/diri sendiri/);
  });
  it("admin terdelegasi tetap boleh menyentuh ORANG LAIN di tenantnya", () => {
    expect(
      checkTouchMembership(adminA, { userId: 99, tenantId: PT_A, role: "direksi" }).ok,
    ).toBe(true);
  });
});

describe("admin dengan penugasan di DUA PT", () => {
  const adminAB: AdminAuthority = {
    userId: 5,
    role: "admin_perusahaan",
    tenantIds: [PT_A, PT_B],
  };
  it("boleh menyentuh kedua PT-nya", () => {
    expect(checkTouchMembership(adminAB, { userId: 9, tenantId: PT_A, role: "pengawas" }).ok).toBe(true);
    expect(checkTouchMembership(adminAB, { userId: 9, tenantId: PT_B, role: "pengawas" }).ok).toBe(true);
  });
  it("DITOLAK di PT ketiga", () => {
    const PT_C = "cccc3333-3333-3333-3333-333333333333";
    expect(checkTouchMembership(adminAB, { userId: 9, tenantId: PT_C, role: "pengawas" }).ok).toBe(
      false,
    );
  });
  it("A3 memakai gabungan tenantnya", () => {
    expect(canChangeRole(adminAB, [PT_A, PT_B]).ok).toBe(true);
  });
});

describe("roleGrantAllowed — form 'beri akses' tak pernah mengubah role", () => {
  it("pengguna BARU (belum punya role) → boleh menetapkan role", () => {
    expect(roleGrantAllowed(null, "pengawas").ok).toBe(true);
    expect(roleGrantAllowed(null, "direksi").ok).toBe(true);
  });
  it("role SAMA → lolos (menambah perusahaan tanpa menyentuh role)", () => {
    expect(roleGrantAllowed("pengawas", "pengawas").ok).toBe(true);
  });
  it("role BERBEDA → DITOLAK, dengan alasan yang menunjuk ke kontrol yang benar", () => {
    const v = roleGrantAllowed("pengawas", "direksi");
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/Set/);
  });
  it("penurunan role pun ditolak — arah mana pun bukan urusan form ini", () => {
    expect(roleGrantAllowed("direksi", "pengawas").ok).toBe(false);
    expect(roleGrantAllowed("admin_perusahaan", "direksi").ok).toBe(false);
  });
});

describe("umpan balik aksi — netral, dan tak mengembalikan kebocoran #142", () => {
  it("SEMUA penolakan wewenang → SATU kode yang sama, apa pun sebabnya", () => {
    const sebab = [
      // A1 tenant lain · A2 super_admin · A4 diri sendiri  (checkTouchMembership)
      checkTouchMembership(adminA, { userId: 9, tenantId: PT_B, role: "pengawas" }),
      checkTouchMembership(adminA, { userId: 9, tenantId: null, role: "super_admin" }),
      checkTouchMembership(adminA, { userId: adminA.userId, tenantId: PT_A, role: "direksi" }),
      // A3 lintas-tenant + A3 membership global
      canChangeRole(adminA, [PT_A, PT_B]),
      canChangeRole(adminA, [PT_A, null]),
      // form beri-akses mengubah role
      roleGrantAllowed("pengawas", "direksi"),
    ];
    const kode = sebab.map((v) => kodeGagal(new Error(`forbidden: ${v.ok ? "" : v.reason}`)));
    expect(new Set(kode).size).toBe(1); // TIDAK bisa dibedakan
    expect(kode[0]).toBe("wewenang");
  });

  it("teks yang ditampilkan tidak menyebut perusahaan/tenant lain", () => {
    const t = PESAN_HASIL.wewenang.teks;
    expect(t).not.toMatch(/perusahaan lain|tenant lain|PT lain|punya penugasan/i);
    expect(t).toMatch(/Tidak ada yang diubah/); // memberi tahu bahwa aksi TIDAK berlaku
  });

  it("galat non-wewenang dipetakan terpisah (agar 'tersimpan' tak pernah dikira gagal)", () => {
    expect(kodeGagal(new Error("role tidak valid"))).toBe("input");
    expect(kodeGagal(new Error("membership tidak ditemukan"))).toBe("input");
    expect(PESAN_HASIL.ok.nada).toBe("ok");
  });
});
