@echo off
cd /d "%~dp0"
echo === SolaMax Agent - TES KONEKSI (read-only, aman saat pompa beroperasi) ===
node --version > output-tes-koneksi.txt 2>&1
node solamax-agent.cjs --test-connection --config config.local.json >> output-tes-koneksi.txt 2>&1
type output-tes-koneksi.txt
echo.
echo ^>^>^> Hasil tersimpan di output-tes-koneksi.txt - kirimkan isi file ini.
pause
