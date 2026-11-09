"""Read-only practice adapter for a sealed release projection."""
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlencode

from catalog import digest_matches

ROOT = Path(__file__).resolve().parents[3]
BANK = ROOT / 'content/question_bank'
GRAPH = ROOT / 'content/knowledge_graph'
# 例题 is not a graded tier: the syllabus resource is ungraded, so it sorts after the three
# graded levels and never participates in random paper composition.
DIFFICULTIES = ('基础题', '进阶', '高阶', '例题')
GRADED = DIFFICULTIES[:3]
ROLES = {'DIRECT_ASSESSMENT': '直接考查', 'PREREQUISITE_APPLICATION': '前置应用', 'EXTENSION_APPLICATION': '拓展应用'}


def question_category(q):
    """Conservative grouping from supplied type and explicit question wording."""
    kind = q.get('type', '')
    stem = q.get('stem', '').strip()
    if q.get('options') or '选择题' in kind:
        return '选择题'
    if '填空题' in kind:
        return '填空题'
    if re.match(r'^(计算|化简|求值|解方程|解下列方程|求下列各式的值)', stem) or '计算' in kind or '简便运算' in kind:
        return '计算题'
    if any(x in kind for x in ('解答题', '简答题', '综合实践', '应用')):
        return '应用／其他解答题'
    return None


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def display_label(value, book_id=None, section=False):
    """Presentation label; the release projection already carries neutral wording."""
    value = value or ""
    if section:
        value = re.sub(r"^\d+\.\d+(?:\(\d+\))?\s*", "", value)
        value = re.sub(r"\s*第(\d+)课时", r"\1", value)
        value = re.sub(r"\((\d+)\)$", r"\1", value)
    return value.strip()


