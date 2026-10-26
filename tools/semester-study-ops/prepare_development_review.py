"""Prepare archived development conversations for human review without new generation.

Only the named exposed semester development pilot is supported. Not held-out/final data.
"""
import argparse
import hashlib
import json
from pathlib import Path
import study_ops as ops
import receipt_ops


def prepare(original_root, output, allow_development=False):
    if not allow_development:raise ValueError('Explicit --allow-development-context required; package contexts are not human verified')
    original_root=original_root.resolve();pilot=original_root/'.data/semester-conversation-pilot-20261026'
    cases=ops.load(pilot/'cases.json');freeze=ops.load(pilot/'freeze.json');summary=ops.load(pilot/'execution-summary.json')
    official=ops.definitions()[0];expected={c['id']:c for c in official['conversations']}
    if {c['id'] for c in cases}!=set(expected) or len(cases)!=9:raise ValueError('Nine authoritative conversation IDs required')
    if freeze['implementationCommit']!=summary['implementationCommit']:raise ValueError('Pilot commit records conflict')
    if '.data' not in output.resolve().parts or output.resolve().is_relative_to(original_root):raise ValueError('Use fresh ignored output outside the read-only original corpus')
    records=[];failures=[];inputs={str((pilot/name).relative_to(original_root)):ops.sha(pilot/name) for name in ('cases.json','freeze.json','execution-summary.json','run.mts')};usage=[];contexts={}
    for c in cases:
        source=expected[c['id']]
        if c['turns']!=source['turns']:raise ValueError('Archived questions differ from authoritative manifest')
        snapshot=ops.local(original_root,c['snapshotFile'])
        if ops.sha(snapshot)!=c['packageSnapshotSha256']:raise ValueError('Archived package snapshot hash mismatch')
        inputs[str(snapshot.relative_to(original_root))]=ops.sha(snapshot)
        package=ops.load(snapshot);history=[]
        for turn in c['turns']:
            name=f"{c['id']}-{turn['turn']}";file=pilot/(name+'.json');failure=pilot/(name+'-failure.json')
            if file.is_file() and failure.is_file():raise ValueError('Both success and failure exist for one logical turn')
            if not file.is_file():
                if failure.is_file():inputs[str(failure.relative_to(original_root))]=ops.sha(failure)
                failures.append({'conversationId':c['id'],'turn':turn['turn'],'status':'failed' if failure.is_file() else 'missing','receiptSha256':ops.sha(failure) if failure.is_file() else None,'code':ops.load(failure).get('code') if failure.is_file() else None});continue
            raw=ops.load(file);s=raw['summary']
            if s['caseId']!=c['id'] or s['turn']!=turn['turn'] or raw['question']!=turn['userText'] or raw['packageSnapshotSha256']!=c['packageSnapshotSha256']:raise ValueError('Archived response identity/context mismatch')
            answer=raw['response']['answer']
            if s['status']!='completed' or not isinstance(answer,str) or not answer.strip():raise ValueError('Invalid completed response receipt')
            inputs[str(file.relative_to(original_root))]=ops.sha(file)
            context={'reviewScope':'EXPOSED DEVELOPMENT PILOT; package facts NOT independently human verified; server-returned text, not observed browser rendering. Do not score as final held-out study.','conversationId':c['id'],'turn':turn['turn'],'fictionalProfile':c['profile'],'packageSnapshot':package,'question':turn['userText'],'conversationContext':history[-4:]}
            text=json.dumps(context,indent=2,ensure_ascii=False)+'\n';relative='contexts/'+name+'.json';contexts[relative]=text
            records.append({'responseId':s['diagnosticId'],'conversationId':c['id'],'turn':turn['turn'],'questionSha256':turn['sourceTextSha256'],'buildCommit':freeze['implementationCommit'],'contextSha256':hashlib.sha256(text.encode()).hexdigest(),'contextArtifact':{'path':relative,'sha256':hashlib.sha256(text.encode()).hexdigest()},'displayedResponse':answer,'responseSha256':hashlib.sha256(answer.encode()).hexdigest(),'responseCaptureKind':'server-returned-answer-not-browser-observed','contextStatus':'development-unreviewed','treatment':'knowledge-on','sourceReceipts':raw['response'].get('agentEvidence',[]),'status':'completed','sourceReceiptSha256':ops.sha(file),'packageSnapshotSha256':c['packageSnapshotSha256'],'model':s.get('actualModels'),'fallbackOccurred':s.get('fallbackOccurred'),'historicalToolAccess':freeze.get('toolAccess')})
            history.append({'question':turn['userText'],'answer':answer[:2000]})
            for call in raw['calls']:
                u=call.get('usage') or {};cost=call.get('cost') or {}
                usage.append({'taskId':name,'stage':call.get('stage'),'promptTokens':u.get('promptTokenCount'),'outputTokens':u.get('candidatesTokenCount'),'thoughtTokens':u.get('thoughtsTokenCount'),'cachedPromptTokens':u.get('cachedContentTokenCount'),'totalTokens':u.get('totalTokenCount'),'estimatedUsd':cost.get('estimatedTotalUsd'),'billedUsd':None})
    if len(records)+len(failures)!=27:raise ValueError('Logical turn accounting must equal27')
    for rel,digest in inputs.items():
        if ops.sha(ops.local(original_root,rel))!=digest:raise ValueError('Source corpus changed during preparation')
    output.mkdir(parents=True,exist_ok=False);(output/'contexts').mkdir()
    for rel,text in contexts.items():
        # newline bytes must match the context hash on Windows as well.
        (output/rel).write_bytes(text.encode('utf-8'))
    (output/'response-records.json').write_text(json.dumps(records,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    manifest={'scope':'actual historical development receipts; no final independent ratings','sourceCommit':freeze['implementationCommit'],'sourceInputs':inputs,'plannedLogicalTurns':27,'completedResponses':len(records),'failedOrMissingTurns':failures,'humanReferences':'PENDING','humanRatings':'PENDING','browserRenderedAnswers':'NOT_OBSERVED','responsesWithReturnedSources':sum(bool(r['sourceReceipts']) for r in records),'usageForCompletedConversationCallsOnly':receipt_ops.runner.usage(usage),'limitations':['Initial package reconstruction costs excluded. Failed request usage may be absent; completed-call totals do not establish full task billing.','No knowledge-off pairs exist in this run; do not claim knowledge-ablation results.','Derived context includes disclosed fictional profile and model-assisted package readings, not independent truth.','History reproduces the runner\'s last-four-turn /2000-character answer truncation; current application context may differ.']}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    packet=ops.export_review(records,20261026,output/'review-batch',output)
    return {'scope':manifest['scope'],'completedResponses':len(records),'failedOrMissingTurns':failures,'reviewExport':packet,'providerCallsMade':0}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--original-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-development-context',action='store_true');a=p.parse_args()
    print(json.dumps(prepare(a.original_root,a.output,a.allow_development_context),indent=2))
if __name__=='__main__':main()
