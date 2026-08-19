"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { GROUP_IDS, Sidebar, type GroupId } from "@/components/Sidebar";
import { useSelection } from "@/components/useSelection";

/** Opsi unit untuk resolusi seed navigasi (bukan kontrol — lihat di bawah). */
export interface UnitOpt {
  code: string;
  label: string;
}

/**
 * Chrome aplikasi (client): topbar + drawer/sidebar + main, sehingga satu
 * komponen memegang seluruh state UI nav.
 *
 * SIDEBAR = CHROME TUNGGAL DI ≥769px. Sejak picker unit/tanggal dihapus (#155)
 * topbar hanya memuat identitas — dibaca sekali lalu diabaikan — padahal ia
 * memegang satu-satunya slot sticky, sementara baris filter yang diraih berulang
 * justru tergulung (terukur: topbar sticky 60,5px; `.board-filters` static).
 * Sekarang `<header>` jadi GRID ITEM `.shell` dan berperan ganda:
 *   ≥769px → menyusut jadi baris merek kolom kiri (hanya logo), menempel di atas
 *            nav; identitas pindah ke `.drawer-foot`; slot sticky diserahkan ke
 *            baris filter halaman;
 *   ≤768px → tetap header penuh: hamburger + logo + Keluar (perilaku mobile
 *            sengaja TIDAK diubah).
 *
 * Filter tetap MILIK HALAMAN (UnitDateFilters / BoardFilters / HarianFilters);
 * chrome global tak pernah mengendalikan unit/tanggal. `units`/`unitCode`/`date`
 * di sini semata SEED untuk membentuk tautan sidebar ke rute per-unit — bukan
 * state yang bisa diubah dari chrome. Akar masalah yang dihapus di #155: picker
 * global yang nilainya diabaikan halaman ber-filter sendiri (/board,
 * /laporan-harian) atau tak berdimensi (/admin, /monitoring/ketaatan) tetapi
 * tetap menulis cookie & memicu refresh.
 *
 * Durabel (localStorage, tahan router.refresh & reload): rail ringkas +
 * buka/tutup grup. EPHEMERAL (useState, default tertutup tiap load): drawer
 * mobile. Bit dari server (lastSync, alertCount, email/role) datang sebagai
 * PROPS dari layout server → router.refresh me-render ulang layout dan
 * meneruskan nilai segar ke sini (state client di atas tetap terjaga).
 */

const COLLAPSED_KEY = "solamax.sidebar.collapsed";
const GROUPS_KEY = "solamax.sidebar.groups";

const DEFAULT_OPEN = Object.fromEntries(GROUP_IDS.map((id) => [id, true])) as Record<
  GroupId,
  boolean
>;

