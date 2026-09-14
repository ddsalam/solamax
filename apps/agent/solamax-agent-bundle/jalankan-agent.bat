@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TGL=%%i
node solamax-agent.cjs --config config.local.json >> "logs\agent-%TGL%.log" 2>&1
