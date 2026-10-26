"""Read-only report provenance audit. Does not edit/author/render the owner report."""
import argparse
import csv
import json
import zipfile
from xml.etree import ElementTree as ET
from pathlib import Path
import study_ops as ops


def docx_metadata(path):
    with zipfile.ZipFile(path) as z:
        xml=ET.fromstring(z.read('word/document.xml'))
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs=[''.join(p.itertext()) for p in xml.findall('.//w:body/w:p',ns)]
        headings=[p for p in paragraphs if p.strip().lower().startswith(('chapter ','1. ','2. ','3. ','4. ','5. ','6. '))]
        return {'sha256':ops.sha(path),'bytes':path.stat().st_size,'directBodyParagraphs':len(paragraphs),'sectionProperties':len(xml.findall('.//w:sectPr',ns)),'headingCandidates':headings[:60]}


def inventory(original_root, template, current_root):
    original_root=original_root.resolve();prep=original_root/'.data/academic-preparation';completion=original_root/'.data/academic-completion'
    manifest=ops.load(prep/'report-evidence.json');anchor_results=[]
    for a in manifest.get('sourceAnchors',[]):
        file=ops.local(current_root,a['path'])
        actual=ops.sha(file) if file.is_file() else None
        anchor_results.append({'id':a['id'],'path':a['path'],'status':'MATCH' if actual==a['sha256'] else 'STALE_OR_MISSING','expectedSha256':a['sha256'],'actualSha256':actual})
    report=completion/'NutriScan_Evidence_Report_20261025.docx';build=ops.load(completion/'report-build.json')
    t=docx_metadata(template);r=docx_metadata(report)
    return {'scope':'read-only-template-and-draft-provenance; no layout/scientific validation','template':t,'draft':r,'templateMatchesPriorReceipt':t['sha256']==build['templateSha256'],'draftMatchesPriorReceipt':r['sha256']==build['reportSha256'],'sourceAnchors':anchor_results,'staleSourceAnchors':sum(a['status']!='MATCH' for a in anchor_results),'finalIndependentResults':'PENDING','humanRatings':'PENDING','requiredExistingWorkflow':'scripts/evaluation/generate_report_evidence.py with updated owner-approved source anchors; never rewrite the original report-evidence matrix from this workstream'}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--original-root',type=Path,required=True);p.add_argument('--template',type=Path,required=True);p.add_argument('--current-root',type=Path,default=ops.ROOT)
    p.add_argument('--output',type=Path)
    a=p.parse_args();result=inventory(a.original_root,a.template,a.current_root)
    if a.output:
        if '.data' not in a.output.resolve().parts:raise ValueError('Private report audit outputs must remain under .data')
        a.output.mkdir(parents=True,exist_ok=False)
        (a.output/'inventory.json').write_text(json.dumps(result,indent=2)+'\n')
        with (a.output/'pending-study-results.csv').open('w',newline='',encoding='utf-8') as f:
            w=csv.writer(f);w.writerow(['study','status','verifiedIndependentItems','metric','value','blocker'])
            for study in ('five-method-reconstruction','nine-profile-conversations','nine-knowledge-pairs'):
                w.writerow([study,'PENDING',0,'not-yet-adjudicated','','Human references/ratings and final implementation/configuration freeze required'])
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
