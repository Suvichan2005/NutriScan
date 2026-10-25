"""Bounded OFF India evaluation intake. No OCR, models, production edits or annotations.
Use acquire once; prepare/validate are offline. Images stay private and uninspected.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, io, json, re, sys, time, urllib.parse, urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'.data/evaluation-preparation'
PUBLIC=ROOT/'data/evaluation'
CATEGORIES=[('noodles','instant noodles'),('snacks','salty snacks'),('biscuits','biscuits'),('cereals','breakfast cereals'),('dairy','categories_tags:"en:milks"'),('beverages','fruit juice'),('staples-flour','wheat flour'),('pulses','lentils')]
FIELDS=['code','product_name','brands','categories_tags','countries_tags','images','last_modified_t','lang','lc']
LICENSE='https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/'
UA='NutriScan-Evaluation-Preparation/1.0 (bounded local research metadata and original image collection)'

def now():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def fetch(url,limit,payload=None):
 parsed=urllib.parse.urlparse(url)
 if parsed.scheme!='https' or parsed.hostname not in {'search.openfoodfacts.org','images.openfoodfacts.org'}:raise ValueError('Source URL outside official allowlist')
 req=urllib.request.Request(url,data=json.dumps(payload).encode() if payload else None,headers={'User-Agent':UA,**({'Content-Type':'application/json'} if payload else {})})
 with urllib.request.urlopen(req,timeout=35) as response:
  if urllib.parse.urlparse(response.url).hostname!=parsed.hostname:raise ValueError('Cross-host redirect refused')
  body=response.read(limit+1)
 if len(body)>limit:raise ValueError('Bounded response exceeded')
 return body

def barcode_path(code):
 return '/'.join([code[:3],code[3:6],code[6:9],code[9:]]) if len(code)>8 else code

def exposures():
 out={}
 for p in [ROOT/'data/ocr-photo-candidate-register.json',ROOT/'data/semantic-photo-manifest.json']:
  if not p.exists():continue
  j=read(p)
  for row in j.get('candidates',j.get('records',[])):
   code=row.get('code') or row.get('productGroupId','').removeprefix('gtin-')
   if row.get('researchSplit')=='development' or row.get('manualAnnotation') or row.get('status')=='exploratory-development-only':out[code]='Existing developer exposure: '+p.relative_to(ROOT).as_posix()
 return out

def view_metadata(product):
 images=product.get('images',{});chosen={};code=str(product['code'])
 for role in ['nutrition','ingredients','front']:
  keys=[k for k in images if k.startswith(role+'_')]
  keys.sort(key=lambda k:(not k.endswith('_en'),not k.endswith('_hi'),k))
  if not keys:continue
  selected_key=keys[0];selection=images[selected_key];image_id=str(selection.get('imgid',''))
  original=images.get(image_id,{})
  size=original.get('sizes',{}).get('full',{})
  if not image_id.isdigit() or not isinstance(size.get('w'),int) or not isinstance(size.get('h'),int):continue
  if image_id in chosen:chosen[image_id]['roles'].append(role);continue
  chosen[image_id]={'imageId':f'off-{code}-original-{image_id}','roles':[role],'sourceImageId':image_id,'sourceImageUrl':f'https://images.openfoodfacts.org/images/products/{barcode_path(code)}/{image_id}.jpg','selectedViewKey':selected_key,'selectedViewRevision':selection.get('rev'),'uploader':original.get('uploader'),'uploadedAtEpoch':original.get('uploaded_t'),'sourceDimensions':{'width':size['w'],'height':size['h']},'sourceMetadataLanguageTag':selected_key.rsplit('_',1)[-1],'printedLanguageHumanVerified':None,'sha256':None,'byteLength':None,'privateLocalFile':None,'acquisitionStatus':'metadata-only','licenseReview':'OFF contributor-image CC BY-SA guidance; embedded packaging rights pending; no redistribution clearance','licenseGuidanceUrl':LICENSE,'humanLayoutReview':{'nutritionLayout':None,'nutritionColumnCount':None,'servingBases':None,'curvature':None,'sideBySideRegions':None,'legibility':None}}
 return list(chosen.values())

def acquire():
 PUBLIC.mkdir(parents=True,exist_ok=True);PRIVATE.mkdir(parents=True,exist_ok=True)
 seen=set();products=[];searches=[];exposed=exposures()
 previous=read(PUBLIC/'india-collection.json') if (PUBLIC/'india-collection.json').exists() else {}
 if any(p.get('splitLocked') or p.get('referenceStatus')!='unannotated' for p in previous.get('products',[])):raise ValueError('Do not rebuild a locked or annotated collection; create a reviewed new version')
 prior_images={image['imageId']:image for product in previous.get('products',[]) for image in product['images']}
 for category,phrase in CATEGORIES:
  cache=PRIVATE/'raw-searches'/f'{category}-milks.json' if category=='dairy' else PRIVATE/'raw-searches'/f'{category}.json'
  query=f'{phrase} countries_tags:"en:india"'
  if cache.exists():j=read(cache)
  else:
   payload={'q':query,'page_size':25,'fields':FIELDS,'langs':['en']}
   started=now();body=fetch('https://search.openfoodfacts.org/search',3_000_000,payload);response=json.loads(body)
   j={'retrievedAt':started,'request':payload,'responseSha256':hashlib.sha256(body).hexdigest(),'response':response};write(cache,j);time.sleep(7)
  hits=j['response'].get('hits',[]);selected=0
  for product in hits:
   code=str(product.get('code',''));name=product.get('product_name')
   if not re.fullmatch(r'\d{8,14}',code) or not name or code in seen or 'en:india' not in product.get('countries_tags',[]):continue
   views=view_metadata(product)
   for view in views:
    old=prior_images.get(view['imageId'],{})
    if old.get('sourceImageUrl')==view['sourceImageUrl']:
     for key in ['sha256','byteLength','privateLocalFile','acquisitionStatus','acquisitionErrorClass','actualDimensions','downloadedAt']:
      if key in old:view[key]=old[key]
   if not any('nutrition' in v['roles'] for v in views):continue
   # Metadata language tags do not prove the actual printed language.
   known=exposed.get(code)
   brand_text=' '.join(product.get('brands',[])) if isinstance(product.get('brands'),list) else str(product.get('brands',''))
   if re.search(r'\b(bisk\s*farm|bagrry|saffola|maggi|amul)\b',name+' '+brand_text,re.I):known='Known development product-family name; conservative exposure exclusion pending manual group review'
   family=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
   seed=int(hashlib.sha256(('nutriscan-india-eval-v1:'+family).encode()).hexdigest()[:8],16)%10
   proposed='development' if known or seed<4 else 'calibration' if seed<6 else 'held-out'
   products.append({'productId':'off-'+code,'identifierValidation':'OFF numeric product code; grouping identifier, not independently authenticated GTIN','productGroupId':'gtin-'+code,'familyGroupId':'family-'+family,'familyReview':'pending; variants, regional revisions and related GTINs must be manually grouped before lock','productName':name,'brands':product.get('brands',[]),'marketEvidence':{'countriesTags':product.get('countries_tags',[]),'status':'OFF India market tag; actual Indian formulation must be human confirmed'},'categoryStratum':category,'sourceCategories':product.get('categories_tags',[]),'sourceProductUrl':f'https://world.openfoodfacts.org/product/{code}','retrievedAt':j['retrievedAt'],'sourceLastModifiedEpoch':product.get('last_modified_t'),'metadataSource':cache.relative_to(ROOT).as_posix(),'databaseLicense':'ODbL; individual contents DbCL; image rights separately reviewed','licenseGuidanceUrl':LICENSE,'rightsReviewed':False,'marketHumanReviewed':False,'proposedSplit':proposed,'splitLocked':False,'exposureStatus':'development-exposed' if known else 'metadata-only-not-model-exposed','exposureNote':known or 'No OCR/model or visual content inspection performed by this intake; prior external exposure cannot be proven absent','images':views,'referenceStatus':'unannotated','independentReaderCount':0})
   seen.add(code);selected+=1
   if selected==5:break
  searches.append({'category':category,'query':query,'hitsReturned':len(hits),'selectedProducts':selected,'cache':cache.relative_to(ROOT).as_posix(),'cacheSha256':hashlib.sha256(cache.read_bytes()).hexdigest()})
 # Allocation is a deterministic proposal only. Known exposed families stay development.
 eligible=sorted({p['familyGroupId'] for p in products if p['exposureStatus']!='development-exposed'},key=lambda family:hashlib.sha256(('nutriscan-india-split-v2:'+family).encode()).hexdigest())
 dev_end=int(len(eligible)*.30);cal_end=dev_end+int(len(eligible)*.20)
 assigned={family:('development' if i<dev_end else 'calibration' if i<cal_end else 'held-out') for i,family in enumerate(eligible)}
 for product in products:product['proposedSplit']='development' if product['exposureStatus']=='development-exposed' else assigned[product['familyGroupId']]
 manifest={'schemaVersion':1,'collectionId':'india-packages-preparation-20261025','generatedAt':now(),'targetProducts':[30,50],'status':'candidate-intake-not-independent-evaluation','selectionMethod':'Five metadata-eligible distinct GTINs from each of eight predeclared text/category strata; public community catalog convenience sample, not representative sampling. Max 25 results/stratum; one request per stratum; cached replay offline.','rightsPolicy':'Original photos local only. OFF image-license guidance recorded, image-specific/embedded-rights and quality checks pending. No images redistributed or passed to a model.','splitProposalMethod':'Seed nutriscan-india-split-v2; sort unexposed family hashes and allocate floor(30%) development, floor(20%) calibration, remainder prospective held-out. Known-exposed families forced development. Family/stratum human review required; not representative stratified random sampling.', 'splitStatus':'proposed-only; no test freeze or held-out evaluation allowed yet','searches':searches,'products':products,'limitations':['Database product names, market tags and language tags are discovery metadata, not reference labels.','Product families, image sufficiency, actual Indian market/language and rights need human review.','Independent human annotations and adjudication are absent.','No field accuracy, extraction quality or held-out result is claimed.']}
 if previous.get('imageAcquisition'):manifest['imageAcquisition']=previous['imageAcquisition']
 validate(manifest);write(PUBLIC/'india-collection.json',manifest);print_summary(manifest)

def validate(m):
 assert m['schemaVersion']==1
 for search in m.get('searches',[]):
  if search.get('cacheSha256'):assert hashlib.sha256((ROOT/search['cache']).read_bytes()).hexdigest()==search['cacheSha256'],'Cached source metadata changed'
 seen=set();families={}
 for p in m['products']:
  assert p['productGroupId'] not in seen,'Duplicate product group'
  seen.add(p['productGroupId']);assert p['proposedSplit'] in {'development','calibration','held-out'}
  assert families.setdefault(p['familyGroupId'],p['proposedSplit'])==p['proposedSplit'],'Product family crosses splits'
  assert not p['splitLocked'],'Preparation script cannot declare frozen independent splits'
  assert p['referenceStatus']=='unannotated' and p['independentReaderCount']==0
  if p['exposureStatus']=='development-exposed':assert p['proposedSplit']=='development','Exposed product cannot become held out'
  for image in p['images']:
   assert image['sourceImageUrl'].startswith('https://images.openfoodfacts.org/images/products/')
   if image['acquisitionStatus']=='downloaded':
    private=ROOT/image['privateLocalFile'];assert private.resolve().is_relative_to(PRIVATE.resolve());assert hashlib.sha256(private.read_bytes()).hexdigest()==image['sha256']
 return True

def download():
 from PIL import Image
 path=PUBLIC/'india-collection.json';m=read(path);budget=70_000_000;used=0;failures=[]
 jobs=[(p,i) for p in m['products'] for i in p['images']];tls_failures=0
 # Sequential bounded transfers, originals never opened in a UI or read by OCR/model.
 for product,image in jobs:
  if image['acquisitionStatus']=='downloaded':used+=image['byteLength'];continue
  if used>=budget:failures.append({'imageId':image['imageId'],'reason':'70 MB collection byte budget reached'});continue
  try:
   body=fetch(image['sourceImageUrl'],4_000_000)
   if used+len(body)>budget:raise ValueError('Collection byte budget would be exceeded')
   with Image.open(io.BytesIO(body)) as original:width,height=original.size
   private=PRIVATE/'images'/product['productId']/(image['sourceImageId']+'.jpg');private.parent.mkdir(parents=True,exist_ok=True);private.write_bytes(body)
   image.update(sha256=hashlib.sha256(body).hexdigest(),byteLength=len(body),privateLocalFile=private.relative_to(ROOT).as_posix(),actualDimensions={'width':width,'height':height},acquisitionStatus='downloaded',downloadedAt=now());used+=len(body)
  except Exception as error:
   failures.append({'imageId':image['imageId'],'reason':type(error).__name__+': '+str(error)})
   if 'CERTIFICATE_VERIFY_FAILED' in str(error):
    tls_failures+=1
    if tls_failures>=3:break
  write(path,m)
 m['imageAcquisition']={'downloadedAt':now(),'byteBudget':budget,'downloadedBytes':used,'failures':failures,'pixelInspection':'No visual inspection, OCR or model use. PIL reads header dimensions only.','status':'blocked-source-tls' if tls_failures>=3 else 'partial' if failures else 'complete','tlsFailureCount':tls_failures};validate(m);write(path,m);print_summary(m)

def prepare():
 m=read(PUBLIC/'india-collection.json');validate(m)
 batches=[]
 for split in ['development','calibration','held-out']:
  products=[p for p in m['products'] if p['proposedSplit']==split]
  for index in range(0,len(products),5):
   subset=products[index:index+5];tasks=[]
   for p in subset:
    for image in p['images']:
     tasks.append({'taskId':image['imageId'],'productGroupId':p['productGroupId'],'proposedSplit':split,'annotationRoute':'/research/ocr-annotation','existingSchemaSplit':'development' if split=='development' else 'not-assigned','imageSha256':image['sha256'],'imageDimensions':image.get('actualDimensions',image['sourceDimensions']),'privateLocalFile':image['privateLocalFile'],'readiness':'ready-for-independent-visual-annotation' if image['acquisitionStatus']=='downloaded' else 'blocked-image-acquisition','imageRightsReview':'pending; local research copy only','readerAssignments':['reader-a','reader-b'],'blinding':'Do not open OFF product metadata, OCR, model answers, nutrient arithmetic or the other reader pass. Transcribe pixels only.','nutritionPassSchema':'data/ocr-annotation-pass.schema.json','supplementaryPassSchema':'data/evaluation/package-text-pass.schema.json','referenceStatus':'unannotated'})
   batch={'schemaVersion':1,'batchId':f'india-{split}-{index//5+1:02d}','proposedSplit':split,'splitLocked':False,'products':len(subset),'tasks':tasks}
   target=PRIVATE/'annotation-batches'/(batch['batchId']+'.json');write(target,batch);batches.append({'batchId':batch['batchId'],'proposedSplit':split,'products':len(subset),'images':len(tasks),'privateManifest':target.relative_to(ROOT).as_posix(),'status':'unannotated'})
 existing_path=PRIVATE/'annotation-batches/existing-development-01.json';existing=read(existing_path) if existing_path.exists() else {}
 write(PUBLIC/'annotation-batches.json',{'existingDevelopmentBatch':{'privateManifest':'.data/evaluation-preparation/annotation-batches/existing-development-01.json','productGroups':existing.get('products',0),'verifiedOriginalPhotos':len(existing.get('tasks',[])),'referenceStatus':'unannotated','purpose':'First blind development annotation batch; 6 prior-source hash matches and 2 current owner-file baselines'},'schemaVersion':1,'generatedAt':now(),'batches':batches,'independentAnnotations':0,'blockers':['Two independent human readers and adjudicator required.','Image-specific rights, India-market/language/legibility and family-group review before split lock.','Held-out annotation and pilot calibration must remain isolated from engine tuning.']})
 print(json.dumps({'batches':len(batches),'products':len(m['products']),'images':sum(b['images'] for b in batches),'annotationRoot':str(PRIVATE/'annotation-batches')}))


def prepare_existing():
 from PIL import Image
 registry=read(ROOT/'data/ocr-photo-candidate-register.json')['candidates']
 semantic=read(ROOT/'data/semantic-photo-manifest.json')['records']
 known=[]
 for code in ['8902710100150','8901088068758']:
  record=next(r for r in semantic if r.get('code')==code)
  known.append({'productGroupId':'gtin-'+code,'file':'docs/evidence/private/'+record['file'],'sourceImageUrl':record['url'],'uploader':record.get('uploader'),'expectedSha256':record['hash'],'sourceEvidence':'data/semantic-photo-manifest.json'})
 for record in registry:
  if record['productGroupId']=='gtin-8901262202046':known.append({'productGroupId':record['productGroupId'],'file':record['privateLocalFile'],'sourceImageUrl':record['sourceImageUrl'],'uploader':record.get('uploader'),'expectedSha256':record['image']['sha256'],'sourceEvidence':'data/ocr-photo-candidate-register.json'})
 maggi=read(ROOT/'docs/evidence/india-maggi-multi-photo-flow.json')['sourcePhotos']
 maggi_nutrition=read(ROOT/'docs/evidence/india-maggi-noodles-photo-flow.json')['source']
 for record in maggi:
  suffix='nutrition-en-r13' if record['key']=='nutrition' else 'ingredients-en-r19'
  known.append({'productGroupId':'gtin-8901058022193','file':'.data/indian-hindi-label-probe/maggi-noodles-'+suffix+'.jpg','sourceImageUrl':record['url'],'uploader':maggi_nutrition.get('uploader') if record['key']=='nutrition' and record['url']==maggi_nutrition['photoUrl'] and record['sha256']==maggi_nutrition['imageSha256'] else None,'expectedSha256':record['sha256'],'sourceEvidence':['docs/evidence/india-maggi-multi-photo-flow.json','docs/evidence/india-maggi-noodles-photo-flow.json']})
 for filename in ['shopping (1).webp','shopping.webp']:
  known.append({'productGroupId':'owner-bisk-cream-cracker-development','file':str(Path.home()/'Downloads'/filename),'sourceImageUrl':None,'uploader':None,'expectedSha256':None,'sourceEvidence':'Owner supplied original paths; existing development pilot uses these images'})
 tasks=[];missing=[]
 for index,record in enumerate(known):
  file=ROOT/record['file']
  if not file.exists():missing.append({'group':record['productGroupId'],'file':record['file'],'reason':'local source missing'});continue
  body=file.read_bytes();digest=hashlib.sha256(body).hexdigest()
  if record['expectedSha256'] and digest!=record['expectedSha256']:raise ValueError('Existing source hash mismatch: '+record['file'])
  with Image.open(file) as image:width,height=image.size
  tasks.append({'taskId':'existing-dev-'+str(index+1),'imageId':'existing-dev-'+digest[:16],'productGroupId':record['productGroupId'],'proposedSplit':'development','existingSchemaSplit':'development','splitLocked':False,'privateLocalFile':record['file'],'imageSha256':digest,'hashVerification':'compared-with-existing-source-receipt' if record['expectedSha256'] else 'current-owner-file-baseline-no-prior-hash','byteLength':len(body),'imageDimensions':{'width':width,'height':height},'sourceImageUrl':record['sourceImageUrl'],'uploader':record['uploader'],'sourceEvidence':record['sourceEvidence'],'rightsStatus':'private development only; no redistribution clearance','readiness':'ready-for-independent-visual-annotation','readerAssignments':['reader-a','reader-b'],'annotationRoute':'/research/ocr-annotation','nutritionPassSchema':'data/ocr-annotation-pass.schema.json','supplementaryPassSchema':'data/evaluation/package-text-pass.schema.json','blinding':'Original pixels only. Do not open source record, developer annotations, OCR, model answers, arithmetic or the other reader pass.','referenceStatus':'unannotated'})
 batch={'schemaVersion':1,'batchId':'existing-development-01','generatedAt':now(),'products':len({t['productGroupId'] for t in tasks}),'tasks':tasks,'missing':missing,'status':'ready-for-independent-human-annotation; development only','independentAnnotations':0}
 target=PRIVATE/'annotation-batches/existing-development-01.json';write(target,batch)
 print(json.dumps({'existingProductGroups':batch['products'],'verifiedOriginalPhotos':len(tasks),'missing':len(missing),'batch':str(target)}))

def print_summary(m):print(json.dumps({'products':len(m['products']),'categories':dict(Counter(p['categoryStratum'] for p in m['products'])),'proposedSplits':dict(Counter(p['proposedSplit'] for p in m['products'])),'images':sum(len(p['images']) for p in m['products']),'downloadedImages':sum(i['acquisitionStatus']=='downloaded' for p in m['products'] for i in p['images']),'independentAnnotations':0}))

def self_test():
 minimal={'schemaVersion':1,'products':[{'productGroupId':'gtin-1','familyGroupId':'family-a','proposedSplit':'held-out','splitLocked':False,'referenceStatus':'unannotated','independentReaderCount':0,'exposureStatus':'development-exposed','images':[]}]}
 try:validate(minimal)
 except AssertionError:pass
 else:raise AssertionError('Exposure leak accepted')
 minimal['products'][0]['exposureStatus']='metadata-only-not-model-exposed';minimal['products'].append({**minimal['products'][0],'productGroupId':'gtin-2','proposedSplit':'calibration'})
 try:validate(minimal)
 except AssertionError:pass
 else:raise AssertionError('Family split leak accepted')
 from jsonschema import Draft202012Validator,ValidationError
 schema=read(PUBLIC/'package-text-pass.schema.json');Draft202012Validator.check_schema(schema)
 # Structural fixture only, never saved as a human annotation or used for accuracy.
 fixture={'schemaVersion':1,'annotatorCode':'synthetic-contract-test','createdAt':'2026-10-25T00:00:00Z','imageId':'synthetic-test','productGroupId':'synthetic-test','imageSha256':'0'*64,'referenceStatus':'single-reader-unadjudicated','method':'independent-human-visual','sectionCoverage':{key:'not-visible' for key in schema['properties']['sectionCoverage']['required']},'items':[]}
 validator=Draft202012Validator(schema);validator.validate(fixture)
 for bad in [{**fixture,'referenceStatus':'human-verified'},{**fixture,'method':'model-generated'},{**fixture,'imageSha256':'missing'},{**fixture,'items':[{'itemId':'x','category':'claims','status':'clear','literalText':'','regionPolygons':[],'order':0}]}]:
  try:validator.validate(bad)
  except ValidationError:pass
  else:raise AssertionError('Invalid supplementary pass accepted')
 print('PASS: exposed-held-out/family leaks and invalid status, method, hash, clear-region claims rejected; no labels generated')

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['acquire','download','prepare','validate','self-test','prepare-existing']);args=parser.parse_args()
 if args.command=='acquire':acquire()
 elif args.command=='download':download()
 elif args.command=='prepare':prepare()
 elif args.command=='prepare-existing':prepare_existing()
 elif args.command=='validate':m=read(PUBLIC/'india-collection.json');validate(m);print_summary(m)
 else:self_test()
