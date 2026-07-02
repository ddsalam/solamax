"use client";

/**
 * Ambil logo (PNG dari /public) sekali → data URL untuk disematkan ke PDF pdfmake
 * (pdfmake perlu dataURL, bukan URL). Dipakai semua {Report}Export. Gagal ambil →
 * undefined (builder jatuh ke wordmark teks).
 */
import { useEffect, useState } from "react";

export function useLogoDataUrl(path = "/brand/solamax-horizontal.png"): string | undefined {
  const [logo, setLogo] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch(path)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo"))))
      .then(
        (blob) =>
          new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result as string);
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          }),
      )
      .then((url) => {
        if (alive) setLogo(url);
      })
      .catch(() => {
        /* fallback wordmark teks di PDF */
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return logo;
}
