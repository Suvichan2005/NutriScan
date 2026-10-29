"""Assemble actual acquired photos and blank assignments using existing study contracts.
Preparation only: does not generate labels, approve splits or call any model.
"""
import argparse,csv,hashlib,json,shutil,sys
from collections import Counter,defaultdict
from pathlib import Path
from PIL import Image
import custodian_intake
import study_ops as ops
ROOT=Path(__file__).resolve().parents[2]

def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def brand_text(p):
    value=p.get('brands') or p['familyGroupId']
    return ','.join(value) if isinstance(value,list) else value

def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists():
        if load(p)==v:return
        raise ValueError('Existing artifact differs; use a new version: '+str(p))
    with p.open('x',encoding='utf8')as f:json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')

def family_brand_blocks(products):
    parents=list(range(len(products)))
    def find(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    seen={}
    for i,p in enumerate(products):
        brands=[b.strip().casefold() for b in brand_text(p).split(',') if b.strip()]
        for key in ['brand:'+b for b in brands]+['family:'+p['familyGroupId']]:
            if key in seen:parents[find(i)]=find(seen[key])
            else:seen[key]=i
    grouped=defaultdict(list)
    for i,p in enumerate(products):grouped[find(i)].append(p)
    blocks={}
    for products in grouped.values():
        identity='|'.join(sorted(p['productGroupId'] for p in products))
        blocks['family-brand-block-'+hashlib.sha256(identity.encode()).hexdigest()[:12]]=products
    return blocks

def prepare(dataset,output,legacy):
    dataset=dataset.resolve();output=output.resolve()
    if output.exists():raise ValueError('New version required; do not overwrite prepared evidence')
    raw=dataset/'collection-manifest.json';collection=load(raw);catalog=load(ROOT/'data/evaluation/india-collection.json');old={p['productGroupId']:p for p in catalog['products']}
    # Conservative brand-level blocking. A human must validate actual family links and exposure.
    blocks=family_brand_blocks(collection['products'])
    hashes=defaultdict(list);total=0;reused=0
    for block,products in blocks.items():
        exposed=any(p.get('exposureStatus')=='development-exposed' for p in products) or any(word in brand_text(p).casefold() for p in products for word in load(ROOT/'data/evaluation/benchmark-protocol-v1.json')['dataset']['knownDevelopmentBrands']['brands'])
        proposals={old[p['productGroupId']]['proposedSplit'] for p in products}
        split='development' if exposed or 'development' in proposals else 'calibration' if 'calibration' in proposals else 'prospective-held-out'
        for p in products:
            p['metadataFamilyGroupId']=p['familyGroupId'];p['familyGroupId']=block;p['proposedSplit']=split;p['splitLocked']=False;p['familyReviewComplete']=False
            p['priorExposureReview']='known-development-family' if exposed else 'metadata-only collection; historical developer/model exposure requires human verification'
            if exposed:p['exposureStatus']='development-exposed'
            for im in p['images']:
                file=ops.local(dataset,im['privateLocalFile']);assert ops.sha(file)==im['sha256'] and file.stat().st_size==im['byteLength'],'Original integrity mismatch'
                with Image.open(file)as image:
                    im['actualDimensions']={'width':image.width,'height':image.height};im['format']=image.format
                    im['hasGpsExif']=bool(image.getexif().get(34853));image.verify()
                im['semanticPixelsInspected']=False;im['license']='CC-BY-SA-3.0 source declaration; embedded rights pending'
                hashes[im['sha256']].append(p['productGroupId']);total+=im['byteLength'];reused+=im['acquisitionStatus']=='reused-hash-verified-original'
    duplicates={k:sorted(set(v)) for k,v in hashes.items() if len(set(v))>1}
    if duplicates:raise ValueError('Cross-group image duplicates require reconciliation: '+json.dumps(duplicates))
    output.mkdir(parents=True)
    batches=[];alltasks=[];adjudication=[]
    for start in range(0,len(collection['products']),5):
        products=collection['products'][start:start+5];ident=f'independent-candidates-{start//5+1:02d}';tasks=[]
        for p in products:
            for im in p['images']:
                task={'taskId':im['imageId'],'imageId':im['imageId'],'productGroupId':p['productGroupId'],'imageSha256':im['sha256'],'privateLocalFile':im['privateLocalFile'],'dimensions':im['actualDimensions'],'referenceStatus':'unannotated','assignedReaderCode':None,'completionState':'AWAITING_HUMAN','annotationRoute':'/research/ocr-annotation','nutritionPassSchema':'data/ocr-annotation-pass.schema.json','supplementaryPassSchema':'data/evaluation/package-text-pass.schema.json','tableStructureSidecar':'Optional explicit cells with row_nums, column_nums, cell_text, bbox; transcribe blank/spanning cells; no inferred grid','blinding':'Original photographs only; no catalog nutrient data, OCR/model output, other reader passes or response condition keys. Do not infer unreadable digits by arithmetic.'}
                tasks.append(task);alltasks.append(task);adjudication.append({'taskId':task['taskId'],'imageSha256':im['sha256'],'status':'BLOCKED_TWO_INDEPENDENT_PASSES','adjudicatorCode':None,'decisions':None})
        for reader in ['reader-a','reader-b']:write(dataset/'annotation-batches'/reader/(ident+'.json'),{'kind':'assignments-not-annotations','readerSlot':reader,'actualAnnotatorCode':None,'tasks':tasks})
        batches.append({'batchId':ident,'products':len(products),'images':len(tasks),'readerAManifest':f'annotation-batches/reader-a/{ident}.json','readerBManifest':f'annotation-batches/reader-b/{ident}.json'})
    write(dataset/'annotation-batches/adjudicator/queue.json',{'kind':'pending-adjudication-not-labels','tasks':adjudication})
    index={'products':len(collection['products']),'images':len(alltasks),'nutritionPassAssignments':len(alltasks)*2,'supplementPassAssignments':len(alltasks)*2,'independentHumanAnnotations':0,'batches':batches}
    write(dataset/'annotation-batches/index.json',index);collection['annotationPreparation']={'index':'annotation-batches/index.json'}
    collection['sourceAcquisitionManifestSha256']=ops.sha(raw);collection['status']='PREPARED_CANDIDATES_NOT_APPROVED_OR_ANNOTATED'
    derived=dataset/(output.name+'-collection.json')
    write(derived,collection)
    intake=custodian_intake.prepare(dataset,output/'custodian',derived)
    with (output/'product-readiness.csv').open('x',encoding='utf8',newline='')as f:
        w=csv.writer(f);w.writerow(['productGroupId','metadataName','stratum','familySplitBlock','proposedSplit','photos','rights','IndiaVariant','layoutBasesAllergensClaims','readerA','readerB','adjudication','splitLock'])
        for p in collection['products']:w.writerow([p['productGroupId'],p['productName'],p['categoryStratum'],p['familyGroupId'],p['proposedSplit'],len(p['images'])]+['PENDING']*7)
    # Existing runner-compatible manifest: deliberately cannot pass independent final gates.
    cases=[{'caseId':p['productGroupId'],'productGroupId':p['productGroupId'],'familyGroupId':p['familyGroupId'],'split':p['proposedSplit'],'exposureStatus':p['exposureStatus'],'rightsReviewed':False,'referenceStatus':'unannotated','referenceFile':None,'referenceSha256':None,'referenceGrade':None,'inputFiles':[{'path':str((dataset/i['privateLocalFile']).relative_to(ROOT)).replace('\\','/'),'sha256':i['sha256'],'imageId':i['imageId']} for i in p['images']]} for p in collection['products']]
    write(output/'reconstruction-cases.json',{'schemaVersion':1,'splitLock':'proposed-not-locked','cases':cases,'imageSelection':'Same frozen original set for all A-E arms; no hidden recovery, corrections or catalog answer fields'})
    # Exact original nine conversations, questions unchanged; context provenance is explicitly candidate-grade.
    conversations=load(ROOT/'data/evaluation/semester-conversations.json');contexts={}
    for code in 'MBA':
        source=legacy/'.data/semester-conversation-pilot-20261026'/f'{code}-snapshot.json';target=output/'conversation-contexts'/source.name;target.parent.mkdir(exist_ok=True);shutil.copyfile(source,target)
        assert ops.sha(target)==ops.sha(source)
        contexts[code]={'path':str(target.relative_to(ROOT)).replace('\\','/'),'sha256':ops.sha(target),'referenceGrade':3,'verification':'historical exposed model-assisted reconstruction; not independently transcribed; exact variant/declarations pending visual reference','liveSchemaValidation':'PENDING separate offline check'}
    for c in conversations['conversations']:
        c['packageSnapshot']=contexts[c['id'][0]];c['packageFactsStatus']='grade-3-candidate-context-not-human-verified'
        for t in c['turns']:
            assert hashlib.sha256(t['userText'].encode()).hexdigest()==t['sourceTextSha256'],'Original question changed'
    conversations['status']='QUESTION_PROTOCOL_HASH_FROZEN_CONTEXT_CANDIDATE_EXECUTION_BLOCKED';conversations['originalDefinitionSha256']=ops.sha(ROOT/'data/evaluation/semester-conversations.json');write(output/'canonical-conversations.json',conversations)
    text='''# Independent annotation packet\n\nThese are genuine acquired originals, not ground-truth labels. No model/OCR has read this new collection during preparation. Metadata-only dimension decoding is recorded. Previous exposure still requires review.\n\n1. Custodian: use product-readiness.csv and custodian/groups/*.md to check image rights/embedded artwork, exact India formulation, variant/revision, family overlap, exposure, complete package coverage and proposed split. Approve none merely because files exist.\n2. Assign distinct actual reader codes to reader-a and reader-b. Open original photos using the existing /research/ocr-annotation interface (Custom/other source). Use the pinned nutrition and text-pass contracts. Export immutable passes separately. Never show catalog nutrients/OCR/AI answers or the other reader pass.\n3. Transcribe literal nutrient label, printed digits, qualifier (<, >, approximately), unit, basis, column and image polygons. Draw row/table/column/header regions. Separate prepared/as-sold and %reference-intake columns; do not convert bases or infer digits. Missing/unreadable is not zero.\n4. Record ingredient order, percentages, additive codes, contains versus may-contain, exact claims/warnings/serving definitions in the existing supplementary schema. Not visible does not establish absent. Preserve mixed-language original text.\n5. For GriTS, add an optional explicit table grid: row_nums/column_nums spans, cell_text including empty cells, and actual cell bbox coordinates. Do not manufacture grid geometry from a nutrient list.\n6. A third independent adjudicator compares two locked passes using existing compare-ocr-annotation-passes.mts and adjudicate-ocr-annotation-passes.mts. Resolve fields with evidence, not arithmetic or model votes. Retain both originals and hash every export. Text/structure adjudication remains explicit human work.\n7. Only after actual decisions run study_ops.py readiness, then the existing final runner gates. Grade 1 independent references, Grade 2 developer/owner visual checks and Grade 3 model/database candidates must stay separate. No final study is executable yet.\n\nNo reviewer is assumed available or assigned. Optional minimum owner review: four diverse product groups (one multi-column solid, one liquid, one prepared-food basis, one allergen/qualifier case) with image coordinates and literal declarations would strengthen a Grade 2 exploratory subset. It would not meet the two-reader independent protocol; formal reduced-study approval would still be needed.\n'''
    (output/'ANNOTATION_README.md').write_text(text,encoding='utf8')
    summary={'scope':'preparation only, no model execution or human references','groups':len(collection['products']),'images':len(alltasks),'imageBytes':total,'reusedVerifiedOriginals':reused,'newlyDownloadedOriginals':len(alltasks)-reused,'strata':dict(Counter(p['categoryStratum'] for p in collection['products'])),'proposedSplits':dict(Counter(p['proposedSplit'] for p in collection['products'])),'conservativeBrandSplitBlocks':len(blocks),'crossGroupExactImageDuplicates':duplicates,'independentHumanPasses':0,'independentAdjudicatedGroups':0,'grade1References':0,'grade2References':0,'grade3ConversationSnapshots':3,'nutritionAssignments':len(alltasks)*2,'textAssignments':len(alltasks)*2,'genuineHumanRequirements':['rights/embedded artwork, market, variant, family/exposure review','actual layout/bases/readability and coverage classification','two independent image transcriptions and distinct adjudication','graded scientific relevance/applicability and blinded answer assessment'],'executionBlockers':['no approved independent references or locked final splits','model/configuration/provider/budget freeze and execution authorization not supplied by this mission','candidate conversation contexts need exact variant/fact review','actual OCR captures and validated per-arm raw adapter payloads are not execution-ready','legacy 12–18 held-out target is not met by the conservative 11-group proposal; additional eligible families or explicit amendment required'],'sourceCollectionSha256':ops.sha(raw),'preparedCollectionFile':derived.name,'preparedCollectionSha256':ops.sha(derived)}
    write(output/'readiness-summary.json',summary);print(json.dumps(summary,indent=2));return summary
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dataset',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--legacy-root',type=Path,required=True);a=p.parse_args();prepare(a.dataset,a.output,a.legacy_root)
