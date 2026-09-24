import json, glob, os, random, sys, types
sys.modules['bert_score'] = types.SimpleNamespace(score=None)
sys.path.insert(0, '/tmp/claude-0/bench/locomo/task_eval')
import evaluation as ev
data = json.load(open('/tmp/claude-0/bench/locomo/data/locomo10.json'))
ans = {}
for f in glob.glob('/tmp/claude-0/trial/answers/*.jsonl'):
    arm = os.path.basename(f).split('-')[0]
    for l in open(f):
        if l.strip():
            a = json.loads(l); ans[(arm, a['id'])] = a['answer']
key = json.load(open('/tmp/claude-0/trial/judge_key.json'))
verd = {}
for f in glob.glob('/tmp/claude-0/trial/verdicts/*.jsonl'):
    for l in open(f):
        if l.strip():
            v = json.loads(l); verd[v['id']] = v['label'].upper() == 'CORRECT'
judge = {(k['arm'], k['qid']): verd[j] for j, k in key.items() if j in verd}
sample = json.load(open('/tmp/claude-0/trial/sample.json'))
CAT = {1: 'multi-hop', 2: 'temporal', 3: 'open-domain', 4: 'single-hop'}
def f1(arm, qid):
    conv, qi = qid.split('_q'); qa = data[int(conv[4:])]['qa'][int(qi)]
    return ev.eval_question_answering([{'answer': qa['answer'], 'category': qa['category'], 'prediction': ans[(arm, qid)], 'evidence': []}], 'prediction')[0][0], qa['category']
import io, contextlib
rows = []
with contextlib.redirect_stdout(io.StringIO()):
    for q in sample:
        fh, cat = f1('hippo', q); fb, _ = f1('bm25', q)
        rows.append({'qid': q, 'cat': cat, 'f1_h': fh, 'f1_b': fb, 'j_h': judge.get(('hippo', q)), 'j_b': judge.get(('bm25', q))})
def boot(d):
    random.seed(1); n = len(d); m = sorted(sum(random.choice(d) for _ in range(n)) / n for _ in range(4000))
    return sum(d) / n, m[100], m[3899]
def report(label, key_h, key_b, subset):
    r = [x for x in subset if x[key_h] is not None and x[key_b] is not None]
    if not r: return
    h = sum(x[key_h] for x in r) / len(r); b = sum(x[key_b] for x in r) / len(r)
    d, lo, hi = boot([float(x[key_h]) - float(x[key_b]) for x in r])
    print(f'{label:<28} n={len(r):<4} hippo {100*h:5.1f}  bm25 {100*b:5.1f}  diff {100*d:+.1f} [{100*lo:+.1f}, {100*hi:+.1f}]')
report("Authors' F1, all", 'f1_h', 'f1_b', rows)
report('Judge accuracy, all', 'j_h', 'j_b', rows)
for c in (4, 1, 2, 3):
    sub = [x for x in rows if x['cat'] == c]
    report(f"  F1 {CAT[c]}", 'f1_h', 'f1_b', sub)
    report(f"  judge {CAT[c]}", 'j_h', 'j_b', sub)
print('judge verdicts available:', len(judge), 'of 800')
