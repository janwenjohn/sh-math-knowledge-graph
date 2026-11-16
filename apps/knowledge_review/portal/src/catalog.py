"""Shared knowledge contract validation."""
import hashlib

# 公开数据只保留语义字段；含内部取证或私有来源指向的键一律拒绝。
RESERVED_KEYS = {'_internal', '_private', '_draft'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest_matches(raw, expected):
    """True when raw hashes to expected as-is or after LF/CRLF normalization.

    Git checks text out with CRLF on Windows under core.autocrlf; both spellings of the
    same document must satisfy a digest pinned from the other spelling.
    """
    lf = raw.replace(b'\r\n', b'\n')
    return any(hashlib.sha256(value).hexdigest() == expected for value in (raw, lf, lf.replace(b'\n', b'\r\n')))


def validate(data):
    ids = [p['id'] for p in data['points']]
    require(len(ids) == len(set(ids)), '知识点 ID 重复')
    contexts = {c['id'] for c in data.get('contexts', [])}
    objects = list(ids)
    for p in data['points']:
        for e in p.get('elements', []):
            objects.append(e['id'])
            require(set(e.get('contextIds', [])) <= contexts, '关联背景缺失')
        objects.extend(m['id'] for m in p.get('mastery', []))
    require(len(objects) == len(set(objects)), '知识对象 ID 重复')
    relids = [r['id'] for r in data['relations']]
    require(len(relids) == len(set(relids)), '关系 ID 重复')
    for r in data['relations']:
        require(r['fromId'] in ids and r['toId'] in ids, '关系端点缺失')
    groups = {x['id'] for x in data['groups']}
    subs = {x['id'] for x in data['subgroups']}
    seqs = {x['id'] for x in data['sequences']}
    topics = {x['id'] for x in data['topics']}
    require(all(x['groupId'] in groups for x in data['subgroups']), '单元缺失')
    require(all(x['subgroupId'] in subs for x in data['sequences']), '子单元缺失')
    require(all(set(p.get('sequenceIds', [])) <= seqs and p['topicId'] in topics for p in data['points']), '知识目录引用缺失')
    def walk(value):
        if isinstance(value, dict):
            require(not (RESERVED_KEYS & value.keys()), 'Public 含私有字段')
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(data)
    return {'points': len(ids), 'relations': len(relids), 'elements': sum(len(p.get('elements', [])) for p in data['points']), 'mastery': sum(len(p.get('mastery', [])) for p in data['points']), 'contexts': len(contexts)}
