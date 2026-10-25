import {it,expect,vi,afterEach} from 'vitest';
import {geminiToolDeclarations} from './gemini-tools';
import {selectAgentTools,toolAccessInput} from './gemini-tool-access';
import {assist,assistInput} from './gemini';
import {parseLabel} from '../parser';
import {resetGeminiUsageLedgerForTests} from './gemini-provider';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('keeps ingredient, condition guidance and detailed core sources accessible in ordinary mode',()=>{
 const ordinary=selectAgentTools(geminiToolDeclarations,true),full=selectAgentTools(geminiToolDeclarations,true,{mode:'specialized'});
 expect(ordinary.names).toHaveLength(12);expect(full.names).toHaveLength(20);expect(ordinary.schemaBytes).toBeLessThan(full.schemaBytes);
 expect(ordinary.names).toEqual(expect.arrayContaining(['get_nutrition_guidance','search_knowledge','get_guideline_pages','get_ingredient_concept','calculate_nutrition','get_product_record','get_food_composition_record']));
 expect(ordinary.names).not.toContain('search_jecfa');expect(full.names).toContain('search_jecfa');
 expect(selectAgentTools(geminiToolDeclarations,false).names).not.toContain('inspect_package_image');
});
it('permits an exact frozen research subset including no tools without silently broadening it',()=>{
 expect(selectAgentTools(geminiToolDeclarations,true,{mode:'research',names:[]}).names).toEqual([]);
 expect(selectAgentTools(geminiToolDeclarations,true,{mode:'research',names:['calculate_nutrition']}).names).toEqual(['calculate_nutrition']);
 expect(()=>selectAgentTools(geminiToolDeclarations,true,{mode:'research',names:['unknown_tool']})).toThrow('unavailable capability');
 for(const value of [{mode:'research'},{mode:'ordinary',names:[]},{mode:'specialized',names:['search_jecfa']},{mode:'research',names:['search_knowledge','search_knowledge']}])expect(toolAccessInput.safeParse(value).success).toBe(false);
});
it('rejects controlled research selection outside local development before provider work',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('ENABLE_GEMINI','true');const data=assistInput.parse({consent:true,question:'Developer subset',package:parseLabel('Developer'),toolAccess:{mode:'research',names:[]}});
 await expect(assist(data)).rejects.toMatchObject({code:'research_tools_local_only',status:403});
});
it('enforces tool eligibility at native execution and preserves explicit specialized access',async()=>{
 const packet=()=>{const pkg=parseLabel('Developer source investigation');pkg.reconstruction={identity:{name:null,brand:null,variant:null,status:'unreadable',evidence:{observationIds:[],imageRegions:[]}},serving:null,nutritionRows:[],ingredients:[],additives:[],statements:[],regions:[],unresolved:[],interpretationNote:'Developer fixture',revision:1,current:true,updatedAt:'2026-10-26T00:00:00Z',model:'developer-fixture'};return pkg;};
 const response=(parts:unknown[])=>new Response(JSON.stringify({candidates:[{content:{role:'model',parts},finishReason:'STOP'}],modelVersion:'gemini-3.8-flash-test',usageMetadata:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}}),{headers:{'content-type':'application/json'}});
 for(const mode of ['ordinary','specialized','research']as const){
  resetGeminiUsageLedgerForTests();vi.stubEnv('ENABLE_GEMINI','true');vi.stubEnv('GEMINI_PROVIDER','free');vi.stubEnv('GEMINI_MODEL','gemini-3.8-flash');vi.stubEnv('FREE_GEMINI_API_KEY','offline-test-placeholder');vi.stubEnv('ENABLE_GEMINI_SEARCH','false');vi.stubEnv('NODE_ENV','development');
  const bodies:Record<string,unknown>[]=[];let generations=0;
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   if(url.startsWith('https://generativelanguage.googleapis.com/')){
    bodies.push(JSON.parse(String(init?.body)));generations++;
    return generations===1?response([{functionCall:{id:'developer-source-call',name:'get_jecfa_record',args:{id:12}}}]):response([{text:'The investigation retained the available source evidence.'}]);
   }
   if(url==='https://apps.who.int/food-additives-contaminants-jecfa-database/Home/Chemical/12')return new Response('<h1>Developer source identity</h1><h4>Evaluation year: 2020</h4><div class="row"><div class="col-sm-2">Comments:</div><div class="col-sm-8">Developer source context.</div></div>',{headers:{'content-type':'text/html'}});
   throw Error('Unexpected network destination');
  });vi.stubGlobal('fetch',fetcher);
  const result=await assist(assistInput.parse({consent:true,question:'Developer source investigation',package:packet(),toolAccess:mode==='research'?{mode,names:[]}:{mode}}));
  expect(result.agentDiagnostics.toolAccess.mode).toBe(mode);expect(generations).toBe(2);
  expect(fetcher.mock.calls.filter(([input])=>String(input).includes('apps.who.int'))).toHaveLength(mode==='specialized'?1:0);
  expect(JSON.stringify(bodies[1])).toContain(mode==='specialized'?'Developer source context.':'tool_not_enabled');
  if(mode==='research')expect(bodies[0].tools).toBeUndefined();
 }
});
