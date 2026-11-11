"""Local mathematics reference service. Python standard library only."""
import argparse
import hashlib
import json
import mimetypes
from pathlib import Path
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
import fusion
import practice

ROOT = Path(__file__).resolve().parents[3]
WEB = Path(__file__).parent / 'web'
DATA = ROOT / 'content' / 'knowledge_graph'
# 运行数据一律写在程序根目录的 .local/；发行包与维护源共用这一约定，源码不含内部任务路径。
RUN = ROOT / '.local'
from catalog import require, validate



class Handler(BaseHTTPRequestHandler):
    server_version = 'MathReference/2'

    def reply(self, value, status=200, cookie=None):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.headers_out('application/json; charset=utf-8')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def headers_out(self, content):
        self.send_header('Content-Type', content)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")

    def session(self):
        return None

    def do_GET(self):
        try:
            self.get()
        except (AssertionError, ValueError, KeyError) as exc:
            self.reply({'error': str(exc)}, 400)
        except Exception:
            self.reply({'error': '读取失败，请重试或检查服务日志'}, 500)

    def get(self):
        hosts = (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
        if self.headers.get('Host') not in hosts:
            return self.reply({'error': '访问主机不合法'}, 403)
        path = urlsplit(self.path).path
        q = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
        admin = bool(self.session())
        if path.startswith('/api/math-brain/'):
            if not self.server.math_brain_enabled:
                return self.reply({'error': '数学大脑 V0.1 仅供维护源的自有版本机预览'}, 403)
            import brain_bridge
            return brain_bridge.route(self)
        if path in ('/math-brain', '/math-brain/', '/math-brain/app.js', '/math-brain/styles.css', '/math-brain/math-render.js', '/math-brain/review.js', '/math-brain/model-config.js', '/math-brain/message-renderer.js', '/math-brain/markdown-it.js', '/math-brain/history-sidebar.js', '/math-brain/import-preview.js', '/math-brain/wrong-library.js', '/math-brain/progress-stream.js'):
            if not self.server.math_brain_enabled:
                return self.reply({'error': '数学大脑 V0.1 仅供自有版本机预览'}, 403)
            import brain_bridge
            if path == '/math-brain/markdown-it.js':
                return self.file_reply(brain_bridge.WEB.parent / 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js')
            name = 'index.html' if path in ('/math-brain', '/math-brain/') else path.rsplit('/', 1)[1]
            return self.file_reply(brain_bridge.WEB / name)
        if path.startswith('/api/practice/'):
            return practice.handle(self, path, q)
        if path == '/api/session':
            return self.reply({'admin': admin, 'preview': self.server.preview, 'fusion': self.server.fusion_enabled, 'edition': self.server.edition, 'practice': self.server.preview, 'mathBrain': self.server.math_brain_enabled, 'notice': self.server.notice})
        if path.startswith('/api/fusion/'):
            return self.fusion_route(path, q, admin)
        if path == '/api/datasets':
            if self.server.owner_enabled:
                with self.server.store.connect() as c:
                    rows = c.execute('SELECT dataset,version,public,active FROM versions ORDER BY dataset,version').fetchall()
            else:
                rows = self.server.resources.dataset_rows()
            return self.reply([{'datasetId': d, 'version': v, 'label': f"数学 · {json.loads(p)['meta'].get('grade','')}" + {'A': '上', 'B': '下'}.get(json.loads(p)['meta'].get('volume'), ''), 'preview': not a} for d, v, p, a in rows if a or admin or self.server.preview])
        if path.startswith('/api/admin/') or path in ('/api/private', '/owner.js'):
            if hasattr(self, 'owner_get'):
                return self.owner_get(path, q, admin)
            return self.reply({'error': '接口不存在'}, 404)
        if path in ('/api/catalog', '/api/points', '/api/point', '/api/relations', '/api/graph'):
            row = self.server.store.get(q.get('dataset', ''), q.get('version', ''))
            if not row or not (row['active'] or admin or self.server.preview):
                return self.reply({'error': '当前知识版本不可访问'}, 404)
            data = json.loads(row['public'])
            if path == '/api/catalog':
                return self.reply({k: data[k] for k in ('meta', 'groups', 'subgroups', 'sequences', 'topics')})
            if path == '/api/point':
                p = next((p for p in data['points'] if p['id'] == q.get('id')), None)
                if not p:
                    return self.reply({'error': '知识点不存在'}, 404)
                ids = {cid for e in p.get('elements', []) for cid in e.get('contextIds', [])}
                return self.reply({'point': p, 'contexts': [c for c in data.get('contexts', []) if c['id'] in ids]})
            if path == '/api/points':
                needle = q.get('q', '').casefold().strip()
                points = []
                for p in data['points']:
                    hay = '\n'.join([p.get(k, '') for k in ('name', 'title', 'lead', 'core', 'explanation', 'summary')] + [e.get('title', '') + e.get('body', '') for e in p['elements']] + [m.get('statement', '') + m.get('verification', '') for m in p['mastery']])
                    if needle and q.get('fusion') != '0' and self.server.fusion_enabled:
                        supplement = self.fusion_model(row).point(p['id'])
                        for extension in supplement.get('extensions', []):
                            hay += '\n' + extension['differenceSummary']
                            hay += '\n' + '\n'.join(e['title'] + e['body'] for e in extension['elements'])
                    if needle and needle not in hay.casefold():
                        continue
                    at = hay.casefold().find(needle) if needle else -1
                    points.append({k: p.get(k) for k in ('id', 'name', 'lead', 'topicId', 'sequenceIds')} | {'snippet': hay[max(0, at - 35):at + 110] if needle else p['lead']})
                return self.reply(points)
            if path == '/api/relations':
                return self.reply([r for r in data['relations'] if not q.get('point') or q['point'] in (r['fromId'], r['toId'])])
            return self.reply({'nodes': [{'id': p['id'], 'label': p['name'], 'topicId': p['topicId'], 'sequenceIds': p['sequenceIds']} for p in data['points']], 'edges': data['relations']})
        if path.startswith('/katex/'):
            vendor = (Path(__file__).parent / 'web/vendor/katex').resolve()
            if not vendor.exists():
                vendor = (ROOT / 'apps/practice_review/web/vendor/katex').resolve()
            file = (vendor / path.removeprefix('/katex/')).resolve()
            if file.is_relative_to(vendor) and file.is_file() and file.suffix in ('.js', '.css', '.woff2'):
                return self.file_reply(file)
            return self.reply({'error': '资源不存在'}, 404)
        static = {'/': 'index.html', '/app.js': 'app.js', '/knowledge-math.js': 'knowledge-math.js', '/styles.css': 'styles.css', '/practice.js': 'practice.js', '/practice.css': 'practice.css', '/robots.txt': 'robots.txt', '/sitemap.xml': 'sitemap.xml'}
        if path not in static:
            return self.reply({'error': '资源不存在'}, 404)
        return self.file_reply(WEB / static[path])

    def fusion_model(self, row):
        """One hash-checked projection per served Public digest; rebuilt when the digest changes."""
        if self.server.resources is not None and not self.server.owner_enabled:
            return self.server.resources.fusion(row)
        digest = row['digest']
        model = fusion.get(digest)
        if model is None:
            with self.server.lock:
                model = fusion.get(digest)
                if model is None:
                    model = fusion.build(digest, row['dataset'], row['version'], row.get('digests'))
        return model

    def fusion_route(self, path, q, admin):
        if path == '/api/fusion/original':
            return self.reply({'error': '接口不存在'}, 404)
        if not self.server.fusion_enabled or q.get('fusion') == '0':
            return self.reply({'available': False, 'reason': '本次运行未启用考纲融合'})
        row = self.server.store.get(q.get('dataset', ''), q.get('version', ''))
        if not row or not (row['active'] or admin or self.server.preview):
            return self.reply({'error': '当前知识版本不可访问'}, 404)
        model = self.fusion_model(row)
        data = json.loads(row['public'])
        base = {'datasetId': row['dataset'], 'version': row['version']}
        if path == '/api/fusion/syllabus-point':
            if not (self.server.preview or admin):
                return self.reply({'error': '考纲候选知识仅供受控预览'}, 403)
            point = model.syllabus_point(q.get('id', ''))
            if not point:
                return self.reply({'error': '考纲知识不存在'}, 404)
            return self.reply(base | {'point': point})
        if path == '/api/fusion/status':
            return self.reply(base | model.status())
        if path == '/api/fusion/catalog':
            catalog = model.catalog(data)
            if not (self.server.preview or admin):
                catalog.update(addedTopics=[], independentPoints=[])
            return self.reply(base | catalog)
        if path == '/api/fusion/point':
            return self.reply(base | model.point(q.get('id', ''), include_hidden=bool(admin) and q.get('hidden') == '1'))
        if path == '/api/fusion/relations':
            mode = q.get('mode') or None
            require(mode in (None, 'INLINE_EXTENSION', 'RELATED_ONLY'), '关系筛选无效')
            return self.reply(base | model.relations(mode))
        if path == '/api/fusion/graph':
            mode = q.get('mode', 'fused')
            require(mode in ('base', 'fused', 'syllabus'), '图谱模式无效')
            depth = min(3, max(1, int(q.get('depth') or 1)))
            return self.reply(base | model.graph(data, mode=mode, focus=q.get('point') or None,
                                                 depth=depth, type_filter=q.get('type') or None))
        return self.reply({'error': '接口不存在'}, 404)

    def file_reply(self, file):
        raw = file.read_bytes()
        if file.name == 'index.html':
            raw = raw.replace(b'__EDITION__', self.server.edition.encode()).replace(b'<!--EDITION_SCRIPTS-->', b'<script src="/owner.js" defer></script>' if self.server.owner_enabled else b'')
        self.send_response(200)
        self.headers_out(mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        self.reply({'error': '接口不存在'}, 404)

    def do_PUT(self):
        if urlsplit(self.path).path.startswith('/api/math-brain/') and self.server.math_brain_enabled:
            import brain_bridge
            return brain_bridge.route(self)
        self.reply({'error': '接口不存在'}, 404)

    do_PATCH = do_PUT


def make_server(port=8782, db=None, preview=True, fusion_enabled=True, profile=None):
    from resources import Resources, NOTICE
    marker = ROOT / 'release-manifest.json'
    db = Path(db) if db else RUN / 'runtime.sqlite3'
    manifest = json.loads(marker.read_text(encoding='utf-8')) if marker.exists() else None
    edition = (manifest or {}).get('edition', profile or 'owner')
    require(edition in ('owner', 'community'), '未知版本类型')
    if manifest:
        require(profile is None or profile == edition, '发行包不能切换版本类型')
    owner_enabled = edition == 'owner'
    resource = Resources(ROOT, manifest) if manifest else None
    if owner_enabled:
        from owner import OwnerHandlerMixin, Store
        if not manifest and Path(db).resolve() == (RUN / 'runtime.sqlite3').resolve():
            from owner import migrate_previous_state
            migrate_previous_state(db)
        handler = type('OwnerHandler', (OwnerHandlerMixin, Handler), {})
        store = Store(db)
    else:
        require(resource is not None, '开源版必须从固定发行清单启动')
        handler, store = Handler, resource
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    server.store, server.resources = store, resource
    server.owner_enabled, server.edition = owner_enabled, edition
    server.notice = NOTICE
    server.preview, server.fusion_enabled = preview, fusion_enabled
    server.sessions, server.attempts = {}, []
    server.lock = threading.Lock()
    server.practice_cache = {}
    server.math_brain_enabled = owner_enabled and preview and not manifest and (Path(__file__).parent.parent / 'math_brain/web/index.html').is_file()
    if server.math_brain_enabled:
        import brain_bridge
        server.brain_bridge = brain_bridge.Bridge(server)
        original_close = server.server_close
        def close_with_brain():
            server.brain_bridge.close()
            original_close()
        server.server_close = close_with_brain
    if resource and owner_enabled:
        with store.connect() as c:
            empty = not c.execute('SELECT 1 FROM versions LIMIT 1').fetchone()
        if empty:
            for dataset in manifest['datasets']:
                store.register(ROOT / dataset['public'], ROOT / dataset['private'] if dataset.get('private') else None)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8782)
    parser.add_argument('--public', action='store_true', help='仅显示已发布内容')
    parser.add_argument('--no-fusion', action='store_true')
    parser.add_argument('--profile', choices=('owner', 'community'))
    parser.add_argument('--state-dir', type=Path)
    args = parser.parse_args()
    state_dir = args.state_dir or RUN
    server = make_server(args.port, state_dir / 'runtime.sqlite3', preview=not args.public,
                         fusion_enabled=not args.no_fusion, profile=args.profile)
    if server.owner_enabled and server.resources is None:
        with server.store.connect() as c:
            empty = not c.execute('SELECT 1 FROM versions LIMIT 1').fetchone()
        if empty:
            for file in sorted(DATA.rglob('*_public_*.json')):
                paired = file.with_name(file.name.replace('_public_', '_private_'))
                server.store.register(file, paired if paired.exists() else None)
    print(f'Math reference: http://127.0.0.1:{args.port} edition={server.edition}', flush=True)
    server.serve_forever()
