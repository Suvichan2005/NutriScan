"""Private study operations; no network, model invocation, image decoding or label reading.

Existing run_experiments.py remains the final execution gate and nutrient scorer.
This companion reports metadata blockers and binds nine-dimension human reviews.
"""
import argparse
import hashlib
import importlib.util
import json
import random
import csv
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def local(root, relative):
    p = (root / relative).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ValueError('Input path escapes the explicit evidence root')
    return p


def artifact(root, record):
    # Hash bytes only; never parse image content or hidden annotation answers.
    if not isinstance(record, dict) or not record.get('path') or not re.fullmatch('[a-f0-9]{64}', record.get('sha256', '')):
        return False
    p = local(root, record['path'])
    return p.is_file() and sha(p) == record['sha256']


def readiness(collection, root, review, review_root=None):
    review_root = review_root or root
    groups = collection.get('products', [])
    decisions = review.get('groups', {})
    ids = Counter(g.get('productGroupId') for g in groups)
    families = defaultdict(set)
    image_owners = defaultdict(set)
    for g in groups:
        d = decisions.get(g['productGroupId'], {})
        families[g.get('familyGroupId')].add(d.get('split', g.get('proposedSplit')))
        for im in g.get('images', []):
            image_owners[im.get('sha256')].add(g['productGroupId'])
    rows = []
    for g in groups:
        ident = g['productGroupId']; d = decisions.get(ident, {}); issues = []
        def issue(code, status='NEEDS_HUMAN_REVIEW'):
            issues.append({'code': code, 'status': status})
        if ids[ident] != 1: issue('duplicate-product-group', 'CONFLICT')
        if not g.get('familyGroupId'): issue('family-identity', 'MISSING')
        if len(families[g.get('familyGroupId')]) > 1: issue('family-crosses-splits', 'CONFLICT')
        if not d.get('familyReviewComplete'): issue('family-exposure-review')
        if g.get('familyGroupId') in review.get('developmentFamilies', []) and d.get('split') != 'development':
            issue('development-family-outside-development', 'CONFLICT')
        for key in ('rights', 'variant', 'market', 'layout', 'exposure', 'split'):
            if not artifact(review_root, d.get(key + 'Review')): issue(key + '-review-artifact', 'MISSING')
        if d.get('rightsDecision') != 'approved-local-study': issue('rights-not-approved')
        if not d.get('variantId') or not d.get('packagingRevision'): issue('exact-variant-revision', 'MISSING')
        if d.get('variantId') and g.get('variantId') and d['variantId'] != g['variantId']:
            issue('variant-declaration-mismatch', 'CONFLICT')
        split = d.get('split', g.get('proposedSplit'))
        if split not in {'development', 'calibration', 'held-out'}: issue('split-not-final', 'MISSING')
        if d.get('splitLocked') is not True: issue('split-unlocked', 'MISSING')
        if d.get('previousModelExposure') is not False and split != 'development': issue('exposure-unresolved-or-positive')
        if not g.get('sourceProductUrl') or not g.get('retrievedAt'): issue('acquisition-provenance', 'MISSING')
        if not g.get('images'): issue('original-images', 'MISSING')
        for im in g.get('images', []):
            path = im.get('privateLocalFile', ''); p = local(root, path)
            if not path or not p.is_file(): issue('image-missing:' + im.get('imageId', '?'), 'MISSING'); continue
            if sha(p) != im.get('sha256') or p.stat().st_size != im.get('byteLength'):
                issue('image-integrity:' + im['imageId'], 'CONFLICT')
            if len(image_owners[im.get('sha256')]) > 1: issue('image-reused-across-groups', 'CONFLICT')
        passes = d.get('readerPasses', [])
        readers = {p.get('reviewerCode') for p in passes if p.get('independentHuman') is True and artifact(review_root, p)} - {None, ''}
        if len(readers) < 2: issue('two-independent-reader-passes', 'MISSING')
        if len({p.get('path') for p in passes}) != len(passes): issue('reader-pass-artifact-reused', 'CONFLICT')
        adjudication = d.get('adjudication', {})
        if not artifact(review_root, adjudication) or not adjudication.get('reviewerCode') or adjudication.get('reviewerCode') in readers:
            issue('independent-adjudication', 'MISSING')
        if adjudication.get('unresolvedDisagreements') != 0: issue('unresolved-reference-disagreements')
        required = {'nutrition', 'ingredients', 'allergens', 'additives', 'warnings', 'claims', 'serving', 'identity'}
        if set(d.get('referenceCoverage', {})) != required or any(v not in {'human-reviewed-present', 'human-reviewed-absent', 'human-reviewed-unreadable'} for v in d.get('referenceCoverage', {}).values()):
            issue('human-reference-section-coverage', 'MISSING')
        if d.get('freezeApproved') and issues: issue('premature-freeze-approval', 'CONFLICT')
        status = next((s for s in ('CONFLICT', 'MISSING', 'NEEDS_HUMAN_REVIEW') if any(i['status'] == s for i in issues)), 'READY')
        rows.append({'productGroupId': ident, 'status': status, 'split': split, 'blockers': issues})
    return {'scope': 'metadata-integrity-only-not-scientific-validation', 'status': 'READY' if rows and all(r['status'] == 'READY' for r in rows) else 'BLOCKED', 'groups': rows, 'counts': dict(Counter(r['status'] for r in rows)), 'hiddenLabelsParsed': False, 'imagesDecoded': False, 'finalExecutionGate': 'Still requires scripts/evaluation/run_experiments.py final gates; READY here is metadata intake only'}


