@echo off
cd /d "%~dp0"
echo === SolaMax Agent - SYNC SEKALI (kirim ke backend; baca DB tetap read-only) ===
echo Run pertama = backfill penuh, bisa beberapa menit. Jangan tutup jendela.
node --version > output-sync-once.txt 2>&1
node solamax-agent.cjs --once --config config.local.json >> output-sync-once.txt 2>&1
type output-sync-once.txt
echo.
echo ^>^>^> Hasil tersimpan di output-sync-once.txt - kirimkan isi file ini.
pause
