@echo off
cd /d "%~dp0"
echo === SolaMax Agent - PROBE 13 SALDO decisive (read-only, aman saat pompa; TIDAK kirim) ===
node --version > output-probe13-saldo.txt 2>&1
node solamax-agent.cjs --probe13 --config config.local.json >> output-probe13-saldo.txt 2>&1
type output-probe13-saldo.txt
echo.
echo ^>^>^> Hasil tersimpan di output-probe13-saldo.txt - kirimkan isi file ini.
pause