def definitions():
    return load(ROOT/'data/evaluation/semester-conversations.json'), load(ROOT/'data/evaluation/semester-experiments.json')


def blind_responses(records, seed, batch_id='synthetic-batch'):
    conversations, experiment = definitions()
    expected = {(c['id'], t['turn']): t['sourceTextSha256'] for c in conversations['conversations'] for t in c['turns']}
    seen = set(); rows = []
    for r in records:
        key = (r['conversationId'], r['turn'])
        if key not in expected or r.get('questionSha256') != expected[key]: raise ValueError('Question identity mismatch')
        if r['responseId'] in seen: raise ValueError('Duplicate response identity')
        seen.add(r['responseId'])
        if not re.fullmatch('[0-9a-f]{40}', r.get('buildCommit', '')): raise ValueError('Missing exact build commit')
        for field in ('contextSha256', 'responseSha256'):
            if not re.fullmatch('[0-9a-f]{64}', r.get(field, '')): raise ValueError('Missing exact context/response hash')
        if hashlib.sha256(r['displayedResponse'].encode()).hexdigest() != r['responseSha256']: raise ValueError('Displayed response changed')
        if r.get('status') != 'completed': raise ValueError('Incomplete response must remain a failure receipt, not a rated answer')
        if r.get('treatment') not in {'knowledge-on', 'knowledge-off'}: raise ValueError('Unknown treatment')
        if not r.get('sourceReceipts') and r.get('sourceReceipts') != []: raise ValueError('Source receipt inventory missing')
        rows.append(r)
    random.Random(seed).shuffle(rows)
    key = []; packets = []
    for i, r in enumerate(rows):
        ident = f'{batch_id}-R{i+1:04d}'
        key.append({'blindResponseId': ident, **{k:r[k] for k in ('responseId','conversationId','turn','buildCommit','contextSha256','responseSha256','treatment')}})
        packets.append({'blindResponseId': ident, 'conversationId':r['conversationId'], 'turn':r['turn'], 'contextSha256':r['contextSha256'], 'responseSha256':r['responseSha256'], 'displayedResponse':r['displayedResponse'], 'sourceReceipts':r['sourceReceipts'], 'rating':{**experiment['humanReview']['blankRatingRow'], 'blindResponseId':ident,'conversationId':r['conversationId'],'turn':r['turn'],'contextSha256':r['contextSha256'],'responseSha256':r['responseSha256']}})
    return {'privateJoinKey':key,'reviewerPackets':packets,'rubric':experiment['humanReview']['dimensions'],'limitations':'Blinding removes explicit treatment/build labels; source content may reveal treatment. Human reviewers must receive separately authorized package/profile/history context.'}


