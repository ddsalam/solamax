@echo off
cd /d "%~dp0"
echo === SolaMax Agent - PROBE 11 SALDO (read-only, aman saat pompa beroperasi; TIDAK kirim) ===
node --version > output-probe11-saldo.txt 2>&1
node solamax-agent.cjs --probe11 --config config.local.json >> output-probe11-saldo.txt 2>&1
type output-probe11-saldo.txt
echo.
echo ^>^>^> Hasil tersimpan di output-probe11-saldo.txt - kirimkan isi file ini.
pause
