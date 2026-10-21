import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ocrAnnotatedDatasetSchema } from '../src/lib/contracts';

const baseUrl=process.env.NUTRISCAN_BASE_URL??'http://127.0.0.1:3400';
const origin=new URL(baseUrl);
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new Error('Adjudication acceptance only accepts a loopback origin.');
if(!(await fetch(`${origin.origin}/research/ocr-adjudication`,{signal:AbortSignal.timeout(5000)})).ok)throw new Error('The local adjudication route is unavailable.');

const image=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#f4f4f1"/><rect x="80" y="60" width="480" height="360" rx="12" fill="#fff" stroke="#718575" stroke-width="3"/><rect x="140" y="125" width="360" height="230" fill="#f9fbf8" stroke="#a9b7a6" stroke-width="2"/></svg>')).png().toBuffer();
const imageMeta={sha256:createHash('sha256').update(image).digest('hex'),width:640,height:480,byteLength:image.byteLength};
const source={url:'https://example.test/product',imageUrl:'https://example.test/image.png',publisher:'Synthetic browser acceptance',uploader:'Local test fixture',licenseId:'Synthetic only',licenseUrl:'https://example.test/license',retrievedAt:'2026-10-22',redistributionReview:'unknown' as const};
const regions=(prefix:string)=>[
  {regionId:`${prefix}-table`,role:'table',columnId:'per-100g',polygon:[[.12,.12],[.88,.12],[.88,.88],[.12,.88]]},
  {regionId:`${prefix}-energy-label`,role:'label',columnId:null,polygon:[[.2,.3],[.45,.3],[.45,.36],[.2,.36]]},
  {regionId:`${prefix}-energy-value`,role:'value',columnId:'per-100g',polygon:[[.55,.3],[.68,.3],[.68,.36],[.55,.36]]},
  {regionId:`${prefix}-energy-row`,role:'row',columnId:'per-100g',polygon:[[.18,.28],[.72,.28],[.72,.38],[.18,.38]]},
  {regionId:`${prefix}-energy-unit`,role:'unit',columnId:'per-100g',polygon:[[.68,.3],[.75,.3],[.75,.36],[.68,.36]]},
  {regionId:`${prefix}-basis`,role:'basis',columnId:'per-100g',polygon:[[.28,.18],[.7,.18],[.7,.24],[.28,.24]]},
  {regionId:`${prefix}-sodium-label`,role:'label',columnId:null,polygon:[[.2,.5],[.45,.5],[.45,.56],[.2,.56]]},
  {regionId:`${prefix}-sodium-value`,role:'value',columnId:'per-100g',polygon:[[.55,.5],[.68,.5],[.68,.56],[.55,.56]]},
  {regionId:`${prefix}-sodium-row`,role:'row',columnId:'per-100g',polygon:[[.18,.48],[.72,.48],[.72,.58],[.18,.58]]},
  {regionId:`${prefix}-sodium-unit`,role:'unit',columnId:'per-100g',polygon:[[.68,.5],[.75,.5],[.75,.56],[.68,.56]]}
];
const fields=(prefix:string,sodium:number)=>[
  {fieldId:`${prefix}-energy`,key:'energy',labelText:'Energy',printedNumericText:'380',numericValue:380,numericOperator:'eq',unit:'kcal',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'per 100 g',labelRegionId:`${prefix}-energy-label`,valueRegionId:`${prefix}-energy-value`,rowRegionId:`${prefix}-energy-row`,unitRegionId:`${prefix}-energy-unit`,basisRegionId:`${prefix}-basis`,columnId:'per-100g',status:'clear'},
  {fieldId:`${prefix}-sodium`,key:'sodium',labelText:'Sodium',printedNumericText:String(sodium),numericValue:sodium,numericOperator:'eq',unit:'mg',basis:{kind:'per-100g',amount:100,unit:'g'},basisText:'per 100 g',labelRegionId:`${prefix}-sodium-label`,valueRegionId:`${prefix}-sodium-value`,rowRegionId:`${prefix}-sodium-row`,unitRegionId:`${prefix}-sodium-unit`,basisRegionId:`${prefix}-basis`,columnId:'per-100g',status:'clear'}
];
function pass(annotatorCode:string,prefix:string,sodium:number){return {schemaVersion:1,annotatorCode,createdAt:'2026-10-22T08:00:00.000Z',record:{imageId:'synthetic-adjudication-image',productGroupId:'synthetic-adjudication-product',split:'not-assigned',image:imageMeta,source,annotations:{language:'en',tableRegions:regions(prefix),nutrients:fields(prefix,sodium),review:{annotatorCount:1,adjudicated:false,agreementMetric:null,referenceStatus:'single-reader',method:'Synthetic independent visual read for browser acceptance only.'}}}};}

