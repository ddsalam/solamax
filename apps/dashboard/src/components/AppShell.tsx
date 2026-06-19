"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GROUP_IDS, Sidebar, type GroupId } from "@/components/Sidebar";
import { TopbarPicker, type UnitOpt } from "@/components/TopbarPicker";
import { ago } from "@/lib/format";

/**
 * Chrome aplikasi (client): topbar + drawer/sidebar + main, sehingga satu
 * komponen memegang seluruh state UI nav.
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
  isSuperAdmin,
  lastSync,
  alertCount,
  units,
  unitCode,
  date,
  signOutSlot,
  children,
}: {
  roleLabel: string;
  email: string | null;
  isSuperAdmin: boolean;
  lastSync: string | null;
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
    <>
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
        <Image src="/solagroup-logo.png" alt="SolaGroup" width={120} height={20} className="topbar-logo" />
        <div className="topbar-div mobile-hide" />
        <span className="text-caption w600 t-secondary mobile-hide">SolaMax</span>
        <span className="role-chip mobile-hide">{roleLabel}</span>
        <TopbarPicker units={units} unit={unitCode} date={date} />
        <div className="topbar-right">
          <span className="fs15 t-tertiary sync-note mobile-hide">
            <span className={`dot ${lastSync ? "success pulse" : "muted"}`} />
            {lastSync ? `data terakhir masuk ${ago(lastSync)}` : "menunggu koneksi data"}
          </span>
          {isSuperAdmin && (
            <Link href="/admin" className="fs15 w600 t-accent mobile-hide">
              Akses
            </Link>
          )}
          <span className="fs15 t-tertiary auth-email mobile-hide">{email}</span>
          {signOutSlot}
        </div>
      </header>

      <div className={`shell${collapsed ? " collapsed" : ""}`}>
        {mobileOpen && (
          <div className="scrim no-print" onClick={() => setMobileOpen(false)} aria-hidden="true" />
        )}
        <Sidebar
          unitCode={unitCode}
          date={date}
          alertCount={alertCount}
          collapsed={collapsed}
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
    </>
  );
}
