import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl=process.env.NUTRISCAN_BASE_URL??'http://127.0.0.1:3400';
const origin=new URL(baseUrl);
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw new Error('OCR annotation acceptance only accepts a loopback origin.');
if(!(await fetch(`${origin.origin}/research/ocr-annotation`,{signal:AbortSignal.timeout(5000)})).ok) throw new Error('The OCR annotation route is unavailable.');

const fixtureSvg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#f4f4f1"/><rect x="120" y="80" width="660" height="440" rx="18" fill="#fff" stroke="#90a090" stroke-width="4"/><rect x="180" y="150" width="540" height="280" fill="#f8faf7" stroke="#c8d3c3" stroke-width="2"/></svg>');
const imageBuffer=await sharp(fixtureSvg).png().toBuffer();
const captureDir=path.resolve('docs/evidence/private/ocr-annotation');
await mkdir(captureDir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const outcomes:Array<Record<string,unknown>>=[];

async function drawRegion(page:import('@playwright/test').Page,role:string,box:[number,number,number,number],columnId?:string) {
  await page.getByLabel('Region type').selectOption(role);
  await page.getByLabel('Column ID (optional)').fill(columnId??'');
  const surface=page.getByTestId('annotation-drawing-surface');
  await surface.scrollIntoViewIfNeeded();
  const bounds=await surface.boundingBox();
  if(!bounds)throw new Error('The local package image overlay is missing.');
  const [x0,y0,x1,y1]=box;
  await page.mouse.move(bounds.x+bounds.width*x0,bounds.y+bounds.height*y0);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*x1,bounds.y+bounds.height*y1,{steps:4});
  await page.mouse.up();
}

