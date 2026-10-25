"""Generate evidence tables and local diagrams from an explicit private manifest.

No network, model calls, source edits, default measured values or final conclusions.
Run with bundled Python/Pillow; a source hash validates identity, not scientific truth.
"""
import argparse
import csv
import hashlib
import html
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLASSES = {'development-exploratory', 'independent-evaluation', 'source-integrity', 'unit-test'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_source(relative):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('Evidence files must stay inside the selected repository.')
    return path


def pointer(data, value):
    if not value.startswith('/'):
        raise ValueError('Metric evidence requires a JSON Pointer.')
    for key in value[1:].split('/'):
        key = key.replace('~1', '/').replace('~0', '~')
        data = data[int(key)] if isinstance(data, list) else data[key]
    return data


def verify_results(rows):
    seen = set()
    for row in rows:
        if row['id'] in seen:
            raise ValueError('Duplicate metric ID.')
        seen.add(row['id'])
        value = row['value']
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Measured values must be finite numbers, never placeholders.')
        if row['evidenceClass'] not in CLASSES:
            raise ValueError('Unrecognized evidence class.')
        source = resolve_source(row['evidencePath'])
        if sha(source) != row['evidenceSha256']:
            raise ValueError('Metric receipt hash mismatch.')
        receipt = json.loads(source.read_text(encoding='utf-8'))
        observed = pointer(receipt, row['jsonPointer'])
        if isinstance(observed, bool) or not isinstance(observed, (float, int)) or observed != value:
            raise ValueError('Metric value differs from its source receipt.')
        if row['evidenceClass'] == 'independent-evaluation':
            ref = row.get('referenceProvenance', {})
            readers = ref.get('independentHumanReaders', [])
            if len(set(readers)) < 2 or not ref.get('adjudicated') or not ref.get('lockedManifestSha256'):
                raise ValueError('Independent results require two readers, adjudication and split lock provenance.')
    return rows


def write_diagram(spec, output):
    from PIL import Image, ImageDraw, ImageFont
    width, height = spec['width'], spec['height']
    image = Image.new('RGB', (width, height), '#ffffff')
    draw = ImageDraw.Draw(image)
    font_path = Path('C:/Windows/Fonts/arial.ttf')
    font = ImageFont.truetype(str(font_path), 19) if font_path.exists() else ImageFont.load_default()
    title_font = ImageFont.truetype(str(font_path), 28) if font_path.exists() else font
    draw.text((40, 25), spec['title'], fill='#173f35', font=title_font)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">', '<rect width="100%" height="100%" fill="white"/>', '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto-start-reverse"><path d="M0,0 L0,6 L9,3 z" fill="#557369"/></marker></defs>', f'<text x="40" y="47" font-family="Arial" font-size="28" fill="#173f35">{html.escape(spec["title"])}</text>']
    for edge in spec['edges']:
        points = edge['points']
        draw.line([tuple(p) for p in points], fill='#557369', width=3)
        x, y = points[-1]
        before_x, before_y = points[-2]
        angle = math.atan2(y-before_y, x-before_x)
        draw.polygon([(x,y),(x-12*math.cos(angle-0.45),y-12*math.sin(angle-0.45)),(x-12*math.cos(angle+0.45),y-12*math.sin(angle+0.45))], fill='#557369')
        if edge.get('bidirectional'):
            x,y=points[0];before_x,before_y=points[1]
            angle=math.atan2(y-before_y,x-before_x)
            draw.polygon([(x,y),(x-12*math.cos(angle-0.45),y-12*math.sin(angle-0.45)),(x-12*math.cos(angle+0.45),y-12*math.sin(angle+0.45))],fill='#557369')
        start_marker=' marker-start="url(#arrow)"' if edge.get('bidirectional') else ''
        svg.append(f'<polyline points="{" ".join(f"{p[0]},{p[1]}" for p in points)}" fill="none" stroke="#557369" stroke-width="3" marker-end="url(#arrow)"{start_marker}/>')
    for node in spec['nodes']:
        x,y,w,h=node['box']
        draw.rounded_rectangle((x,y,x+w,y+h),radius=12,fill='#eef5ef',outline='#527c68',width=2)
        svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#eef5ef" stroke="#527c68" stroke-width="2"/>')
        for index,line in enumerate(node['lines']):
            draw.text((x+18,y+16+index*27),line,font=font,fill='#173f35')
            svg.append(f'<text x="{x+18}" y="{y+36+index*27}" font-family="Arial" font-size="19" fill="#173f35">{html.escape(line)}</text>')
    for index,line in enumerate(spec.get('notes',[])):
        draw.text((40,height-75+index*26),line,font=font,fill='#43564c')
        svg.append(f'<text x="40" y="{height-55+index*26}" font-family="Arial" font-size="19" fill="#43564c">{html.escape(line)}</text>')
    svg.append('</svg>')
    output.with_suffix('.svg').write_text('\n'.join(svg),encoding='utf-8')
    image.save(output.with_suffix('.png'))


def write_metric_figures(rows, output):
    """Compare only identical metric/unit/evidence classes; no pooled fake score."""
    from PIL import Image, ImageDraw, ImageFont
    groups={}
    for row in rows:groups.setdefault((row['metric'],row['unit'],row['evidenceClass']),[]).append(row)
    font_path=Path('C:/Windows/Fonts/arial.ttf')
    font=ImageFont.truetype(str(font_path),17) if font_path.exists() else ImageFont.load_default()
    for index,((metric,unit,evidence_class),values) in enumerate(groups.items()):
        if len(values)>30:raise ValueError('Split figure panels explicitly when a metric has over 30 rows.')
        width,height=1300,170+len(values)*42
        image=Image.new('RGB',(width,height),'white');draw=ImageDraw.Draw(image)
        title=f'{metric} ({unit}) | {evidence_class}'
        draw.text((25,20),title,font=font,fill='black')
        low=min(0,min(row['value'] for row in values));high=max(0,max(row['value'] for row in values))
        span=high-low or 1
        scale=lambda value:540+(value-low)/span*600
        zero=scale(0)
        svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="100%" height="100%" fill="white"/>',f'<text x="25" y="40" font-family="Arial" font-size="17">{html.escape(title)}</text>']
        for position,row in enumerate(values):
            y=70+position*42;x=scale(row['value'])
            label=f'{row["id"]}: {row["value"]}'
            if len(label)>70:raise ValueError('Use a shorter stable result ID for the figure; CSV preserves all metadata.')
            draw.text((25,y),label,font=font,fill='black');draw.rectangle((min(x,zero),y,max(x,zero),y+24),fill='#3d7f68')
            svg+=[f'<text x="25" y="{y+18}" font-family="Arial" font-size="17">{html.escape(label)}</text>',f'<rect x="{min(x,zero)}" y="{y}" width="{abs(x-zero)}" height="24" fill="#3d7f68"/>']
        note='Exact receipt values; no confidence intervals or generalization claim. See measured-results.csv for sources.'
        draw.text((25,height-45),note,font=font,fill='#43564c');svg+=[f'<text x="25" y="{height-27}" font-family="Arial" font-size="17">{note}</text>','</svg>']
        (output/f'metric-{index+1}.svg').write_text('\n'.join(svg),encoding='utf-8');image.save(output/f'metric-{index+1}.png')


def generate(manifest_path, output):
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('schemaVersion')!=1:
        raise ValueError('Unsupported report evidence manifest version.')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('Use a fresh output directory; existing artifacts are preserved.')
    verified=[]
    for source in manifest['sourceAnchors']:
        path=resolve_source(source['path'])
        if sha(path)!=source['sha256']:
            raise ValueError('Implementation/source anchor changed: '+source['path'])
        verified.append({'id':source['id'],'path':source['path'],'sha256':source['sha256'],'line':source.get('line'),'evidenceClass':source['evidenceClass']})
    rows=verify_results(manifest.get('measuredResults',[]))
    diagrams=manifest.get('diagrams',[])
    if len({d['id'] for d in diagrams})!=len(diagrams):raise ValueError('Duplicate figure ID.')
    for spec in diagrams:
        if not re.fullmatch('[a-z0-9][a-z0-9-]{0,79}',spec['id']):raise ValueError('Unsafe diagram ID.')
        if not all(isinstance(spec[k],int) and 100<=spec[k]<=2500 for k in ['width','height']):raise ValueError('Unsupported diagram dimensions.')
        if len(spec['nodes'])>30 or len(spec['edges'])>100:raise ValueError('Oversized diagram.')
        for node in spec['nodes']:
            if len(node['box'])!=4 or not all(isinstance(n,(int,float)) and math.isfinite(n) for n in node['box']):raise ValueError('Invalid node bounds.')
            x,y,w,h=node['box']
            if min(x,y,w,h)<0 or x+w>spec['width'] or y+h>spec['height']:raise ValueError('Node outside canvas.')
        for edge in spec['edges']:
            if len(edge['points'])<2 or any(len(point)!=2 or not all(isinstance(n,(int,float)) and math.isfinite(n) for n in point) for point in edge['points']):raise ValueError('Invalid edge geometry.')
    output.mkdir(parents=True,exist_ok=True)
    with (output/'verified-evidence.csv').open('w',newline='',encoding='utf-8') as handle:
        writer=csv.DictWriter(handle,fieldnames=['id','path','sha256','line','evidenceClass']);writer.writeheader();writer.writerows(verified)
    if rows:write_metric_figures(rows,output)
    with (output/'measured-results.csv').open('w',newline='',encoding='utf-8') as handle:
        fields=['id','metric','value','unit','evidenceClass','evidencePath','evidenceSha256','jsonPointer']
        writer=csv.DictWriter(handle,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(rows)
    lines=['# Generated evidence status','',f'Verified {len(verified)} file/hash anchors. Measured result rows: {len(rows)}.','', 'File identity and provenance metadata do not independently establish scientific correctness.']
    if not rows:lines+=['','Measured comparison tables and figures: PENDING. No zero values or experimental conclusions were generated.']
    for spec in manifest.get('diagrams',[]):
        write_diagram(spec,output/spec['id'])
        lines+=['',f'Diagram: {spec["id"]}. Implementation illustration, not an experimental result.']
    (output/'status.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (output/'generation-receipt.json').write_text(json.dumps({'manifestSha256':sha(manifest_path),'sourceAnchorCount':len(verified),'measuredResultCount':len(rows),'diagrams':[d['id'] for d in manifest.get('diagrams',[])]},indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    generate(args.manifest,args.out)
