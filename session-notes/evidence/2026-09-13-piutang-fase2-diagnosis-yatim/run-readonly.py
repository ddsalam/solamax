"""Execute retained SQL through the local proxy without logging credentials."""
import os, subprocess, sys
from pathlib import Path
from urllib.parse import urlsplit, unquote
root = Path(__file__).resolve().parents[3]
url = urlsplit((root / "secrets/db-url-app-proxy.txt").read_text().strip())
env = os.environ.copy()
env.update(PGHOST="127.0.0.1", PGPORT="55439", PGUSER=unquote(url.username or ""), PGPASSWORD=unquote(url.password or ""), PGDATABASE=url.path.lstrip("/"), PGSSLMODE="disable", PGCONNECT_TIMEOUT="10", PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=120000")
sql=Path(sys.argv[1])
with sql.with_suffix(".txt").open("w") as out:
    result=subprocess.run(["psql","-X","-v","ON_ERROR_STOP=1","-f",str(sql)],env=env,stdout=out,stderr=subprocess.STDOUT)
print(f"{sql.name}: exit={result.returncode}; output={sql.with_suffix('.txt')}")
sys.exit(result.returncode)