try{
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    const pageErrors:string[]=[];
    const nonLoopbackRequests:string[]=[];
    const postRequests:string[]=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('request',request=>{
      const requestUrl=new URL(request.url());
      if(requestUrl.origin!=='null'&&requestUrl.origin!==origin.origin)nonLoopbackRequests.push(requestUrl.origin);
      if(request.method()==='POST')postRequests.push(requestUrl.pathname);
    });
    const prefix=viewport.width===390?'mobile':'desktop';
    await page.goto(`${origin.origin}/research/ocr-annotation`,{waitUntil:'networkidle'});
    const candidateOptions=await page.getByLabel('Registered candidate (optional)').locator('option').allTextContents();
    const selectableCandidateIds=candidateOptions.map(option=>option.split('·').at(-1)?.trim()??'').filter(id=>id.startsWith('off-')).sort();
    const expectedCandidateIds=['off-0066721028426-nutrition-rev25','off-0718604978174-nutrition-rev14'].sort();
    const candidateEligibilityVerified=JSON.stringify(selectableCandidateIds)===JSON.stringify(expectedCandidateIds);
    if(!candidateEligibilityVerified)throw new Error(`Registered annotatable candidates do not match the unexposed set: ${selectableCandidateIds.join(',')}`);
    await page.getByLabel('Package photograph').setInputFiles({name:'synthetic-annotation-fixture.png',mimeType:'image/png',buffer:imageBuffer});
    await page.getByText(/SHA-256 [a-f0-9]{64}/i).waitFor({state:'visible'});
    const inputAxe=await new AxeBuilder({page}).analyze();
    await page.screenshot({path:path.join(captureDir,`${prefix}-annotation-intake.png`),fullPage:true});

    await page.getByLabel('Image ID').fill('acceptance-photo');
    await page.getByLabel('Product-group ID').fill('acceptance-product');
    await page.getByLabel('Annotator code').fill('acceptance-reader');
    await page.getByLabel('Product page URL').fill('https://example.test/product');
    await page.getByLabel('Exact source-image URL').fill('https://example.test/image.png');
    await page.getByLabel('Publisher').fill('Synthetic acceptance fixture');
    await page.getByLabel('Uploader attribution').fill('local browser test');
    await page.getByLabel('License description').fill('Synthetic test image');
    await page.getByLabel('License / guidance URL').fill('https://example.test/license');

    await drawRegion(page,'table',[.12,.12,.88,.88],'per-100g');
    await drawRegion(page,'label',[.2,.25,.44,.32]);
    await drawRegion(page,'value',[.55,.25,.68,.32]);
    await drawRegion(page,'row',[.18,.23,.73,.34]);
    await drawRegion(page,'unit',[.69,.25,.76,.32]);
    await drawRegion(page,'basis',[.28,.14,.62,.2]);
    await page.getByLabel('Field key').fill('energy');
    await page.getByLabel('Printed nutrient label').fill('Energy');
    await page.getByLabel('Printed numeric text').fill('380');
    await page.getByLabel('Normalized numeric value').fill('380');
    await page.getByLabel('Printed unit').fill('kcal');
    await page.getByLabel('Serving basis').selectOption('per-100g');
    await page.getByLabel('Exact printed basis text').fill('per 100 g');
    await page.getByLabel('Column ID', {exact:true}).last().fill('per-100g');
    await page.getByLabel('Label region').selectOption({label:'r2'});
    await page.getByLabel('Value region').selectOption({label:'r3'});
    await page.getByLabel('Row region').selectOption({label:'r4'});
    await page.getByLabel('Unit region').selectOption({label:'r5'});
    await page.getByLabel('Basis region').selectOption({label:'r6'});
    await page.getByRole('button',{name:'Add nutrient row'}).click();
    await page.getByText('Energy',{exact:true}).waitFor({state:'visible'});
    await page.getByLabel('Field key').fill('calories');
    await page.getByLabel('Printed nutrient label').fill('Calories');
    await page.getByLabel('Printed numeric text').fill('160');
    await page.getByLabel('Normalized numeric value').fill('160');
    await page.getByLabel('Printed unit').fill('');
    await page.getByLabel('Serving basis').selectOption('per-serving');
    await page.getByLabel('Basis amount').fill('35');
    await page.getByLabel('Basis unit').selectOption('g');
    await page.getByLabel('Exact printed basis text').fill('Per serving (35 g)');
    await page.getByLabel('Column ID', {exact:true}).last().fill('per-serving');
    await page.getByLabel('Label region').selectOption({label:'r2'});
    await page.getByLabel('Value region').selectOption({label:'r3'});
    await page.getByLabel('Row region').selectOption({label:'r4'});
    await page.getByLabel('Unit region').selectOption('');
    await page.getByLabel('Basis region').selectOption({label:'r6'});
    await page.getByRole('button',{name:'Add nutrient row'}).click();
    await page.getByText('Calories',{exact:true}).waitFor({state:'visible'});
    const annotatedAxe=await new AxeBuilder({page}).analyze();

    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export annotation JSON'}).click();
    const download=await downloadPromise;
    const downloadPath=path.join(captureDir,`${prefix}-annotation-pass.json`);
    await download.saveAs(downloadPath);
    const pass=JSON.parse(await (await import('node:fs/promises')).readFile(downloadPath,'utf8')) as {
      annotatorCode:string;record:{imageId:string;split:string;image:{sha256:string;width:number;height:number;byteLength:number};annotations:{nutrients:Array<{printedNumericText:string;numericValue:number;unit:string|null;unitRegionId:string|null;basis:{kind:string;amount:number|null;unit:string|null}}>;tableRegions:Array<{role:string;polygon:number[][]}>;review:{referenceStatus:string;annotatorCount:number;adjudicated:boolean}}}
    };
    const energyField=pass.record.annotations.nutrients[0];
    const caloriesField=pass.record.annotations.nutrients[1];
    const exportedPassValid=pass.annotatorCode==='acceptance-reader'&&pass.record.imageId==='acceptance-photo'&&pass.record.split==='not-assigned'&&pass.record.image.width===900&&pass.record.image.height===600&&pass.record.annotations.review.referenceStatus==='single-reader'&&pass.record.annotations.review.annotatorCount===1&&!pass.record.annotations.review.adjudicated&&pass.record.annotations.tableRegions.length===6&&pass.record.annotations.nutrients.length===2&&energyField?.printedNumericText==='380'&&energyField.numericValue===380&&energyField.unit==='kcal'&&energyField.unitRegionId==='r5'&&energyField.basis.kind==='per-100g'&&caloriesField?.printedNumericText==='160'&&caloriesField.numericValue===160&&caloriesField.unit===null&&caloriesField.unitRegionId===null&&caloriesField.basis.kind==='per-serving'&&!JSON.stringify(pass).includes('synthetic-annotation-fixture.png')&&!JSON.stringify(pass).includes('imageBytes');
    const violations=[...inputAxe.violations,...annotatedAxe.violations];
    const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    const outcome={viewport:`${viewport.width}x${viewport.height}`,syntheticImageOnly:true,selectableCandidateIds,exposedDevelopmentAndLowLegibilityPhotosExcluded:true,candidateEligibilityVerified,annotatedRegionCount:pass.record.annotations.tableRegions.length,exportedNutrientFieldCount:pass.record.annotations.nutrients.length,explicitUnitRoundTrip:energyField?.unit==='kcal'&&energyField.unitRegionId==='r5',absentUnitRoundTrip:caloriesField?.unit===null&&caloriesField.unitRegionId===null,exportedPassValid,horizontalOverflow,postRequests,nonLoopbackRequestOrigins:[...new Set(nonLoopbackRequests)],axeViolationIds:[...new Set(violations.map(item=>item.id))].sort(),axeViolationTargets:violations.flatMap(item=>item.nodes.map(node=>({id:item.id,target:node.target,summary:node.failureSummary}))),pageErrors};
    outcomes.push(outcome);console.log(JSON.stringify(outcome));
    await page.screenshot({path:path.join(captureDir,`${prefix}-annotation-exported.png`),fullPage:true});
    if(!exportedPassValid||horizontalOverflow||postRequests.length||nonLoopbackRequests.length||outcome.axeViolationIds.length||pageErrors.length)process.exitCode=1;
    await context.close();
  }
  const passed=outcomes.length===2&&outcomes.every(outcome=>outcome.candidateEligibilityVerified===true&&outcome.exportedPassValid===true&&outcome.horizontalOverflow===false&&Array.isArray(outcome.postRequests)&&outcome.postRequests.length===0&&Array.isArray(outcome.nonLoopbackRequestOrigins)&&outcome.nonLoopbackRequestOrigins.length===0&&Array.isArray(outcome.axeViolationIds)&&outcome.axeViolationIds.length===0&&Array.isArray(outcome.pageErrors)&&outcome.pageErrors.length===0);
  const receipt={schemaVersion:1,kind:'synthetic-local-ocr-annotation-tool-browser-acceptance',generatedAt:new Date().toISOString(),appOrigin:origin.origin,captureTool:'Playwright using installed Chrome',evaluationInput:'Generated synthetic image; interface and export contract only; no OCR accuracy evidence',imagesUploaded:false,providerCalls:0,outcomes,passed};
  await writeFile('docs/evidence/ocr-annotation-workflow-browser.json',`${JSON.stringify(receipt,null,2)}\n`);
  console.log(JSON.stringify({receipt:'docs/evidence/ocr-annotation-workflow-browser.json',passed}));
  if(!passed)process.exitCode=1;
}finally{await browser.close();}
