@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set HARIINI=%%i
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-40).ToString('yyyy-MM-dd')"') do set AWAL=%%i
echo [%HARIINI%] resync-bulanan %AWAL% s/d %HARIINI% >> "logs\resync-bulanan.log"
node solamax-agent.cjs --resync-sales %AWAL% %HARIINI% --config config.local.json >> "logs\resync-bulanan.log" 2>&1
