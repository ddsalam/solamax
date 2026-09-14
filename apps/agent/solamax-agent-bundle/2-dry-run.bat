@echo off
cd /d "%~dp0"
echo === SolaMax Agent - DRY RUN (baca data, TIDAK kirim ke mana pun) ===
node --version > output-dry-run.txt 2>&1
node solamax-agent.cjs --dry-run --once --config config.local.json >> output-dry-run.txt 2>&1
type output-dry-run.txt
echo.
echo ^>^>^> Hasil tersimpan di output-dry-run.txt - kirimkan isi file ini.
pause
