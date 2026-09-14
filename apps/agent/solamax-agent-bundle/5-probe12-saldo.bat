@echo off
cd /d "%~dp0"
echo === SolaMax Agent - PROBE 12 SALDO koreksi (read-only, aman saat pompa; TIDAK kirim) ===
node --version > output-probe12-saldo.txt 2>&1
node solamax-agent.cjs --probe12 --config config.local.json >> output-probe12-saldo.txt 2>&1
type output-probe12-saldo.txt
echo.
echo ^>^>^> Hasil tersimpan di output-probe12-saldo.txt - kirimkan isi file ini.
pause
