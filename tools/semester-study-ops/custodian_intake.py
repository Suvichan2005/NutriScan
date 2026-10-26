"""Prepare a private custodian intake using existing annotation assignments, not new labels."""
import argparse
import json
from pathlib import Path
import study_ops as ops

SECTIONS=('nutrition','ingredients','allergens','additives','warnings','claims','serving','identity')


def prepare(original_root,output):
    original_root=original_root.resolve();collection_file=original_root/'.data/semester-evaluation-acquisition-20261026/collection-manifest.json';collection=ops.load(collection_file)
    index_file=ops.local(original_root,collection['annotationPreparation']['index']);index=ops.load(index_file)
    groups=collection['products'];image_count=sum(len(g['images']) for g in groups)
    if index['products']!=len(groups) or index['images']!=image_count:raise ValueError('Annotation assignment index differs from retained collection')
    if '.data' not in output.resolve().parts or output.resolve().is_relative_to(original_root):raise ValueError('Keep new custodian inputs in separate ignored storage; original remains read-only')
    collection_hash=ops.sha(collection_file);index_hash=ops.sha(index_file)
    reviews={'scope':'UNFILLED human review metadata; not approvals/annotations','developmentFamilies':[],'groups':{}}
    for g in groups:
        d={'familyReviewComplete':False,'rightsDecision':None,'variantId':None,'packagingRevision':None,'split':None,'splitLocked':False,'previousModelExposure':None,'readerPasses':[],'adjudication':{},'referenceCoverage':{s:None for s in SECTIONS},'freezeApproved':False}
        d.update({k+'Review':None for k in ('rights','variant','market','layout','exposure','split')});reviews['groups'][g['productGroupId']]=d
    readiness=ops.readiness(collection,original_root,reviews,output)
    if collection_hash!=ops.sha(collection_file) or index_hash!=ops.sha(index_file):raise ValueError('Original manifests changed during intake preparation')
    output.mkdir(parents=True,exist_ok=False);(output/'groups').mkdir()
    for i,g in enumerate(groups):
        lines=[f"# Candidate {i+1:02d}: {g['productGroupId']}",'','PENDING CUSTODIAN REVIEW. Metadata below is source-declared, not verified label truth. Keep originals sealed from implementation/prompt tuning.','',f"Candidate name: {g['productName']}",f"Provisional family: {g.get('familyGroupId')}",f"Metadata stratum: {g.get('categoryStratum')}",f"Source: {g['sourceProductUrl']}",'','## Required decisions','', '- Image-specific/embedded rights and permitted local study use: pending','- Actual India formulation, exact variant and packaging revision: pending','- Family overlap/prior developer or model exposure: pending','- Nutrition/ingredient/allergen/claim/serving layout and legibility: pending','- Product-level split and lock: pending','- Reader A, reader B and distinct adjudicator: pending','', '## Original file pointers and hashes','']
        for im in g['images']:lines.extend([f"Image ID: {im['imageId']}",f"Roles (metadata): {', '.join(im.get('roles',[]))}",f"Original path relative to evidence root: {im['privateLocalFile']}",f"SHA256: {im['sha256']}",f"Bytes: {im['byteLength']}",''])
        lines.extend(['## Existing annotation workflow','', 'Use the original annotation-batches/index.json assignments; do not create a competing batch or prefill labels. Nutrition uses data/ocr-annotation-pass.schema.json and the existing annotation route/comparison/adjudication tools. Supplementary text uses data/evaluation/package-text-pass.schema.json. Two independent readers inspect pixels without OCR/model/catalog values or each other’s passes.','', 'Record signed/dated review receipts under the chosen review root and reference their relative paths/SHA256 in reviews.json. Never mark approved because a file exists. Readiness checks metadata integrity only; final execution still requires the existing experiment freeze gates.'])
        (output/'groups'/f'candidate-{i+1:02d}.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (output/'reviews.json').write_text(json.dumps(reviews,indent=2)+'\n',encoding='utf-8')
    (output/'readiness-before-human-review.json').write_text(json.dumps(readiness,indent=2)+'\n',encoding='utf-8')
    handoff=original_root/'.data/semester-evaluation-acquisition-20261026/HUMAN_HANDOFF.md';text=handoff.read_text(encoding='utf-8-sig')
    stale='10 candidate groups' in text and len(groups)!=10
    receipt={'scope':'custodian metadata preparation only; zero independent labels/approvals','groups':len(groups),'images':image_count,'nutritionPassAssignments':index['nutritionPassAssignments'],'supplementPassAssignments':index['supplementPassAssignments'],'originalCollectionSha256':collection_hash,'originalAnnotationIndexSha256':index_hash,'originalHumanHandoffMayBeStale':stale,'sourceCopies':0,'imagesDecoded':False,'humanReferences':'PENDING'}
    (output/'manifest.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    (output/'README.md').write_text('Custodian intake only. Review groups/*.md and fill reviews.json with actual independently supported decisions. All current values are pending; no rights/split/annotation approval is supplied. Original images and existing annotation assignments remain in the original evidence root; no files were copied. Use readiness with --evidence-root pointing to original image corpus and --review-root pointing to your separate review-record root. Record complete source-relative SHA256 pointers, pseudonymous reviewer codes and genuine dates. Keep reviewer originals immutable. Do not send raw materials or approvals publicly.\n',encoding='utf-8')
    return receipt


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--original-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(prepare(a.original_root,a.output),indent=2))
if __name__=='__main__':main()
