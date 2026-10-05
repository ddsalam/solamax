import { isValidElement, type ReactElement } from "react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({shift:vi.fn(async()=>({shifts:3,last_dtgljam:null}))}));
vi.mock("@/lib/scope",()=>({getDataScope:async()=>({units:[{unit_id:1,code:"6478111",name:"IB"}]})}));
vi.mock("@/lib/queries",()=>({getDailySalesByProduct:async()=>[],getUnitCoverage:async()=>[],getShiftInfo:mocks.shift}));
vi.mock("@/lib/anomalies",()=>({getAnomalies:async()=>[]}));
vi.mock("@/lib/gl-window",()=>({getDailyGlWindow:async()=>[]}));
vi.mock("@/lib/periods",async(importOriginal)=>({...await importOriginal<object>(),todayWib:()=>"2026-10-05"}));
import BoardPage from "@/app/(app)/board/page";
it("selected historical period queries input on its end date for the authorized unit",async()=>{
 const page=await BoardPage({searchParams:{p:"custom",from:"2026-10-01",to:"2026-10-04"}});
 function find(n:unknown):ReactElement<Record<string,unknown>>|undefined{
  if(Array.isArray(n))return n.map(find).find(Boolean);
  if(!isValidElement(n))return;
  const el=n as ReactElement<Record<string,unknown>>;
  if(typeof el.type==="function"&&el.type.name==="BoardBody")return el;
  return find(el.props.children);
 }
 const body=find(page)!;expect(body).toBeDefined();
 await (body.type as (props:Record<string,unknown>)=>Promise<unknown>)(body.props);
 expect(mocks.shift).toHaveBeenCalledWith(1,"2026-10-04");
});
