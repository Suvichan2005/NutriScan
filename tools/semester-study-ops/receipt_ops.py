"""Audit receipts before existing scorers run; never generate nutrient/answer scores."""
import argparse
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path
import study_ops as ops

sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('existing_experiment_runner',ops.ROOT/'scripts/evaluation/run_experiments.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


def audit(prepared, receipts):
    jobs={j['jobId']:j for j in prepared.get('jobs',[])}
    if len(jobs)!=len(prepared.get('jobs',[])):raise ValueError('Duplicate prepared job ID')
    seen=set();out=[];accepted=defaultdict(set);all_groups=set();usage=[]
    for r in receipts:
        ident=r.get('jobId')
        if ident not in jobs or ident in seen:raise ValueError('Unknown or duplicate receipt job')
        seen.add(ident);j=jobs[ident];cfg=j['config'];v=r.get('receipt') or {};reasons=[]
        all_groups.add(j['productGroupId'])
        if r.get('status')!='completed':reasons.append('execution:'+str(r.get('status')))
        if v.get('actualModel')!=cfg.get('model'):reasons.append('model-drift-or-missing')
        if v.get('actualGenerationConfig')!=cfg.get('generationConfig'):reasons.append('generation-config-drift-or-missing')
        if v.get('fallbackOccurred') is not False:reasons.append('fallback-or-unknown')
        if v.get('actualInputSelection')!=j.get('adapter',{}).get('inputSelection'):reasons.append('modality-drift-or-missing')
        if v.get('actualStage')!='initial-reconstruction' or type(v.get('recoveryCalls'))!=int or v.get('recoveryCalls')!=0 or type(v.get('answerGenerationCalls'))!=int or v.get('answerGenerationCalls')!=0:reasons.append('not-controlled-initial-extraction')
        binding=v.get('studyBinding',{})
        for key in ('implementationCommit','freezeId','promptHash','sourceSnapshotHash','toolAccessHash'):
            if not cfg.get(key) or binding.get(key)!=cfg[key]:reasons.append('unbound:'+key)
        expected={f['path']:f['sha256'] for f in j.get('inputFiles',[])}
        if not expected or binding.get('inputHashes')!=expected:reasons.append('input-hashes-unbound')
        for c in v.get('providerCallMetadata',[]):
            u=c.get('usage') or {};cost=c.get('cost') or {}
            usage.append({'stage':'initial-reconstruction','taskId':ident,'status':'failed' if c.get('event')=='provider_error' else 'completed','promptTokens':u.get('promptTokenCount'),'outputTokens':u.get('candidatesTokenCount'),'thoughtTokens':u.get('thoughtsTokenCount'),'cachedPromptTokens':u.get('cachedContentTokenCount'),'totalTokens':u.get('totalTokenCount'),'providerMs':c.get('elapsedMs'),'estimatedUsd':cost.get('estimatedTotalUsd'),'billedUsd':None})
        if not reasons:accepted[j['arm']].add(j['productGroupId'])
        out.append({'jobId':ident,'productGroupId':j['productGroupId'],'arm':j['arm'],'status':'COMPARABLE' if not reasons else 'NONCOMPARABLE','reasons':reasons,'providerCalls':len(v.get('providerCallMetadata',[])),'localOcrMs':v.get('localOcrMs'),'totalTaskMs':v.get('totalTaskMs')})
    missing=sorted(set(jobs)-seen)
    arms=sorted({j['arm'] for j in jobs.values()})
    paired=set.intersection(*(accepted[a] for a in arms)) if arms else set()
    return {'status':'READY_FOR_EXISTING_SCORER' if out and not missing and all(x['status']=='COMPARABLE' for x in out) else 'BLOCKED','claimScope':prepared.get('claimScope'),'missingJobs':missing,'rows':out,'productGroupDenominators':{a:len(accepted[a]) for a in arms},'completePairedProductGroups':sorted(paired),'expectedProductGroups':len({j['productGroupId'] for j in jobs.values()}),'usage':runner.usage(usage),'nutrientScoring':'scripts/evaluation/score-reconstruction.mts unchanged; no metrics inferred from row counts','limitations':['Receipt declarations require transport evidence; no source observations or hidden labels inspected.','Missing billed cost is unknown, never zero. Local OCR and total task wall time are kept separate from summed provider time.','Multiple photos/scans of one product never increase product-group denominators.']}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--prepared',type=Path,required=True);p.add_argument('--receipts',type=Path,required=True)
    a=p.parse_args();print(json.dumps(audit(ops.load(a.prepared),ops.load(a.receipts)),indent=2))
if __name__=='__main__':main()
