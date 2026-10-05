import { renderToStaticMarkup } from "react-dom/server";
import { expect,it } from "vitest";
import { RankingTable,type RankRow } from "./RankingTable";
const row:RankRow={rank:1,code:"6478101",dotted:"64.781.01",name:"Adisucipto",omzet:"1",vol:"1",gl:"+0.45%",glAbnormal:false,glProvisional:true,rg:"—",rd:"—",inputTone:"success",inputLabel:"3/3 shift",products:[],sparkHeights:[],notes:[],laporanHref:"/"};
it("collapsed ranking visibly qualifies provisional values below the alarm threshold",()=>{
 const html=renderToStaticMarkup(<RankingTable rows={[row]}/>);
 expect(html).toContain("+0.45%");expect(html).toContain("SEMENTARA");
 expect(renderToStaticMarkup(<RankingTable rows={[{...row,glProvisional:false}]}/>)).not.toContain("SEMENTARA");
});

it("uses the incomplete qualifier rather than calling unavailable G/L final or zero",()=>{
 const html=renderToStaticMarkup(<RankingTable rows={[{...row,gl:"—",glStatus:"TIDAK LENGKAP"}]}/>);
 expect(html).toContain("TIDAK LENGKAP");expect(html).not.toContain("SEMENTARA");
});
