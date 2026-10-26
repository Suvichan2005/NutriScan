"""Summarize retained development run receipts; no answer/nutrient quality scoring."""
import argparse
import csv
import json
import statistics
from pathlib import Path
import study_ops as ops
import receipt_ops


def summarize(pilot):
    summary=ops.load(pilot/'execution-summary.json');cases=ops.load(pilot/'cases.json');freeze=ops.load(pilot/'freeze.json')
    official={c['id']:c['turns'] for c in ops.definitions()[0]['conversations']}
    authoritative={c:[t['turn'] for t in turns] for c,turns in official.items()}
    if {c['id']:c['turns'] for c in cases}!=official:raise ValueError('Archived question text differs from authoritative portfolio')
    if {c['id']:[t['turn'] for t in c['turns']] for c in cases}!=authoritative:raise ValueError('Conversation portfolio mismatch')
    if summary['implementationCommit']!=freeze['implementationCommit']:raise ValueError('Build binding conflict')
    expected={(c,t) for c,turns in authoritative.items() for t in turns};seen=set();rows=[];usage=[];inputs={}
    for r in summary['results']:
        key=(r['caseId'],r['turn'])
        if key not in expected or key in seen:raise ValueError('Unknown/duplicate logical turn')
        seen.add(key);file=pilot/(r['caseId']+'-'+str(r['turn'])+('' if r['status']=='completed' else '-failure')+'.json')
        raw=ops.load(file);inputs[file.name]=ops.sha(file)
        if r['status']=='completed':
            if raw['summary']!=r:raise ValueError('Execution summary disagrees with original receipt')
            calls=raw['calls'];sources=raw['response'].get('agentEvidence',[])
            if raw['question']!=next(t['userText'] for t in official[r['caseId']] if t['turn']==r['turn']):raise ValueError('Response question differs from declared turn')
            def token_total(field):
                values=[(c.get('usage') or {}).get(field) for c in calls]
                return sum(values) if values and all(type(v)==int and v>=0 for v in values) else None
            for field,declared in [('promptTokenCount','inputTokens'),('candidatesTokenCount','outputTokens')]:
                if token_total(field) is not None and token_total(field)!=r.get(declared):raise ValueError('Token summary differs from SDK receipts')
            if len(calls)!=r['generations'] or len(sources)!=len(r['sourceIds']):raise ValueError('Receipt call/source counts conflict')
            for call in calls:
                u=call.get('usage') or {};c=call.get('cost') or {}
                usage.append({'stage':call.get('stage'),'taskId':r['caseId']+'-'+str(r['turn']),'promptTokens':u.get('promptTokenCount'),'outputTokens':u.get('candidatesTokenCount'),'thoughtTokens':u.get('thoughtsTokenCount'),'cachedPromptTokens':u.get('cachedContentTokenCount'),'totalTokens':u.get('totalTokenCount'),'estimatedUsd':c.get('estimatedTotalUsd'),'billedUsd':None})
            row={'conversationId':r['caseId'],'turn':r['turn'],'status':r['status'],'failureCode':None,'assistTaskMs':r['elapsedMs'],'completedGenerationCalls':len(calls),'returnedSourceCount':len(sources),'toolCallCount':len(raw['toolCalls']),'model':'|'.join(r['actualModels']),'tier':'|'.join(r['actualTiers']),'fallbackOccurred':r['fallbackOccurred'],'inputTokens':token_total('promptTokenCount'),'outputTokens':token_total('candidatesTokenCount'),'photoParts':r['photoParts'],'withheldQuantitySentences':r['withheldQuantitySentences']}
        else:
            if raw!=r:raise ValueError('Failure receipt differs from summary')
            row={'conversationId':r['caseId'],'turn':r['turn'],'status':r['status'],'failureCode':r.get('code'),'assistTaskMs':r['elapsedMs'],'completedGenerationCalls':None,'returnedSourceCount':None,'toolCallCount':None,'model':None,'tier':None,'fallbackOccurred':None,'inputTokens':None,'outputTokens':None,'photoParts':None,'withheldQuantitySentences':None}
        rows.append(row)
    if seen!=expected:raise ValueError('Missing logical turn; do not hide it from denominator')
    for name in ('execution-summary.json','freeze.json','cases.json','run.mts'):inputs[name]=ops.sha(pilot/name)
    for name,digest in inputs.items():
        if ops.sha(pilot/name)!=digest:raise ValueError('Input changed during aggregation')
    good=[r for r in rows if r['status']=='completed'];times=[r['assistTaskMs'] for r in good]
    metrics={'plannedConversations':9,'plannedLogicalTurns':27,'completedLogicalTurns':len(good),'failedLogicalTurns':len(rows)-len(good),'completedGenerations':len(usage),'responsesWithReturnedSources':sum(r['returnedSourceCount']>0 for r in good),'sourceCoverageDenominator':len(good),'toolCallsInCompletedTurns':sum(r['toolCallCount'] for r in good),'completedAssistTaskMedianMs':statistics.median(times) if times else None,'completedAssistTaskMinMs':min(times) if times else None,'completedAssistTaskMaxMs':max(times) if times else None,'completedWithheldQuantitySentences':sum(r['withheldQuantitySentences'] for r in good)}
    return {'schemaVersion':1,'claimScope':'development-exploratory-operational-receipts-not-answer-quality','implementationCommit':freeze['implementationCommit'],'metrics':metrics,'usageForCompletedGenerationCalls':receipt_ops.runner.usage(usage),'rows':rows,'sourceFileHashes':inputs,'limitations':['Three exposed product groups and fictional profiles; turns within a conversation are correlated.','No independent human accuracy/usefulness ratings or final study conclusions.','Assist task wall time measured by the archived direct-call runner; not browser or full scan latency.','Initial reconstruction/OCR time and failed-provider usage omitted from completed-call totals; missing billing/thinking/cache fields remain unknown.','Returned source count is observable evidence handoff, not semantic correctness or a complete measure of tool quality.']}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pilot',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();result=summarize(a.pilot)
    if '.data' not in a.output.resolve().parts:raise ValueError('Keep source-linked operational artifacts in ignored .data')
    a.output.mkdir(parents=True,exist_ok=False)
    (a.output/'operational-summary.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    with (a.output/'per-turn.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(result['rows'][0]));w.writeheader();w.writerows(result['rows'])
    # Feed the existing report generator: values bind to exact JSON pointers/hashes.
    rel=(a.output/'operational-summary.json').resolve().relative_to(ops.ROOT).as_posix();digest=ops.sha(a.output/'operational-summary.json')
    manifest={'schemaVersion':1,'sourceAnchors':[{'id':'archived-development-operations','path':rel,'sha256':digest,'evidenceClass':'development-exploratory'}],'measuredResults':[{'id':k,'metric':k,'value':v,'unit':'ms' if k.endswith('Ms') else 'count','evidenceClass':'development-exploratory','evidencePath':rel,'evidenceSha256':digest,'jsonPointer':'/metrics/'+k} for k,v in result['metrics'].items() if v is not None],'diagrams':[]}
    (a.output/'report-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['metrics'],indent=2))
if __name__=='__main__':main()