const captureDir=path.resolve('docs/evidence/private/ocr-adjudication');
await mkdir(captureDir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const viewport=process.env.NUTRISCAN_ADJUDICATION_VIEWPORT==='mobile'?{width:390,height:844}:{width:1440,height:1000};
  const prefix=viewport.width<600?'mobile':'desktop';
  const context=await browser.newContext({viewport,acceptDownloads:true});
  const page=await context.newPage();
  const errors:string[]=[];const offOrigin:string[]=[];const postRequests:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.origin!=='null'&&url.origin!==origin.origin)offOrigin.push(url.origin);if(request.method()==='POST')postRequests.push(url.pathname);});
  await page.goto(`${origin.origin}/research/ocr-adjudication`,{waitUntil:'networkidle'});
  const intakeAxe=await new AxeBuilder({page}).analyze();
  await page.screenshot({path:path.join(captureDir,`${prefix}-01-intake.png`),fullPage:true});
  await page.getByLabel('Reader A annotation JSON').setInputFiles({name:'reader-a.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pass('reader-a','a',40)))});
  await page.getByLabel('Reader B annotation JSON').setInputFiles({name:'reader-b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pass('reader-b','b',45)))});
  await page.getByLabel('Original package photograph').setInputFiles({name:'synthetic-package.png',mimeType:'image/png',buffer:image});
  await page.getByText('All image fingerprints match.').waitFor({state:'visible'});
  await page.screenshot({path:path.join(captureDir,`${prefix}-02-matched-image.png`),fullPage:true});

  await page.getByRole('button',{name:'Add field decision'}).click();
  const first=page.getByTestId('adjudication-decision').nth(0);
  await first.getByLabel('Final field ID').fill('energy-100g');
  await first.getByLabel('Reader A source field').selectOption('a-energy');
  await first.getByLabel('Reader B source field').selectOption('b-energy');
  await first.getByLabel('Why this decision? (required)').fill('Both independent reads match the visible energy row and per-100 g column.');

  await page.getByRole('button',{name:'Add field decision'}).click();
  const second=page.getByTestId('adjudication-decision').nth(1);
  await second.getByLabel('Final field ID').fill('sodium-100g');
  await second.locator('select').nth(0).selectOption('ambiguous');
  await second.getByLabel('Reader A source field').selectOption('a-sodium');
  await second.getByLabel('Reader B source field').selectOption('b-sodium');
  await second.getByLabel('Region source').selectOption('reader-a');
  await second.getByLabel('Why this decision? (required)').fill('The two reads disagree on digits; no value is accepted without clearer evidence.');
  await page.getByLabel('Adjudicator code').fill('acceptance-adjudicator');
  await page.screenshot({path:path.join(captureDir,`${prefix}-03-decisions.png`),fullPage:true});
  const axe=await new AxeBuilder({page}).analyze();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Validate and export dataset'}).click();
  const download=await downloadPromise;
  const stream=await download.createReadStream();if(!stream)throw new Error('Dataset export download stream is unavailable.');
  const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));
  const dataset=ocrAnnotatedDatasetSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const record=dataset.records[0];const energy=record.annotations.nutrients.find(field=>field.fieldId==='energy-100g');const sodium=record.annotations.nutrients.find(field=>field.fieldId==='sodium-100g');
  const lineagePreserved=dataset.schemaVersion===2&&dataset.records.length===1&&record.image.sha256===imageMeta.sha256&&record.annotations.review.adjudicated&&record.annotations.review.referenceStatus==='human-verified'&&record.annotations.review.adjudication.sourcePasses.length===2&&record.annotations.review.adjudication.decisions.every(item=>item.readerAFieldId&&item.readerBFieldId);
  const conflictWithheld=!!sodium&&sodium.status==='ambiguous'&&sodium.printedNumericText===null&&sodium.numericValue===null&&sodium.unit===null&&sodium.basis===null;
  const explicitAgreement=!!energy&&energy.numericValue===380&&record.annotations.review.adjudication.decisions.some(item=>item.fieldId==='energy-100g'&&item.disposition==='reader-a');
  const privacyClean=!JSON.stringify(dataset).includes('reader-a.json')&&!JSON.stringify(dataset).includes('reader-b.json')&&!JSON.stringify(dataset).includes('synthetic-package.png');
  const result={intakeAxeViolations:intakeAxe.violations.map(item=>item.id),decisionAxeViolations:axe.violations.map(item=>item.id),lineagePreserved,conflictWithheld,explicitAgreement,privacyClean,offOriginRequests:[...new Set(offOrigin)],postRequests:[...new Set(postRequests)],pageErrors:errors};
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if(!lineagePreserved||!conflictWithheld||!explicitAgreement||!privacyClean||intakeAxe.violations.length||axe.violations.length||offOrigin.length||postRequests.length||errors.length)process.exitCode=1;
  await context.close();
}finally{await browser.close();}
