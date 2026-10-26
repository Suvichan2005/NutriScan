const {createRequire}=require('node:module');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const root=process.cwd();
const localRequire=createRequire(root+'/package.json');
async function main(){
 // esbuild is provided by the pinned tsx toolchain.
 const {build}=createRequire(localRequire.resolve('tsx/package.json'))('esbuild');
 const {chromium}=localRequire('@playwright/test');
 const built=await build({stdin:{contents:`import {readHistory,saveScan,removeSavedScan,clearHistory} from './src/lib/browser';import {parseLabel} from './src/lib/parser';const pkg=parseLabel('Synthetic concurrency fixture\\nNutrition information per 100 g\\nEnergy 380 kcal',{origin:'user'});window.historyApi={readHistory,saveScan,removeSavedScan,clearHistory,fixture:{id:pkg.id,name:pkg.name,createdAt:pkg.createdAt,package:pkg,portion:30,unit:'g'}};`,resolveDir:root,loader:'ts'},bundle:true,external:['fs','path'],write:false,platform:'browser',format:'iife',logLevel:'warning'});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?built.outputFiles[0].text:'<!doctype html><title>Isolated scan history acceptance</title><script src="/test.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port);
  const result=await page.evaluate(async()=>{
   const a=window.historyApi;const scan=id=>({...a.fixture,id,package:{...a.fixture.package,id}});
   await a.clearHistory();await Promise.all([a.saveScan(scan('first')),a.saveScan(scan('second'))]);
   const overlapping=(await a.readHistory()).map(s=>s.id);
   await a.clearHistory();await Promise.all([a.saveScan(scan('pending')),a.clearHistory()]);
   const afterClear=(await a.readHistory()).map(s=>s.id);
   await a.clearHistory();await a.saveScan(scan('existing'));
   await Promise.all([a.saveScan(scan('new')),a.removeSavedScan('existing')]);
   const afterRemove=(await a.readHistory()).map(s=>s.id);
   await a.clearHistory();await Promise.all(Array.from({length:25},(_,i)=>a.saveScan(scan('bounded-'+i))));
   const bounded=await a.readHistory();
   return {overlapping,afterClear,afterRemove,boundedCount:bounded.length,checks:{bothScansRetained:overlapping.includes('first')&&overlapping.includes('second'),clearWins:afterClear.length===0,removeRetainsOtherSave:afterRemove.length===1&&afterRemove[0]==='new',historyBounded:bounded.length===20}};
  });
  const otherPage=await context.newPage();await otherPage.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>window.historyApi.clearHistory());
  await Promise.all([page,otherPage].map((tab,index)=>tab.evaluate(index=>{const a=window.historyApi;const id='tab-'+index;return a.saveScan({...a.fixture,id,package:{...a.fixture.package,id}});},index)));
  const crossTab=await page.evaluate(async()=>{const rows=await window.historyApi.readHistory();return rows.map(row=>row.id);});
  result.crossTab=crossTab;result.checks.crossTabSavesRetained=crossTab.includes('tab-0')&&crossTab.includes('tab-1');
  const output=path.resolve(process.argv[2]||'.data/ideapad-restoration-20261026/scan-history.json');await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({scope:'Real Chromium IndexedDB; synthetic records in an isolated browser context; no provider or research accuracy claim',...result},null,2));console.log(JSON.stringify(result));
  await context.close();if(Object.values(result.checks).some(x=>!x))process.exitCode=1;
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
