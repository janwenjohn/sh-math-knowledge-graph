"""Read-only resources pinned by a release manifest; no owner capabilities."""
import hashlib
import json
from pathlib import Path
from catalog import digest_matches, require, validate

NOTICE = '内容由AI辅助分析或生成，可能存在错误或遗漏，请自行核实、审慎使用。'
# 用户可自行阅读和修改的说明文档不参与启动阻断：改一段 README 不应让发行包无法打开。
DOC_EXEMPT = {
    'README.md', 'CHANGELOG.md', 'KNOWN_ISSUES.md', 'LICENSE', 'CONTRIBUTING.md',
    '.gitignore', '.gitattributes', 'start.bat', 'start.sh', 'start.command',
}
DOC_EXEMPT_PREFIXES = ('.github/', 'docs/')


def is_doc_exempt(name: str) -> bool:
    return name in DOC_EXEMPT or name.startswith(DOC_EXEMPT_PREFIXES)


def digest_variants(raw: bytes) -> set:
    """Digests of the same text under its as-checked-out, LF and CRLF spellings."""
    lf = raw.replace(b'\r\n', b'\n')
    return {hashlib.sha256(value).hexdigest() for value in (raw, lf, lf.replace(b'\n', b'\r\n'))}


class Resources:
    def __init__(self, root, manifest):
        self.root = Path(root).resolve()
        self.manifest = manifest
        self.rows = {}
        self.models = {}
        for name, digest in manifest['files'].items():
            if is_doc_exempt(name):
                continue
            file = self.path(name)
            require(digest_matches(file.read_bytes(), digest), f'发行文件摘要不一致：{name}')
        for entry in manifest['datasets']:
            file = self.path(entry['public'])
            raw = file.read_bytes()
            data = json.loads(raw)
            validate(data)
            key = (data['meta']['datasetId'], data['meta']['version'])
            require(key not in self.rows, '发行清单包含重复知识版本')
            self.rows[key] = {'dataset': key[0], 'version': key[1], 'public': json.dumps(data, ensure_ascii=False),
                              'digest': hashlib.sha256(raw).hexdigest(), 'digests': digest_variants(raw), 'active': 1}
            if entry.get('fusion'):
                self.models[key] = FusionSnapshot(json.loads(self.path(entry['fusion']).read_bytes()))

    def path(self, name):
        require(isinstance(name, str) and not Path(name).is_absolute() and '..' not in Path(name).parts, '发行路径不合法')
        path = (self.root / name).resolve()
        require(path.is_relative_to(self.root), '发行路径越界')
        return path

    def get(self, dataset, version):
        return self.rows.get((dataset, version))

    def dataset_rows(self):
        return [(r['dataset'], r['version'], r['public'], 1) for r in self.rows.values()]

    def fusion(self, row):
        return self.models.get((row['dataset'], row['version']), FusionSnapshot({}))

    def practice_paths(self, dataset, version):
        return [self.path(p['links']) for p in self.manifest['practice']
                if (p['datasetId'], p['knowledgeVersion']) == (dataset, version)]


class FusionSnapshot:
    def __init__(self, data):
        self.data = data

    def status(self):
        return self.data.get('status', {'available': False, 'reason': '当前发行未包含融合内容'})

    def catalog(self, public):
        return self.data.get('catalog', {'available': False})

    def point(self, point_id, include_hidden=False):
        return self.data.get('points', {}).get(point_id, {'available': False})

    def syllabus_point(self, point_id):
        return self.data.get('syllabusPoints', {}).get(point_id)

    def relations(self, mode=None):
        edges = self.data.get('relations', {}).get('edges', [])
        edges = [e for e in edges if not mode or e['integrationMode'] == mode]
        return {'available': bool(self.data), 'edges': edges, 'counts': {'cross': len(edges)}}

    def graph(self, public, mode='fused', focus=None, depth=1, type_filter=None):
        if mode == 'base':
            return {'available': True, 'mode': 'base', 'nodes': [], 'edges': []}
        graph = self.data.get('graphs', {}).get(mode, {'nodes': [], 'edges': []})
        edges = [e for e in graph['edges'] if not type_filter or e['type'] == type_filter]
        ids = {n['id'] for n in graph['nodes']}
        if focus in ids:
            ids = {focus}
            for _ in range(min(3, max(1, depth))):
                ids |= {x for e in edges if e['fromId'] in ids or e['toId'] in ids for x in (e['fromId'], e['toId'])}
        nodes = [n for n in graph['nodes'] if n['id'] in ids]
        edges = [e for e in edges if e['fromId'] in ids and e['toId'] in ids]
        counts = {f'{kind}{label}': sum(x.get('kind') == kind for x in items)
                  for label, items in (('Nodes', nodes), ('Edges', edges)) for kind in ('g6a', 'syllabus', 'cross')}
        return {'available': bool(self.data), 'mode': mode, 'reason': '', 'nodes': nodes, 'edges': edges, 'counts': counts}
