/**
 * Nama cookie pilihan unit+tanggal terbawa. File ini SENGAJA tanpa import
 * server (mis. next/headers) agar aman diimpor dari komponen client
 * (TopbarPicker) maupun server (selection.ts).
 */
export const UNIT_COOKIE = "solamax.unit";
export const DATE_COOKIE = "solamax.date";

/** Umur cookie (detik) — 30 hari. */
export const SELECTION_MAX_AGE = 60 * 60 * 24 * 30;
