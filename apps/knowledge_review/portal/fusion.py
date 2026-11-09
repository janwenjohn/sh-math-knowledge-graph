"""Read-only fusion read-model between a registered 6A graph version and the syllabus trial graph.

Nothing here writes business data. Every projection is derived at request time from the two
registered Public files plus the two authored side tables, and is validated against the SHA-256
of the served 6A Public file. A hash mismatch disables fusion and the caller falls back to the
plain 6A experience (no partial or stale projection is ever returned).
"""
import hashlib
import json
from pathlib import Path
import re

GRAPH = Path(__file__).resolve().parents[3] / 'content' / 'knowledge_graph'
SYLLABUS_DIR = GRAPH / '1.数学' / '考纲'
INTEGRATION = SYLLABUS_DIR / 'syllabus_g6a_integration_v01.json'
EXAMPLES = SYLLABUS_DIR / 'syllabus_g6a_examples_v01.json'
SYLLABUS_PUBLIC = SYLLABUS_DIR / 'math_syllabus_public_v03.json'
MAPPINGS = SYLLABUS_DIR / 'math_syllabus_g6a_mappings_v03.json'

# Readable wording for the cross-library edge. Never collapses into "前置知识".
RELATION_LABEL = {
    'INLINE_EXTENSION': '考纲在同一知识点上补充',
    'RELATED_ONLY': '考纲的相关知识',
}
MODE_LABEL = {'INLINE_EXTENSION': '考纲扩展', 'RELATED_ONLY': '相关考纲知识'}
SOURCE_LABEL = '考纲'
# 范围说明末句固定记录考纲口径；书名号以转义书写，源码不出现具体文献名称。
SCOPE_DISCLAIMER = re.compile('本段为\u300a?[^\u3002]*\u300b?的考纲口径，不等于六上现行考试要求\u3002')


def display_scope(note):
    return SCOPE_DISCLAIMER.sub('', note).strip()


def sha_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def digest_matches(raw, expected):
    """Same text under LF or CRLF must satisfy a digest pinned from either spelling."""
    lf = raw.replace(b'\r\n', b'\n')
    return any(sha_bytes(value) == expected for value in (raw, lf, lf.replace(b'\n', b'\r\n')))


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


