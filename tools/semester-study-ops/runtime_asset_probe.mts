/** Read-only runtime-store probe. No source/model/provider downloads or inference. */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const worktree=process.cwd();
const index=process.argv.indexOf('--original-root');
if(index<0||!process.argv[index+1])throw Error('Use --original-root <read-only-original-checkout>');
const original=path.resolve(process.argv[index+1]);
if(original===worktree)throw Error('Probe requires distinct original evidence root');
const output=path.join(worktree,'.data/study-runtime-assets');await mkdir(output,{recursive:true});
const networkAttempts:string[]=[];
globalThis.fetch=(async input=>{networkAttempts.push(String(input).slice(0,200));throw Error('network-disabled-for-offline-probe');}) as typeof fetch;
for(const key of ['GEMINI_API_KEY','FREE_GEMINI_API_KEY','GOOGLE_API_KEY'])delete process.env[key];
process.env.ENABLE_GEMINI='false';process.env.ENABLE_PAID_GEMINI='false';process.env.ENABLE_PAID_GEMINI_FALLBACK='false';
// Existing readers resolve their configured local stores relative to cwd.
// They open databases read-only; no model execution or telemetry writer is invoked.
process.chdir(original);
const assets=[
 '.data/knowledge/foodon-records.sqlite',
 '.data/knowledge/guidelines.sqlite',
 '.data/food-composition/fdc-source-records.sqlite',
 '.data/food-composition/fdc-foundation-2026-04.catalog.json',
 '.data/food-composition/fdc-foundation-2026-04.records.jsonl',
 '.data/food-composition/fdc-fndds-2021-2023.catalog.json',
 '.data/food-composition/fdc-fndds-2021-2023.records.jsonl',
];
const hash=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex');
const inventory=[];
for(const relative of assets){const file=path.join(original,relative);inventory.push({path:relative,bytes:(await stat(file)).size,sha256:await hash(file)});}
const checks:Array<{name:string;observed:unknown;expected:unknown;passed:boolean}>=[];
const check=(name:string,observed:unknown,expected:unknown)=>checks.push({name,observed,expected,passed:JSON.stringify(observed)===JSON.stringify(expected)});
const {searchFoodOn,readFoodOnConcept}=await import('../../src/modules/knowledge/server');
const identity=await searchFoodOn('atta');check('foodon-search',identity.status,'ok');
if(identity.status==='ok')check('foodon-original-properties',(await readFoodOnConcept({id:identity.results[0].term.id,relation:'source'})).status,'ok');
check('foodon-unknown-id',(await readFoodOnConcept({id:'FOODON_99999999'})).status,'no_match');
const {searchGuidelines,readGuidelinePages}=await import('../../src/lib/server/guideline-documents');
const docs=await searchGuidelines({});check('who-catalog',docs.status,'ok');
if(docs.status==='ok'&&'catalog'in docs){check('who-three-selected-documents',docs.catalog?.length,3);const doc=docs.catalog?.[0];if(doc){const pages=await readGuidelinePages({documentId:doc.id,pages:[doc.recommendationPages[0]]});check('who-selected-page',pages.status,'ok');check('who-page-nonempty',pages.status==='ok'&&pages.pages.length===1&&pages.pages[0].text.length>0,true);}}
check('who-unknown-document',(await readGuidelinePages({documentId:'not-a-pinned-document',pages:[1]})).status,'no_document');
const {readFoodCompositionSource}=await import('../../src/lib/server/food-composition-records');
const catalog=JSON.parse(await readFile('.data/food-composition/fdc-foundation-2026-04.catalog.json','utf8'));
const id=catalog.foods[0].fdcId;
check('usda-exact-source-record',(await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:id,field:'foodNutrients',limit:1})).status,'ok');
check('usda-unknown-food',(await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:2147483647})).status,'no_match');
check('usda-missing-store',(await readFoodCompositionSource({release:'fdc-foundation-2026-04',fdcId:id},path.join(worktree,'.data/study-runtime-assets/intentionally-absent.sqlite'))).status,'unavailable');
const manifest=JSON.parse(await readFile(path.join(worktree,'data/semantic-model-manifest.json'),'utf8'));
for(const asset of manifest.files){const file=path.join(original,'.data/models',manifest.model,asset.file);check('pinned-model-hash:'+asset.file,await hash(file),asset.sha256);}
for(const asset of inventory)check('source-unchanged:'+asset.path,await hash(path.join(original,asset.path)),asset.sha256);
check('network-attempts',networkAttempts.length,0);
const receipt={scope:'offline-read-only-source-store-probe-not-gemini-use-or-clinical-validation',implementationCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:worktree,encoding:'utf8'}).trim(),readersFrom:'study-worktree',storesFrom:'original-read-only-checkout',checks,inventory,sourceCopies:0,providerCalls:0,modelInference:false,originalsUnchanged:checks.filter(c=>c.name.startsWith('source-unchanged:')).every(c=>c.passed),allPassed:checks.every(c=>c.passed)};
await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({allPassed:receipt.allPassed,checks:checks.length,failed:checks.filter(c=>!c.passed),bytes:inventory.reduce((n,a)=>n+a.bytes,0),providerCalls:0,sourceCopies:0},null,2));
if(!receipt.allPassed)process.exitCode=1;
