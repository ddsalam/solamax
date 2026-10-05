import { describe, expect, it } from "vitest";
import { buildHarianModel, type HarianInput } from "@/lib/harian-model";
import type { DailySalesRow } from "@/lib/queries";
import type { ScopedUnit, ScopedUnitId } from "@/lib/scope-rule";
import { buildHarianDocDefinition, type HarianDocMeta } from "./harian-doc";

const U = (id: number, code: string, name: string): ScopedUnit => ({ unit_id: id as ScopedUnitId, code, name });
const UNITS = [U(1, "6478111", "IB"), U(2, "6378301", "BK")];
const sale = (u: number, d: string, nama: string, vol: number): DailySalesRow => ({ unit_id: u, d, ckdbbm: "BB-x", nama, vol, omzet: vol * 10000 });
const META: HarianDocMeta = { ptLabel: "PT Uji", dateLong: "Rabu, 22 Juli 2026", unitsCount: 2, divisor: 22, generatedLabel: "x", freshnessLabel: "sinkron terlama: BK, baru saja" };
const input: HarianInput = {
  units: UNITS, date: "2026-07-22",
  dailySales: UNITS.flatMap((u) => [sale(u.unit_id, "2026-07-22", "SOLAR", 1000)]),
  gl: new Map(), coverage: UNITS.map((u) => ({ unit_id: u.unit_id, sales_min: "2020-01-01" })),
  sync: UNITS.map((u) => ({ unit_id: u.unit_id, last_run: "2026-07-24T07:00:00Z" })), recordFloor: "2025-12-29",
};

describe("buildHarianDocDefinition — struktur", () => {
  const doc = buildHarianDocDefinition({ model: buildHarianModel(input), meta: META });
  it("A4 lanskap (7 kolom)", () => {
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("landscape");
  });
  it("footer fungsi (Halaman X dari Y + kesegaran)", () => {
    expect(typeof doc.footer).toBe("function");
    const f = (doc.footer as (a: number, b: number) => { columns: Array<{ text: string }> })(1, 3);
    const txt = f.columns.map((c) => c.text).join(" ");
    expect(txt).toContain("Halaman 1 dari 3");
    expect(txt).toContain("sinkron terlama");
  });
  it("info judul memuat PT + tanggal", () => {
    expect(String(doc.info?.title)).toContain("PT Uji");
  });
  it("presentation-only: dibangun dari model tanpa melempar", () => {
    expect(() => buildHarianDocDefinition({ model: buildHarianModel(input), meta: META })).not.toThrow();
  });
});

// Exercise pdfmake pagination and final label coordinates, not just doc-tree flags.
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const maker:any=(pdfMakeImport as any).default??pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fonts:any=(vfsImport as any).default??vfsImport;
maker.vfs=fonts.pdfMake?.vfs??fonts.vfs??fonts;
it("keeps chart headings with plots across a page boundary and aligns 13 month labels",async()=>{
 const units=Array.from({length:7},(_,i)=>U(i+1,String(6478111+i),`SPBU ${i+1}`));
 const model=buildHarianModel({...input,units,dailySales:units.flatMap(u=>Array.from({length:13},(_,i)=>sale(u.unit_id,new Date(Date.UTC(2025,6+i,22)).toISOString().slice(0,10),"SOLAR",1000+i*100))),coverage:units.map(u=>({unit_id:u.unit_id,sales_min:"2020-01-01"})),sync:units.map(u=>({unit_id:u.unit_id,last_run:"2026-07-24T07:00:00Z"}))});
 model.trend.months.forEach((m,i)=>m.label=`M${String(i).padStart(2,"0")}`);
 const doc=buildHarianDocDefinition({model,meta:{...META,unitsCount:7}});
 if(process.env.REPORT_PDF_REVIEW_OUT){
  const {writeFileSync}=await import("node:fs");
  writeFileSync(process.env.REPORT_PDF_REVIEW_OUT,await new Promise<Buffer>(resolve=>maker.createPdf(doc).getBuffer(resolve)));
 }
 const nodes=doc.content as unknown as Array<Record<string,unknown>>;
 const idx=nodes.findIndex(n=>JSON.stringify(n).includes("Penjualan 13 bulan terakhir"));
 expect(idx).toBeGreaterThanOrEqual(0);
 doc.content=[{canvas:[{type:"rect",x:0,y:0,w:1,h:400}]},...nodes.slice(idx,idx+(nodes[idx]!.stack?1:3))] as unknown as typeof doc.content;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const pages:any[]=await new Promise(resolve=>maker.createPdf(doc)._getPages({},resolve));
 const entries=pages.flatMap((p,pi)=>p.items.map((x:Record<string,unknown>)=>({pi,...x})));
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const lines=entries.filter((e:any)=>e.type==="line").map((e:any)=>({pi:e.pi,x:e.item.x,text:e.item.inlines.map((i:any)=>i.text).join("")}));
 const heading=lines.find(l=>l.text.includes("Penjualan 13 bulan terakhir"))!;
 const titles=lines.filter(l=>/^(Kumulatif per bulan|Rata-rata per hari)/.test(l.text));
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const plots=entries.filter((e:any)=>e.type==="vector"&&e.item.type==="rect"&&e.item.h===92&&e.item.w>300);
 expect(titles).toHaveLength(2);expect(plots).toHaveLength(2);
 for(const t of titles)expect(t.pi).toBe(heading.pi);
 for(const p of plots)expect(p.pi).toBe(heading.pi);
 const labels=lines.filter(l=>/^M\d{2}$/.test(l.text));expect(labels).toHaveLength(26);
 for(const pi of new Set(labels.map(l=>l.pi))){
  const onPage=labels.filter(l=>l.pi===pi);
  const first=onPage.filter(l=>l.text==="M00").map(l=>l.x).sort((a,b)=>a-b);
  const last=onPage.filter(l=>l.text==="M12").map(l=>l.x).sort((a,b)=>a-b);
  expect(last[0]!-first[0]!).toBeGreaterThan(300);
  expect(last[1]!-first[1]!).toBeGreaterThan(300);
 }
});
