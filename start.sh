#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export PYTHONUTF8=1
export PYTHONDONTWRITEBYTECODE=1

PORT="${PORT:-8782}"
URL="http://127.0.0.1:${PORT}"

# 逐个验证解释器能真正运行，跳过 Windows 应用商店的 python3 占位程序。
PY_CMD=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
        PY_CMD="$candidate"
        break
    fi
done
if [ -z "$PY_CMD" ]; then
    echo "❌ 未检测到 Python 3.10+ 环境，请先安装 Python 3.10 或更高版本。"
    exit 1
fi

echo "========================================================"
echo "  ∑ 数学知识探索平台 · Community Edition"
echo "  正在启动本地服务: ${URL}"
echo "  按 Ctrl + C 可随时停止服务"
echo "========================================================"

# 延迟 1 秒自动在默认浏览器打开页面
(
    sleep 1
    if command -v open >/dev/null 2>&1; then
        open "${URL}" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "${URL}" >/dev/null 2>&1 || true
    fi
) &

exec "$PY_CMD" "$DIR/apps/knowledge_review/portal/server.py" --state-dir "$DIR/.local" --port "$PORT"