class Practice:
    def __init__(self, dataset, version, digest, point_ids, resources=None):
        self.books, self.questions, self.assets = [], {}, {}
        self.resourceStatus = {'available': False, 'reason': '尚未加载'}
        # 知识 Public 的换行形态不改变内容；关联文件锁定的是内容摘要。
        row_digests = {digest}
        row = resources.get(dataset, version) if resources else None
        row_digests |= set(row.get('digests', ())) if row else set()
        paths = resources.practice_paths(dataset, version) if resources else sorted(GRAPH.rglob('book_*_question_knowledge_v*.json'))
        for linkfile in paths:
            links = read(linkfile)
            meta = links['meta']
            if (meta['knowledge_dataset_id'], meta['knowledge_version']) != (dataset, version):
                continue
            if meta['knowledge_public_sha256'] not in row_digests:
                raise ValueError('练习关联与当前知识版本不匹配，请核对数据版本')
            source = (ROOT / meta['source_file']).resolve()
            if not source.is_relative_to(BANK.resolve()):
                raise ValueError('练习来源路径不合法')
            raw = source.read_bytes()
            if not digest_matches(raw, meta['source_sha256']):
                raise ValueError('练习源文件已变化，关联需要重新核验')
            data = json.loads(raw)
            bid = str(meta['book_id'])
            difficulty_file = (ROOT / meta['difficulty_file']).resolve() if meta.get('difficulty_file') else source.with_name(f'book_{bid}_question_difficulty_{meta["version"]}.json')
            if not difficulty_file.is_relative_to(BANK.resolve()):
                raise ValueError('难度来源路径不合法')
            difficulty = read(difficulty_file)
            if not digest_matches(raw, difficulty['meta']['source_sha256']):
                raise ValueError('难度标签与题目版本不匹配')
            labels = {r['question_id']: r['difficulty'] for r in difficulty['questions']}
            qids = {q['id'] for q in data['questions']}
            if len(labels) != len(difficulty['questions']) or labels.keys() != qids or not set(labels.values()) <= set(DIFFICULTIES):
                raise ValueError('练习难度标签缺失或重复')
            mapped = {}
            seen = set()
            for r in links['links']:
                key = (r['question_id'], r['knowledge_id'])
                if key in seen or r['question_id'] not in qids or r['knowledge_id'] not in point_ids or str(r['book_id']) != bid:
                    raise ValueError('练习知识关联主键校验失败')
                seen.add(key)
                mapped.setdefault(r['question_id'], []).append({'id': r['knowledge_id'], 'name': r['knowledge_name'], 'role': r['relation_type'], 'roleLabel': ROLES[r['relation_type']]})
            if mapped.keys() != qids:
                raise ValueError('存在缺失知识关联的题目')
            asset_urls = {}
            locked_assets = read(ROOT / meta['asset_manifest'])['files'] if meta.get('asset_manifest') else None
            for i, asset in enumerate(data.get('images', [])):
                file = (source.parent / asset['file']).resolve()
                if not file.is_relative_to(source.parent.resolve()) or file.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp') or not file.is_file():
                    raise ValueError('题目图片缺失或路径不合法')
                if locked_assets is not None and hashlib.sha256(file.read_bytes()).hexdigest() != locked_assets.get(asset['file']):
                    raise ValueError('配图摘要与锁定版本不一致')
                token = f'{bid}-{i}'
                self.assets[token] = file
                asset_urls[asset['file']] = '/api/practice/image?' + urlencode({'dataset': dataset, 'version': version, 'asset': token})
            chapters = []
            question_by_id = {q['id']: q for q in data['questions']}
            location = {}
            seen_qids = set()
            for ci, chapter in enumerate(data['chapters']):
                sections = []
                for si, sec in enumerate(chapter['sections']):
                    groups = {}
                    for qid in sec['question_ids']:
                        if qid not in question_by_id or qid in seen_qids:
                            raise ValueError('题目目录引用重复或不存在')
                        seen_qids.add(qid)
                        group = question_by_id[qid].get('group') or ''
                        groups.setdefault(group, []).append(qid)
                    split = len(groups) > 1
                    if not split:
                        groups = {'': sec['question_ids']}
                    for gi, (group, ids) in enumerate(groups.items()):
                        sid = f'{ci}:{si}:{gi}' if split else f'{ci}:{si}'
                        name = display_label(group or sec['title'], bid, section=True)
                        sections.append({'id': sid, 'name': name, 'count': len(ids)})
                        for qid in ids:
                            location[qid] = (str(ci), sid, name, display_label(chapter['title'], bid))
                chapters.append({'id': str(ci), 'name': display_label(chapter['title'], bid), 'sections': sections})
            if any(b['id'] == bid for b in self.books):
                raise ValueError('同一题集存在多份关联版本，请明确当前版本')
            self.books.append({'id': bid, 'name': data['book']['name'], 'count': len(qids), 'chapters': chapters})
            for q in data['questions']:
                key = f'{bid}:{q["id"]}'
                if key in self.questions or q['id'] not in location:
                    raise ValueError('题目主键或目录索引不合法')
                figures = [{'ref': f['file'], 'url': asset_urls[f['file']], 'caption': f.get('caption', '题目配图'), 'kind': f.get('kind', 'figure')} for f in q.get('figures', [])]
                paper = {k: q.get(k, '') for k in ('id', 'ordinal', 'chapter', 'section', 'group', 'type', 'number', 'title', 'stem', 'options', 'subquestions')}
                chapter_id, section_id, section_name, chapter_name = location[q['id']]
                paper.update(chapter=chapter_name, section=section_name, group=display_label(q.get('group', ''), bid, section=True), type=display_label(q.get('type', ''), bid), number=display_label(str(q.get('number', '')), bid), title=display_label(q.get('title', ''), bid), key=key, book=bid, bookName=data['book']['name'], chapterId=chapter_id, sectionId=section_id, difficulty=labels[q['id']], links=mapped[q['id']], figures=figures, category=question_category(q))
                answer = {k: q.get(k, '') for k in ('answer', 'answer_by_blank', 'solution')}
                label = re.fullmatch(r'\s*\$?([A-D])\$?\s*[。.]?\s*', q.get('answer', ''))
                answer['choice'] = label[1] if label and label[1] in {o['label'] for o in q.get('options', [])} else None
                answer['available'] = bool(q.get('answer') or q.get('answer_by_blank') or q.get('solution'))
                self.questions[key] = (paper, answer)
        if resources is None or resources.manifest['edition'] == 'owner':
            import syllabus_examples
            syllabus_examples.attach(self, dataset, version, digest)

    def query(self, q):
        rows = [p for p, _ in self.questions.values()]
        for param, field in (('book', 'book'), ('chapter', 'chapterId'), ('difficulty', 'difficulty')):
            if q.get(param):
                rows = [p for p in rows if p[field] == q[param]]
        if q.get('section'):
            rows = [p for p in rows if p['sectionId'] == q['section'] or p['sectionId'].startswith(q['section'] + ':')]
        if q.get('point') or q.get('points'):
            point_ids = set(q.get('points', q.get('point', '')).split(','))
            rows = [p for p in rows if any(l['id'] in point_ids and (q.get('role') == 'all' or l['role'] == 'DIRECT_ASSESSMENT') for l in p['links'])]
        if q.get('q'):
            needle = q['q'].strip().casefold()
            rows = [p for p in rows if needle in (p['stem'] + p['id'] + p['section'] + ' '.join(l['name'] for l in p['links'])).casefold()]
        order = q.get('sort', 'asc')
        if order not in ('asc', 'desc'):
            raise ValueError('难度排序选项无效')
        graded = [p for p in rows if p['difficulty'] in GRADED]
        other = [p for p in rows if p['difficulty'] not in GRADED]
        graded.sort(key=lambda p: DIFFICULTIES.index(p['difficulty']), reverse=order == 'desc')
        # Ungraded material keeps a stable tail position in both directions: it has no difficulty
        # rank, so ranking it (or ranking it away) would misrepresent the source.
        rows = graded + other
        if q.get('pool') == '1':
            return {'items': [{'key': p['key'], 'difficulty': p['difficulty'], 'category': p['category'], 'name': p['bookName']+' · '+(p['group'] or p['section'])+' · '+p['number']+'题'} for p in rows], 'total': len(rows)}
        if q.get('ids') == '1':
            return {'keys': [p['key'] for p in rows], 'total': len(rows)}
        page = max(1, int(q.get('page', 1)))
        size = min(100, max(1, int(q.get('size', 20))))
        page = min(page, max(1, (len(rows) + size - 1) // size))
        return {'items': rows[(page - 1) * size:page * size], 'total': len(rows), 'page': page, 'size': size}


def handle(handler, path, q):
    # Candidate annotations are not approved for the public service, even for an admin.
    if not handler.server.preview:
        return handler.reply({'error': '配套练习目前仅在本机候选预览中开放'}, 403)
    row = handler.server.store.get(q.get('dataset', ''), q.get('version', ''))
    if not row:
        return handler.reply({'error': '知识版本不存在'}, 404)
    cache_key = (row['dataset'], row['version'], row['digest'])
    with handler.server.lock:
        cache = handler.server.practice_cache
        if cache_key not in cache:
            cache[cache_key] = Practice(*cache_key, {p['id'] for p in json.loads(row['public'])['points']}, resources=getattr(handler.server, 'resources', None))
        practice = cache[cache_key]
    if path == '/api/practice/books':
        return handler.reply({'books': practice.books, 'total': len(practice.questions), 'candidate': True,
                              'levels': list(DIFFICULTIES), 'gradedLevels': list(GRADED),
                              'resource': practice.resourceStatus})
    if path == '/api/practice/questions':
        return handler.reply(practice.query(q))
    if path in ('/api/practice/question', '/api/practice/answer'):
        item = practice.questions.get(q.get('key'))
        return handler.reply(item[path.endswith('/answer')]) if item else handler.reply({'error': '题目不存在'}, 404)
    if path == '/api/practice/image':
        file = practice.assets.get(q.get('asset'))
        if file:
            return handler.file_reply(file)
    return handler.reply({'error': '练习资源不存在'}, 404)