export function AppShell({
  roleLabel,
  email,
  bolehLihatKeuangan,
  lastSync,
  lastSyncUnit,
  lastSyncAwal,
  alertCount,
  units,
  unitCode,
  date,
  signOutSlot,
  children,
}: {
  roleLabel: string;
  email: string | null;
  /** §10.17 — dihitung di SERVER; sidebar tak pernah menyimpulkannya sendiri. */
  bolehLihatKeuangan: boolean;
  lastSync: string | null;
  /** Nama unit dengan sinkron TERLAMA (nilai lastSync = MIN lintas scope). */
  lastSyncUnit: string | null;
  /** Teks "N mnt lalu" yang DIHITUNG DI SERVER — render awal yang aman-hidrasi
   *  untuk AgoLive. Komponen ini klien; menghitungnya sendiri berarti jam server
   *  (SSR) vs jam klien (hidrasi). Lihat components/AgoLive.tsx. */
  lastSyncAwal: string | null;
  alertCount: number;
  units: UnitOpt[];
  unitCode?: string;
  date: string;
  signOutSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>(DEFAULT_OPEN);
  const [mobileOpen, setMobileOpen] = useState(false);
  const path = usePathname();
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Resolusi unit+tanggal terbawa SEKALI, untuk TAUTAN sidebar saja (URL
  // kanonik; prop server unitCode/date hanya seed awal — lihat useSelection).
  const unitCodes = useMemo(() => units.map((u) => u.code), [units]);
  const sel = useSelection(unitCodes, unitCode, date);

  // Rehidrasi state durabel dari localStorage setelah mount (render awal = default).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      const raw = localStorage.getItem(GROUPS_KEY);
      if (raw) setOpenGroups({ ...DEFAULT_OPEN, ...(JSON.parse(raw) as Record<string, boolean>) });
    } catch {
      /* localStorage tak tersedia — pakai default */
    }
  }, []);

  // Drawer mobile: tutup saat pindah rute, dan saat tombol Escape.
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        hamburgerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggleCollapse = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* abaikan */
      }
      return next;
    });

  const toggleGroup = (id: GroupId) =>
    setOpenGroups((g) => {
      const next = { ...g, [id]: !g[id] };
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* abaikan */
      }
      return next;
    });

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      {/* Topbar ADA DI DALAM shell agar ia bisa jadi grid-area "brand": di ≥769px
          ia menyusut jadi baris merek kolom kiri (di atas nav, ikut menempel), di
          ≤768px ia tetap header penuh. Berada di dalam `.shell` juga membuat
          `.shell.collapsed .topbar` bisa menyamakan lebarnya dengan rail 64px —
          mustahil kalau ia tetap saudara di luar. Inilah yang memungkinkan LOGO
          jadi SATU elemen: satu-satunya wadah yang terlihat di mobile (drawer
          tertutup = seluruh <nav> ter-translate keluar layar) sekaligus bisa
          ditempatkan di kolom kiri saat desktop. */}
      <header className="topbar no-print">
        <button
          ref={hamburgerRef}
          type="button"
          className="hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu"
          aria-expanded={mobileOpen}
        >
          <svg viewBox="0 0 20 20" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>
        {/* SATU-SATUNYA logo di aplikasi (dulu dirender dua kali: di sini dan di
            `.side-brand`). `variant="auto"` = swap lockup ↔ badge-mark menurut
            LEBAR SLOT lewat container query, jadi elemen yang sama melayani
            header mobile (lebar), kolom merek desktop (232px), dan rail ringkas
            (64px → badge) tanpa duplikasi di call site. */}
        {/* height 20 = nilai topbar SEBELUM perubahan ini → geometri header
            ≤768px tetap identik (kriteria terima owner). */}
        <Logo variant="auto" href="/" height={20} priority label="SolaMax, beranda" className="shell-brand" />
        {/* Chip peran, badge kesegaran, tautan Akses, dan email DIHAPUS dari sini:
            semuanya ber-`mobile-hide` (mati ≤768px) dan kini juga tertutup aturan
            desktop `.topbar > :not(.shell-brand)` — terukur tak terlihat di 1440,
            900, maupun 375px. Identitas hidup di `.drawer-foot`; "Akses" memang
            sudah ada sebagai item sidebar "Kelola akses" (nol kehilangan akses).

            KELUAR SENGAJA DIRENDER DUA KALI (di sini untuk ≤768px, dan di
            `.drawer-foot` untuk ≥769px) — PENGECUALIAN yang didokumentasikan,
            bukan pola umum. Menyatukannya menuntut restrukturisasi lintas-subtree
            (<header> vs <nav>) yang lebih besar risikonya daripada manfaatnya.
            Syarat yang dijaga & diverifikasi: server action IDENTIK ($ACTION_ID
            sama), label identik "Keluar", TIDAK PERNAH terlihat bersamaan, yang
            tersembunyi keluar dari layout DAN pohon aksesibilitas lewat
            `display:none` (bukan visibility/opacity/off-screen), nol duplicate id.
            Jangan merestrukturisasi layout hanya demi menghapus duplikasi ini
            kecuali ditemukan bug atau masalah aksesibilitas nyata. */}
        <div className="topbar-right">{signOutSlot}</div>
      </header>

      {mobileOpen && (
        <div className="scrim no-print" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <Sidebar
        unitCode={sel.unit}
        date={sel.navDate}
        alertCount={alertCount}
        signOutSlot={signOutSlot}
        lastSyncUnit={lastSyncUnit}
        lastSyncAwal={lastSyncAwal}
        collapsed={collapsed}
        bolehLihatKeuangan={bolehLihatKeuangan}
        openGroups={openGroups}
        mobileOpen={mobileOpen}
        onToggleCollapse={toggleCollapse}
        onToggleGroup={toggleGroup}
        onCloseMobile={() => setMobileOpen(false)}
        email={email}
        roleLabel={roleLabel}
        lastSync={lastSync}
      />
      <main className="main">{children}</main>
    </div>
  );
}
