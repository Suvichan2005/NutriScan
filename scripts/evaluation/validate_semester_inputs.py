"""Read-only evaluation preparation checks. Never invokes OCR, providers or image access."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def validate(source=None):
    c = json.loads((ROOT / 'data/evaluation/semester-conversations.json').read_text(encoding='utf-8'))
    e = json.loads((ROOT / 'data/evaluation/semester-experiments.json').read_text(encoding='utf-8'))
    assert c['evaluationOnly'] and e['evaluationOnly']
    assert c['status'] == e['status'] == 'PREPARATION_NOT_FINAL_FROZEN'
    cases = c['conversations']
    expected = {p + '-' + profile for p in 'MBA' for profile in ('D', 'H', 'DH')}
    assert len(cases) == 9 and {x['id'] for x in cases} == expected
    assert sum(len(x['turns']) for x in cases) == c['logicalUserTurns'] == 27
    for case in cases:
        assert [t['turn'] for t in case['turns']] == [1, 2, 3]
        assert case['packageSnapshot'] is None and case['humanRatings'] == []
        assert case['packageFactsStatus'] == 'pending-human-review'
        assert all(case[k] for k in ('reviewObligations', 'knownUnknowns', 'criticalFailures', 'continuity'))
        for t in case['turns']:
            assert hashlib.sha256(t['userText'].encode('utf-8')).hexdigest() == t['sourceTextSha256']
    arms = e['reconstruction']['arms']
    selections = [['tesseract-observations'], ['paddle-observations'], ['original-images'], ['tesseract-observations', 'original-images'], ['paddle-observations', 'original-images']]
    assert [a['id'] for a in arms] == list('ABCDE')
    for arm, selection in zip(arms, selections):
        assert arm['invokesGemini'] is True and arm['allowedInputs'] == selection
        assert not set(selection) & set(arm['forbiddenInputs'])
        assert {'human-reference-values', 'other-arm-results', 'hidden-image-descriptions'} <= set(arm['forbiddenInputs'])
        assert set(['tesseract-observations', 'paddle-observations', 'original-images']) - set(selection) <= set(arm['forbiddenInputs'])
    assert all(v is None for v in e['freeze'].values())
    requests = e['knowledgeAblation']['requests']
    assert len(requests) == 9 and {r['conversationId'] for r in requests} == expected
    assert all(r['turn'] == 1 and r['contextSnapshotSha256'] is None and r['baselineReceipt'] is None and r['knowledgeReceipt'] is None for r in requests)
    assert e['results'] is None
    assert all(v is None for v in e['humanReview']['blankRatingRow']['scores'].values())
    for artifact in e['reconstruction']['reuse'].values():
        assert (ROOT / artifact).is_file(), artifact
    roles=json.loads((ROOT/'data/semester-source-roles.json').read_text(encoding='utf-8'))
    coverage=json.loads((ROOT/'data/dataset-coverage.json').read_text(encoding='utf-8'))
    assert len({row['sourceId'] for row in roles['sourceRoles']})==len(roles['sourceRoles'])
    assert {row['sourceId'] for row in roles['sourceRoles']}=={row['id'] for row in coverage['sources']}
    assert all(row['role'] in {'CORE','SPECIALIZED','RESEARCH','DEFERRED EXPANSION'} for row in roles['sourceRoles'])
    assert roles['authority']['sha256']==c['provenance']['sourceSha256']
    queue=(ROOT/'docs/COMPLETION_QUEUE.md').read_text(encoding='utf-8')
    expected_ids={'A0-CALC','A1-EFSA-SCOPE','A2-EFSA-STORE','A3-EFSA','A1-SOURCES','A2-FOODON','A2-USDA','A2-OFF','A2-REGULATORY','A2-OTHER-SOURCES','A2-WHO-DOCUMENTS','A3-CROSS-SOURCE','B1-COLLECTION','B2-HUMAN-REFERENCES','C1-METHODS','C2-RESULTS','E1-MULTIMODAL','E2-RETRIEVAL','E3-CONVERSATION','P1-ROW-EDIT','P1-FEATURES','P1-RELEASE','R1-REPORT','E1-PERCEPTION-DEFAULT','E3-BROAD-ANSWER'}
    actual_ids=re.findall(r'^- \*\*([A-Z][A-Z0-9/-]*)\s',queue,re.M)
    assert expected_ids<=set(actual_ids) and len(actual_ids)==len(set(actual_ids))
    assert '\ufffd' not in queue
    fidelity = 'not-checked-source-not-supplied'
    if source:
        raw = Path(source).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == c['provenance']['sourceSha256'] == e['provenance']['sourceSha256']
        blocks = re.findall(r'^### ([MBA]-(?:DH|D|H)) — [^\r\n]+\r?\n(.*?)(?=^### |^## Conversation quality requirements)', raw.decode('utf-8-sig'), re.M | re.S)
        original = {ident: re.findall(r'\*\*Turn ([123])\*\*\s*\r?\n\s*“([^”]+)”', body) for ident, body in blocks}
        assert len(original) == 9
        for case in cases:
            assert [(str(t['turn']), t['userText']) for t in case['turns']] == original[case['id']]
        fidelity = '27-of-27-exact-owner-turns-and-source-sha256-match'
    return {'status': 'PASS', 'claimScope': 'preparation-structure-only', 'conversations': 9, 'logicalUserTurns': 27, 'geminiReconstructionArms': 5, 'pairedKnowledgeRequests': 9, 'sourceFidelity': fidelity, 'finalFreeze': 'PENDING', 'independentHumanReferences': 'PENDING', 'providerCalls': 0}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Original owner UTF-8 directive for exact text/hash comparison')
    args = parser.parse_args()
    print(json.dumps(validate(args.source), indent=2))
