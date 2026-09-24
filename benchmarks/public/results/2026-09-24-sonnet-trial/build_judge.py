import json, glob, random, sys, os
sys.path.insert(0, '/tmp/claude-0/bench/memory-benchmarks')
from benchmarks.locomo.prompts import get_judge_prompt, preprocess_answer, JUDGE_SYSTEM_PROMPT
Q = {}
for f in glob.glob('/tmp/claude-0/bench/out-hippo/predicted_all-hippo/conv*_q*.json'):
    q = json.load(open(f)); Q[q['question_id']] = q
items = []
for f in sorted(glob.glob('/tmp/claude-0/trial/answers/*.jsonl')):
    arm = os.path.basename(f).split('-')[0]
    for line in open(f):
        line = line.strip()
        if not line: continue
        a = json.loads(line); q = Q[a['id']]
        gold = preprocess_answer(q['category'], str(q['ground_truth_answer']))
        items.append({'arm': arm, 'qid': a['id'], 'answer': a['answer'],
                      'prompt': JUDGE_SYSTEM_PROMPT + '\n\n' + get_judge_prompt(q['category'], q['question'], gold, a['answer'])})
random.seed(7); random.shuffle(items)
os.makedirs('/tmp/claude-0/trial/judge', exist_ok=True)
key = {}
for i, it in enumerate(items):
    jid = f'j{i:04d}'; key[jid] = {'arm': it['arm'], 'qid': it['qid'], 'answer': it['answer']}
    b = i // 200
    d = f'/tmp/claude-0/trial/judge/batch-{b}'; os.makedirs(d, exist_ok=True)
    open(f'{d}/{jid}.txt', 'w').write(it['prompt'])
json.dump(key, open('/tmp/claude-0/trial/judge_key.json', 'w'))
print(len(items), 'judge items in', (len(items) + 199) // 200, 'batches')
