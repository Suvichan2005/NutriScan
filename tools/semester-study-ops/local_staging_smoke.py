"""Bounded loopback-only production smoke; never enables or calls an AI provider."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import study_ops as ops


def request(port,path='/',method='GET',body=None,headers=None):
    conn=http.client.HTTPConnection('127.0.0.1',port,timeout=15)
    try:
        conn.request(method,path,body=body,headers=headers or {})
        r=conn.getresponse();data=r.read(5_000_000)
        return r.status,dict(r.getheaders()),data
    finally:conn.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=3422);a=p.parse_args()
    root=ops.ROOT;out=root/'.data/study-staging';out.mkdir(exist_ok=True);dist='.data/study-staging-build'
    if (root/'.env.local').exists():raise ValueError('Credential-bearing worktree not allowed for this simulation')
    if not 1024<=a.port<=65535:raise ValueError('Invalid loopback test port')
    with socket.socket() as probe:probe.bind(('127.0.0.1',a.port))
    env=os.environ.copy()
    for k in ('GEMINI_API_KEY','FREE_GEMINI_API_KEY','GOOGLE_API_KEY'):env.pop(k,None)
    env.update(ENABLE_GEMINI='false',ENABLE_PAID_GEMINI='false',ENABLE_PAID_GEMINI_FALLBACK='false',GEMINI_PROVIDER='free',NUTRISCAN_GEMINI_EVAL_CAPTURE='0',NUTRISCAN_GEMINI_TRACE='0',NUTRISCAN_NEXT_DIST_DIR=dist,NEXT_TELEMETRY_DISABLED='1',NODE_ENV='production')
    saved={rel:(root/rel).read_bytes() for rel in ('next-env.d.ts','tsconfig.json')}
    before={rel:hashlib.sha256(value).hexdigest() for rel,value in saved.items()}
    node=shutil.which('node');results=[];server=None
    if not node:raise ValueError('Node runtime required')
    version=subprocess.check_output([node,'--version'],text=True).strip()
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    try:
        with (out/'build.log').open('wb') as log:
            build=subprocess.run([node,str(root/'node_modules/next/dist/bin/next'),'build','--webpack'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
        if build.returncode:raise RuntimeError('Production build failed; inspect private build.log')
        log=(out/'server.log').open('wb')
        server=subprocess.Popen([node,str(root/'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(a.port)],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+60
        while True:
            if server.poll() is not None:raise RuntimeError('Own staging process exited before readiness')
            try:
                status,headers,body=request(a.port)
                if status==200:break
            except (OSError,http.client.HTTPException):pass
            if time.monotonic()>deadline:raise RuntimeError('Loopback startup timed out')
            time.sleep(.25)
        def check(name,observed,expected):
            results.append({'check':name,'observed':observed,'expected':expected,'passed':observed==expected})
        check('home-status',status,200)
        status,headers,body=request(a.port,'/api/status');check('status-endpoint',status,200);data=json.loads(body)
        check('gemini-enabled',data['gemini']['enabled'],False)
        check('readable-capture',data['developerDiagnostics']['readableEvaluationCapture'],False)
        for name,path in [('ocr-worker','/ocr/worker.min.js'),('english-model','/ocr/eng.traineddata.gz'),('paddle-wasm','/ocr/ort/ort-wasm-simd-threaded.jsep.wasm')]:
            status,_,_=request(a.port,path);check(name,status,200)
        valid={'Content-Type':'application/json','Origin':f'http://127.0.0.1:{a.port}'}
        for name,headers,payload,expected in [('foreign-host',{**valid,'Host':f'reviewer.invalid:{a.port}'},'{}',403),('cross-site',{**valid,'Origin':'https://untrusted.invalid'},'{}',403),('malformed-json',valid,'{',400),('oversize-json',valid,'x'*4_300_001,413)]:
            status,_,body=request(a.port,'/api/assist','POST',payload,headers);check(name,status,expected)
        for path in ('/.env.local','/.data/gemini-evaluations','/.data/knowledge/guidelines.sqlite'):
            status,_,_=request(a.port,path);check('private-path-not-served:'+path,status,404)
        if any(not r['passed'] for r in results):raise RuntimeError('Local smoke assertions failed; inspect receipt')
    finally:
        if server is not None:
            server.terminate()
            try:server.wait(timeout=15)
            except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
            log.close()
        # Next.js modifies only these generated/type-config files during build.
        # This isolated worktree has no owner edits; restore the exact pre-build bytes.
        for rel,value in saved.items():
            if (root/rel).read_bytes()!=value:(root/rel).write_bytes(value)
        receipt={'scope':'local-loopback-production-smoke-not-remote-auth-browser-or-provider-acceptance','implementationCommit':revision,'nodeVersion':version,'distDir':dist,'port':a.port,'checks':results,'trackedConfigHashesBefore':before,'trackedConfigHashesAfter':{rel:ops.sha(root/rel) for rel in saved},'ownedServerStopped':server is None or server.poll() is not None,'providerCallsMade':0,'knowledgeStoresMounted':False}
        (out/'smoke-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()
