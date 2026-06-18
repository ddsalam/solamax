"use client";

import { useEffect, useState } from "react";
import { GROUP_IDS, Sidebar, type GroupId } from "@/components/Sidebar";

/**
 * Pembungkus shell (grid sidebar + main) yang memegang state UI tahan-lama:
 * rail ringkas (collapsed) & buka/tutup tiap grup. Sumber durabel =
 * localStorage (bertahan lewat router.refresh() AutoRefresh DAN hard reload);
 * useState hanya memegangnya untuk render, di-rehidrasi sekali saat mount agar
 * tak ada mismatch SSR. `children` = halaman server, diteruskan apa adanya.
 */

const COLLAPSED_KEY = "solamax.sidebar.collapsed";
const GROUPS_KEY = "solamax.sidebar.groups";

const DEFAULT_OPEN = Object.fromEntries(GROUP_IDS.map((id) => [id, true])) as Record<
  GroupId,
  boolean
>;

export function AppShell({
  unitCode,
  date,
  alertCount,
  children,
}: {
  unitCode?: string;
  date: string;
  alertCount: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<GroupId, boolean>>(DEFAULT_OPEN);

  // Rehidrasi dari localStorage setelah mount (render awal = default).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      const raw = localStorage.getItem(GROUPS_KEY);
      if (raw) setOpenGroups({ ...DEFAULT_OPEN, ...(JSON.parse(raw) as Record<string, boolean>) });
    } catch {
      // localStorage tak tersedia — tetap pakai default (terbuka, tak ringkas).
    }
  }, []);

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
      <Sidebar
        unitCode={unitCode}
        date={date}
        alertCount={alertCount}
        collapsed={collapsed}
        openGroups={openGroups}
        onToggleCollapse={toggleCollapse}
        onToggleGroup={toggleGroup}
      />
      <main className="main">{children}</main>
    </div>
  );
}
