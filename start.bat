@echo off
setlocal
set PYTHONUTF8=1
set PYTHONDONTWRITEBYTECODE=1
python "%~dp0apps\knowledge_review\portal\server.py" --state-dir "%~dp0.local"
pause
endlocal