def validate_ratings(ratings, key, responses=None):
    _, experiment = definitions(); dimensions = experiment['humanReview']['dimensions']
    joins = {r['blindResponseId']:r for r in key}
    if len(joins)!=len(key): raise ValueError('Duplicate blind response ID in join key')
    seen=set(); scores=defaultdict(list); reviewers=defaultdict(set)
    catalog={}
    for response in responses or []:
        ident=response.get('responseId')
        if not ident or ident in catalog:raise ValueError('Duplicate/missing frozen response identity')
        text=response.get('displayedResponse')
        if not isinstance(text,str) or hashlib.sha256(text.encode()).hexdigest()!=response.get('responseSha256'):raise ValueError('Frozen response text/hash mismatch')
        catalog[ident]=response
    for r in ratings:
        if r.get('blindResponseId') not in joins: raise ValueError('Unknown blind response ID')
        j=joins[r['blindResponseId']]
        for k in ('conversationId','turn','contextSha256','responseSha256'):
            if r.get(k)!=j[k]: raise ValueError('Rating joined to wrong response/context')
        if r.get('provenance')!='independent-human' or not r.get('raterCode'): raise ValueError('Actual human provenance required')
        if not isinstance(r.get('criticalErrors'),list): raise ValueError('Critical-error inventory required')
        when=datetime.fromisoformat(r.get('assessedAt','').replace('Z','+00:00'))
        if when.tzinfo is None: raise ValueError('Timezone required')
        pair=(r['blindResponseId'],r['raterCode'])
        if pair in seen: raise ValueError('Duplicate reviewer rating')
        seen.add(pair);reviewers[r['blindResponseId']].add(r['raterCode'])
        if set(r.get('scores',{}))!=set(dimensions): raise ValueError('All nine dimensions required')
        for dim,value in r['scores'].items():
            if value is None:
                if not r.get('notApplicableReasons',{}).get(dim): raise ValueError('N/A reason required; unfilled scores remain pending')
            elif type(value)!=int or not 0<=value<=4: raise ValueError('Score must be integer 0–4')
            scores[(r['blindResponseId'],dim)].append(value)
        if not isinstance(r.get('evidencePointers'),list) or not r['evidencePointers']: raise ValueError('Rating evidence pointers required')
        for e in r.get('criticalErrors',[]):
            if not all(isinstance(e.get(k),str) and e[k].strip() for k in ('responseSpan','evidencePointer','reason')): raise ValueError('Critical error evidence incomplete')
            response=catalog.get(j.get('responseId'))
            if response is None:raise ValueError('Critical-error review requires frozen response records')
            if any(response.get(k)!=j.get(k) for k in ('contextSha256','responseSha256','conversationId','turn')):raise ValueError('Critical error bound to wrong frozen response/context')
            if e['responseSpan'] not in response['displayedResponse']:raise ValueError('Critical-error quote is absent from frozen response')
    return {'status':'PENDING' if not joins or any(len(reviewers[k])<2 for k in joins) else 'REQUIRES_HUMAN_ADJUDICATION','responses':len(joins),'humanRatingRows':len(ratings),'twoReviewerResponses':sum(len(reviewers[k])>=2 for k in joins),'criticalErrors':sum(len(r.get('criticalErrors',[])) for r in ratings),'perResponseDimensions':[{'blindResponseId':k,'dimension':d,'n':len([x for x in v if x is not None]),'notApplicable':v.count(None),'mean':sum(x for x in v if x is not None)/len([x for x in v if x is not None]) if any(x is not None for x in v) else None,'disagreement':len(set(v))>1} for (k,d),v in scores.items()],'claimScope':'human-record-bookkeeping; provenance declaration cannot authenticate a human or establish scientific truth'}



def pair_audit(records):
    conversations, experiment = definitions()
    required = {r['conversationId'] for r in experiment['knowledgeAblation']['requests']}
    grouped = defaultdict(dict); issues = []
    for r in records:
        if r.get('turn') != 1 or r.get('conversationId') not in required:
            issues.append('not-an-authoritative-first-turn-pair'); continue
        group = grouped[r['conversationId']]; arm=r.get('treatment')
        if arm not in {'knowledge-on','knowledge-off'} or arm in group:
            issues.append('duplicate-or-invalid-pair-treatment'); continue
        group[arm]=r
    pairs=[]
    for ident in sorted(required):
        g=grouped[ident];reasons=[]
        if set(g)!={'knowledge-on','knowledge-off'}:reasons.append('missing-paired-response')
        else:
            for k in ('contextSha256','questionSha256','buildCommit','model','generationConfigSha256','basePromptSha256','packageSnapshotSha256'):
                if not g['knowledge-on'].get(k) or g['knowledge-on'].get(k)!=g['knowledge-off'].get(k):reasons.append('noncomparable:'+k)
            for arm in g:
                if not g[arm].get('toolManifestSha256'):reasons.append('missing-tool-manifest:'+arm)
                if g[arm].get('status')!='completed':reasons.append('incomplete:'+arm)
                if g[arm].get('fallbackOccurred') is not False:reasons.append('fallback-or-unknown:'+arm)
                if g[arm].get('treatment')=='knowledge-off' and g[arm].get('externalKnowledgeCalls')!=0:reasons.append('knowledge-off-contamination')
        pairs.append({'conversationId':ident,'status':'COMPARABLE' if not reasons else 'PENDING_OR_NONCOMPARABLE','reasons':reasons})
    return {'status':'READY' if not issues and all(p['status']=='COMPARABLE' for p in pairs) else 'BLOCKED','issues':issues,'pairs':pairs,'scope':'comparability metadata only; not answer quality'}


