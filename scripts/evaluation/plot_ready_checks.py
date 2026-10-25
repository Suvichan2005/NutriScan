"""Plot actual offline check timings; never interpret this as photo/answer accuracy."""
import argparse
import hashlib
import json
import math
from pathlib import Path

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--cases',type=Path,required=True)
 parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args()
 if args.output.exists():raise ValueError('Use a fresh output directory; prior evidence is preserved.')
 raw=args.cases.read_bytes();rows=json.loads(raw)
 if not rows or any(not isinstance(row.get('elapsedMs'),(int,float)) or not math.isfinite(row['elapsedMs']) or row['elapsedMs']<=0 for row in rows):raise ValueError('Positive observed timings required; missing/zero durations cannot be log plotted.')
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 args.output.mkdir(parents=True)
 figure,ax=plt.subplots(figsize=(11,10),layout='constrained')
 ax.barh([r['caseId'] for r in rows],[r['elapsedMs'] for r in rows],color=['#286347' if r['status']=='PASS' else '#a43838' for r in rows])
 ax.set_xscale('log');ax.invert_yaxis();ax.set_xlabel('Observed elapsed milliseconds (log scale)')
 ax.set_title('Offline native-tool and source-access development checks\nOne run; heterogeneous checks; no provider calls or accuracy claim',loc='left')
 ax.grid(axis='x',alpha=.2);ax.set_axisbelow(True)
 figure.savefig(args.output/'offline-check-timings.png',dpi=180)
 figure.savefig(args.output/'offline-check-timings.svg')
 plt.close(figure)
 receipt={'inputSha256':hashlib.sha256(raw).hexdigest(),'cases':len(rows),'independenceUnit':'developer-authored check, not photographed product','scope':'Single-run diagnostics; no medians, confidence intervals or product-latency comparison','results':['offline-check-timings.png','offline-check-timings.svg']}
 (args.output/'figure-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(receipt))

if __name__=='__main__':main()