class Fusion:
    """One immutable, hash-checked fusion projection."""

    def __init__(self):
        self.available = False
        self.reason = '融合侧表尚未生成'
        self.integration = None
        self.examples = None
        self.syllabus = None
        self.by_target = {}
        self.by_source = {}
        self.point_flags = {}
        self.category_flags = {}

    # -- loading ---------------------------------------------------------
    def load(self, target_digest, target_dataset, target_version, target_digests=None):
        if not INTEGRATION.exists():
            self.reason = '融合决策侧表不存在'
            return self
        try:
            side = read(INTEGRATION)
        except (ValueError, OSError):
            self.reason = '融合决策侧表无法解析'
            return self
        meta = side.get('meta') or {}
        target = meta.get('target') or {}
        accepted = set(target_digests or ()) | {target_digest}
        if target.get('publicSha256') not in accepted:
            self.reason = '融合侧表与当前知识版本摘要不配对，已回退到 6A 基础视图'
            return self
        if (target.get('datasetId'), target.get('version')) != (target_dataset, target_version):
            self.reason = '融合侧表指向的 6A 版本与当前知识集不配对'
            return self
        if not SYLLABUS_PUBLIC.exists():
            self.reason = '考纲 Public 文件缺失'
            return self
        raw = SYLLABUS_PUBLIC.read_bytes()
        if not digest_matches(raw, (meta.get('source') or {}).get('publicSha256')):
            self.reason = '考纲 Public 文件已变化，融合侧表需要重建'
            return self
        syllabus = json.loads(raw)
        if not MAPPINGS.exists() or not digest_matches(MAPPINGS.read_bytes(), (meta.get('mapping') or {}).get('sha256')):
            self.reason = '考纲→6A 映射文件已变化，融合侧表需要重建'
            return self

        self.integration = side
        self.syllabus = syllabus
        self.points = {p['id']: p for p in syllabus['points']}
        self.topics = syllabus['topics']
        for record in side['records']:
            key = record['target']['pointId']
            self.by_target.setdefault(key, []).append(record)
            self.by_source.setdefault(record['source']['pointId'], []).append(record)
            flags = self.point_flags.setdefault(key, {'hasSyllabusReference': False, 'hasSyllabusInlineExtension': False,
                                                      'syllabusPointCount': 0, 'syllabusPointIds': []})
            if record['displayable']:
                flags['hasSyllabusReference'] = True
                flags['syllabusPointCount'] += 1
                flags['syllabusPointIds'].append(record['source']['pointId'])
            if record['displayable'] and record['hasInlineExtension']:
                flags['hasSyllabusInlineExtension'] = True
        self.examples = self._load_examples(target_digest)
        self.available = True
        self.reason = ''
        return self

    def _load_examples(self, target_digest):
        if not EXAMPLES.exists():
            return None
        try:
            data = read(EXAMPLES)
        except (ValueError, OSError):
            return None
        hashes = (data.get('meta') or {}).get('inputHashes') or {}
        if hashes.get('6aPublic') != target_digest or not digest_matches(INTEGRATION.read_bytes(), hashes.get('integration')):
            return None
        return data

    # -- helpers ---------------------------------------------------------
    def _elements(self, record, include_hidden=False):
        point = self.points.get(record['source']['pointId'])
        if not point:
            return []
        wanted = record['syllabusElementIds']
        out = []
        for element in point['elements']:
            if element['id'] not in wanted:
                continue
            if element.get('displayStatus') == 'HIDDEN_DUPLICATE' and not include_hidden:
                continue
            out.append({k: element.get(k) for k in ('id', 'type', 'title', 'body', 'order', 'reviewStatus')})
        return out

    def _mastery(self, record):
        point = self.points.get(record['source']['pointId'])
        if not point:
            return []
        wanted = record['syllabusMasteryIds']
        return [{k: m.get(k) for k in ('id', 'action', 'statement')} for m in point['mastery'] if m['id'] in wanted]

    def status(self):
        counts = {}
        if self.available:
            for record in self.integration['records']:
                counts[record['integrationMode']] = counts.get(record['integrationMode'], 0) + 1
        return {
            'available': self.available,
            'reason': self.reason,
            'schemaVersion': ((self.integration or {}).get('meta') or {}).get('schemaVersion'),
            'version': ((self.integration or {}).get('meta') or {}).get('version'),
            'reviewStatus': ((self.integration or {}).get('meta') or {}).get('reviewStatus'),
            'publicationStatus': ((self.integration or {}).get('meta') or {}).get('publicationStatus'),
            'sourceLabel': SOURCE_LABEL,
            'sourceIdentity': ((self.integration or {}).get('meta') or {}).get('sourceIdentity') or '上海初中数学学科教学要求',
            'sourceIdentityNote': '',
            'modeCounts': counts,
            'pointsWithReference': len(self.point_flags),
            'pointsWithInlineExtension': sum(1 for f in self.point_flags.values() if f['hasSyllabusInlineExtension']),
            'records': len(self.integration['records']) if self.available else 0,
            'examples': self._example_status(),
        }

    def _example_status(self):
        if not self.examples:
            return {'available': False}
        meta = self.examples['meta']
        return {'available': True, 'resourceId': meta['resourceId'], 'title': meta['title'],
                'counts': meta['counts'], 'publicationStatus': meta['publicationStatus']}

    def catalog(self, g6a_public):
        """Per-point flags plus true ancestor aggregation for groups/subgroups/sequences/topics."""
        if not self.available:
            return {'available': False, 'reason': self.reason}
        flags = {pid: dict(v) for pid, v in self.point_flags.items()}
        by_seq = {}
        for point in g6a_public['points']:
            for sid in point.get('sequenceIds', []):
                by_seq.setdefault(sid, []).append(point['id'])
        sequences, subgroups, groups, topics = {}, {}, {}, {}
        for seq in g6a_public['sequences']:
            ids = by_seq.get(seq['id'], [])
            sequences[seq['id']] = any(flags.get(i, {}).get('hasSyllabusReference') for i in ids)
        for sub in g6a_public['subgroups']:
            ids = [s['id'] for s in g6a_public['sequences'] if s['subgroupId'] == sub['id']]
            subgroups[sub['id']] = any(sequences.get(i) for i in ids)
        for group in g6a_public['groups']:
            ids = [s['id'] for s in g6a_public['subgroups'] if s['groupId'] == group['id']]
            groups[group['id']] = any(subgroups.get(i) for i in ids)
        children = {}
        for topic in g6a_public['topics']:
            children.setdefault(topic.get('parentId'), []).append(topic['id'])

        def topic_flag(tid, seen=None):
            seen = seen or set()
            if tid in topics:
                return topics[tid]
            if tid in seen:
                return False
            seen.add(tid)
            direct = any(flags.get(p['id'], {}).get('hasSyllabusReference') for p in g6a_public['points'] if p['topicId'] == tid)
            value = direct or any(topic_flag(c, seen) for c in children.get(tid, []))
            topics[tid] = value
            return value

        for topic in g6a_public['topics']:
            topic_flag(topic['id'])
        extended = {r['source']['pointId'] for r in self.integration['records']
                    if r['displayable'] and r['hasInlineExtension']}
        independent = [p for p in self.syllabus['points'] if p['id'] not in extended]
        added_topics = [dict(t, pointCount=sum(p['topicId'] == t['id'] for p in independent))
                        for t in self.topics if any(p['topicId'] == t['id'] for p in independent)]
        return {'available': True, 'reason': '', 'points': flags,
                'addedTopics': added_topics,
                'independentPoints': [{k: p.get(k) for k in ('id','name','lead','topicId')} for p in independent],
                'groups': groups, 'subgroups': subgroups, 'sequences': sequences, 'topics': topics,
                'sourceLabel': SOURCE_LABEL}

    def syllabus_point(self, point_id):
        point = self.points.get(point_id) if self.available else None
        if not point:
            return None
        result = dict(point)
        result['elements'] = [e for e in point['elements'] if e.get('displayStatus') != 'HIDDEN_DUPLICATE']
        return result


    def point(self, point_id, include_hidden=False):
        if not self.available:
            return {'available': False, 'reason': self.reason}
        records = self.by_target.get(point_id, [])
        extensions, related = [], []
        for record in records:
            if not record['displayable']:
                continue
            item = {
                'integrationId': record['integrationId'],
                'mode': record['integrationMode'],
                'modeLabel': MODE_LABEL.get(record['integrationMode'], record['integrationMode']),
                'sourceLabel': record['publicLabel'],
                'syllabusPointId': record['source']['pointId'],
                'syllabusPointName': record['source']['pointName'],
                'syllabusDatasetId': record['source']['datasetId'],
                'syllabusVersion': record['source']['version'],
                'relationLabel': RELATION_LABEL.get(record['integrationMode'], '考纲的相关知识'),
                'relationType': record['sourceRelationType'],
                'differenceSummary': record['differenceSummary'],
                'scopeNote': display_scope(record['scopeNote']),
                'mappingIds': record['sourceMappingIds'],
                'elementCount': len(record['syllabusElementIds']),
            }
            if record['hasInlineExtension']:
                item['elements'] = self._elements(record, include_hidden)
                item['mastery'] = self._mastery(record)
                item['hiddenElementIds'] = [e for e in record['syllabusElementIds']
                                            if e not in {x['id'] for x in item['elements']}]
                extensions.append(item)
            else:
                item['elements'] = self._elements(record, include_hidden)
                related.append(item)
        return {'available': True, 'reason': '', 'pointId': point_id,
                'hasSyllabusInlineExtension': bool(extensions),
                'hasSyllabusReference': bool(extensions or related),
                'extensions': extensions, 'related': related,
                'sourceLabel': SOURCE_LABEL,
                'sourceIdentity': ((self.integration or {}).get('meta') or {}).get('source', {}).get('datasetId')}

    def relations(self, mode=None):
        if not self.available:
            return {'available': False, 'reason': self.reason, 'edges': []}
        edges = []
        for record in self.integration['records']:
            if not record['displayable']:
                continue
            if mode and record['integrationMode'] != mode:
                continue
            edges.append({
                'id': record['integrationId'],
                'datasetId': 'cross',
                'kind': 'cross',
                'fromDataset': record['source']['datasetId'],
                'fromVersion': record['source']['version'],
                'fromId': record['source']['pointId'],
                'fromLabel': record['source']['pointName'],
                'toDataset': record['target']['datasetId'],
                'toVersion': record['target']['version'],
                'toId': record['target']['pointId'],
                'toLabel': record['target']['pointName'],
                'integrationMode': record['integrationMode'],
                'modeLabel': MODE_LABEL.get(record['integrationMode'], record['integrationMode']),
                'relationType': record['sourceRelationType'],
                'label': RELATION_LABEL.get(record['integrationMode'], '考纲的相关知识'),
                'explanation': record['differenceSummary'],
                'scopeNote': display_scope(record['scopeNote']),
                'sourceLabel': record['publicLabel'],
            })
        return {'available': True, 'reason': '', 'edges': edges, 'counts': {'cross': len(edges)}}

    def syllabus_internal_relations(self, point_ids):
        if not self.available:
            return []
        wanted = set(point_ids)
        return [r for r in self.syllabus['relations'] if r['fromId'] in wanted and r['toId'] in wanted]

    def graph(self, g6a_public, mode='fused', focus=None, depth=1, type_filter=None):
        """base/fused/syllabus views. Node identity is (datasetId, pointId); cross edges keep mapping ids."""
        if mode == 'base' or not self.available:
            return {'available': mode == 'base' or self.available, 'mode': 'base',
                    'reason': '' if mode == 'base' else self.reason,
                    'nodes': [], 'edges': []}
        points = {p['id']: p for p in g6a_public['points']}
        internal = [r for r in g6a_public['relations'] if not type_filter or r['type'] == type_filter]
        keep = set(points)
        if focus in points:
            neighbours = {focus}
            for _ in range(max(1, min(3, depth))):
                step = {e['fromId'] for e in internal if e['fromId'] in neighbours or e['toId'] in neighbours}
                step |= {e['toId'] for e in internal if e['fromId'] in neighbours or e['toId'] in neighbours}
                neighbours |= step
            keep = neighbours
        nodes = [{'id': p['id'], 'datasetId': 'math-g6a', 'kind': 'g6a', 'label': p['name'],
                  'topicId': p['topicId'],
                  'hasSyllabusReference': self.point_flags.get(p['id'], {}).get('hasSyllabusReference', False),
                  'hasSyllabusInlineExtension': self.point_flags.get(p['id'], {}).get('hasSyllabusInlineExtension', False)}
                 for pid, p in points.items() if pid in keep]
        edges = [{'id': e['id'], 'datasetId': 'math-g6a', 'kind': 'g6a', 'fromId': e['fromId'], 'toId': e['toId'],
                  'type': e['type'], 'label': None, 'explanation': e.get('explanation', '')}
                 for e in internal if e['fromId'] in keep and e['toId'] in keep]
        shown_syllabus = set()
        seen_nodes = {(n['datasetId'], n['id']) for n in nodes}
        seen_edges = {e['id'] for e in edges}
        for record in self.integration['records']:
            if not record['displayable'] or record['target']['pointId'] not in keep:
                continue
            sid = record['source']['pointId']
            shown_syllabus.add(sid)
            # one node per (datasetId, pointId): the same syllabus point may attach to several
            # 6A points inside the same subgraph and must not be duplicated.
            if (record['source']['datasetId'], sid) not in seen_nodes:
                seen_nodes.add((record['source']['datasetId'], sid))
                nodes.append({'id': sid, 'datasetId': record['source']['datasetId'], 'kind': 'syllabus',
                              'label': record['source']['pointName'], 'topicId': None,
                              'hasSyllabusReference': False, 'hasSyllabusInlineExtension': record['hasInlineExtension']})
            if record['integrationId'] in seen_edges:
                continue
            seen_edges.add(record['integrationId'])
            edges.append({'id': record['integrationId'], 'datasetId': 'cross', 'kind': 'cross',
                          'fromDataset': record['source']['datasetId'], 'fromId': sid,
                          'toDataset': record['target']['datasetId'], 'toId': record['target']['pointId'],
                          'type': record['sourceRelationType'], 'integrationMode': record['integrationMode'],
                          'label': RELATION_LABEL.get(record['integrationMode']),
                          'explanation': record['differenceSummary']})
        if mode == 'syllabus':
            for relation in self.syllabus_internal_relations(shown_syllabus):
                edges.append({'id': relation['id'], 'datasetId': self.syllabus['meta']['datasetId'],
                              'kind': 'syllabus', 'fromId': relation['fromId'], 'toId': relation['toId'],
                              'type': relation['type'], 'label': None, 'explanation': relation.get('explanation', '')})
        return {'available': True, 'mode': mode, 'reason': '',
                'counts': {'g6aNodes': sum(1 for n in nodes if n['kind'] == 'g6a'),
                           'syllabusNodes': sum(1 for n in nodes if n['kind'] == 'syllabus'),
                           'g6aEdges': sum(1 for e in edges if e['kind'] == 'g6a'),
                           'crossEdges': sum(1 for e in edges if e['kind'] == 'cross'),
                           'syllabusEdges': sum(1 for e in edges if e['kind'] == 'syllabus')},
                'nodes': nodes, 'edges': edges}


_CACHE = {}


def get(digest):
    """One projection per served Public digest; a new digest rebuilds from scratch."""
    if digest in _CACHE:
        return _CACHE[digest]
    return None


def build(digest, dataset, version, digests=None):
    fusion = Fusion().load(digest, dataset, version, digests)
    _CACHE.clear()
    _CACHE[digest] = fusion
    return fusion


def examples_decisions():
    """Public-safe decision view for the practice adapter and admin preview."""
    if not EXAMPLES.exists():
        return None
    return read(EXAMPLES)


def asset_root():
    return Path(__file__).resolve().parents[3] / 'content' / 'question_bank' / 'official' / '1.数学' / '考纲' / 'assets'