def export_review(records, seed, output, evidence_root):
    # A fresh private directory prevents accidental replacement of reviewer assessments.
    if '.data' not in output.resolve().parts:raise ValueError('Review outputs must remain in ignored .data storage')
    for r in records:
        context=r.get('contextArtifact')
        if not artifact(evidence_root,context) or context['sha256']!=r['contextSha256']:
            raise ValueError('Reviewer context artifact absent/changed; do not export responses without context')
    batch_id='batch-'+canonical({'responses':[{k:r[k] for k in ('responseId','conversationId','turn','buildCommit','contextSha256','responseSha256','treatment')} for r in records],'seed':seed})[:12]
    result=blind_responses(records,seed,batch_id)
    output.mkdir(parents=True,exist_ok=False)
    (output/'custodian').mkdir();(output/'reviewer').mkdir()
    (output/'custodian/join-key.json').write_text(json.dumps(result['privateJoinKey'],indent=2)+'\n')
    (output/'custodian/response-records.json').write_text(json.dumps(records,indent=2)+'\n')
    (output/'reviewer/packets.json').write_text(json.dumps(result['reviewerPackets'],indent=2)+'\n')
    for packet,join in zip(result['reviewerPackets'],result['privateJoinKey']):
        record=next(r for r in records if r['responseId']==join['responseId'])
        context=local(evidence_root,record['contextArtifact']['path']).read_text(encoding='utf-8-sig')
        (output/'reviewer'/f"{packet['blindResponseId']}.md").write_text(f"# {packet['blindResponseId']}\n\n{context}\n\n## Response\n\n{packet['displayedResponse']}\n\n## Evidence receipts\n\n"+json.dumps(packet['sourceReceipts'],indent=2)+'\n',encoding='utf-8')
    from review_form import render_form
    contexts={join['blindResponseId']:local(evidence_root,next(r for r in records if r['responseId']==join['responseId'])['contextArtifact']['path']).read_text(encoding='utf-8-sig') for join in result['privateJoinKey']}
    (output/'reviewer/review.html').write_text(render_form(result['reviewerPackets'],contexts,result['rubric'],batch_id),encoding='utf-8')
    (output/'reviewer/blank-ratings.json').write_text(json.dumps([p['rating'] for p in result['reviewerPackets']],indent=2)+'\n')
    (output/'reviewer/README.md').write_text('Record your own nine-dimension ratings in blank-ratings.json. Set independent-human only for your own actual review, use a pseudonymous raterCode and timezone-aware assessedAt. Null is pending; use notApplicableReasons only for genuine N/A. Preserve source pointers and exact critical-error spans. Return ratings to the custodian. Do not request the join-key. Blinding is partial: source receipts may reveal treatment. Treat all supplied context as private.\n')
    return {'status':'EXPORTED','responses':len(records),'path':str(output),'humanRatings':'PENDING','batchId':batch_id}


def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    r=s.add_parser('readiness');r.add_argument('--collection',type=Path,required=True);r.add_argument('--evidence-root',type=Path,required=True);r.add_argument('--reviews',type=Path);r.add_argument('--review-root',type=Path,help='Separate read-only root for human review artifacts; defaults to evidence-root')
    b=s.add_parser('blind');b.add_argument('--responses',type=Path,required=True);b.add_argument('--seed',type=int,required=True)
    a=s.add_parser('ratings');a.add_argument('--ratings',type=Path,required=True);a.add_argument('--key',type=Path,required=True);a.add_argument('--responses',type=Path,help='Frozen response records required when critical errors are reported')
    e=s.add_parser('export-review');e.add_argument('--responses',type=Path,required=True);e.add_argument('--seed',type=int,required=True);e.add_argument('--output',type=Path,required=True);e.add_argument('--evidence-root',type=Path,required=True)
    pairs=s.add_parser('pairs');pairs.add_argument('--responses',type=Path,required=True)
    args=p.parse_args()
    if args.command=='readiness':out=readiness(load(args.collection),args.evidence_root,load(args.reviews) if args.reviews else {},args.review_root)
    elif args.command=='blind':out=blind_responses(load(args.responses),args.seed)
    elif args.command=='export-review':out=export_review(load(args.responses),args.seed,args.output,args.evidence_root)
    elif args.command=='pairs':out=pair_audit(load(args.responses))
    else:out=validate_ratings(load(args.ratings),load(args.key),load(args.responses) if args.responses else None)
    print(json.dumps(out,indent=2))
if __name__=='__main__':main()
