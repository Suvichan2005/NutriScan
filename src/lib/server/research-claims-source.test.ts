import {afterEach,expect,it,vi} from 'vitest';
import {evidenceSources} from '../../modules/knowledge';
import {research} from './research';

afterEach(()=>vi.unstubAllGlobals());

it('retrieves a bounded dated FSSAI claims compendium excerpt for oat-fibre claims',async()=>{
 const sourceUrl='https://fssai.gov.in/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf';
 const fetcher=vi.fn(async(input:URL|string)=>{
  const url=String(input);
  return url===sourceUrl
   ?new Response(new Uint8Array([37,80,68,70,45,49,46,55,10]),{status:200,headers:{'content-type':'application/pdf'}})
   :new Response(`<html><body>${'Official FSSAI regulations index for food claims. '.repeat(8)}</body></html>`,{status:200,headers:{'content-type':'text/html'}});
 });
 vi.stubGlobal('fetch',fetcher);
 const extractor=vi.fn(async(_bytes:Uint8Array,limits:{pages:number;characters:number})=>({
  text:'Schedule III: Soluble Dietary Fibre and blood cholesterol. Soluble dietary fibre from food sources including oats contains at least 1 g per serving, with a daily intake statement of 3 g soluble dietary fibre. Beta-glucans from oats or barley are separately listed for reduction of the rise in blood glucose after that meal and have different conditions. '.repeat(2),
  pagesRead:13,totalPages:15,truncated:false,extraction:'selectable-text' as const,ocrPages:0,
 }));

 const result=await research({query:'oat beta glucan cholesterol claim',topic:'claims'},extractor);
 const compendium=result.items.find(item=>item.id==='fssai-advertising-claims-live-2022');
 expect(compendium?.id).not.toBe(evidenceSources.find(item=>item.id==='fssai-advertising-claims-compendium-2022')?.id);
 expect(result.status).toBe('ok');
 expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({hostname:'fssai.gov.in',pathname:'/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf'}),expect.objectContaining({method:'GET'}));
 expect(extractor).toHaveBeenCalledWith(expect.any(Uint8Array),expect.objectContaining({sourceId:'fssai-advertising-claims-live-2022',allowOcr:false,pages:20,characters:180_000}));
 expect(compendium).toMatchObject({id:'fssai-advertising-claims-live-2022',publisher:'Food Safety and Standards Authority of India',publishedAt:'2022-12-14',category:expect.stringContaining('dated FSSAI')});
 expect(compendium?.summary).toContain('1 g per serving');
 expect(compendium?.summary).toContain('Beta-glucans from oats or barley');
 expect(compendium?.limitations).toMatch(/not a consolidated current-law determination/i);
});
