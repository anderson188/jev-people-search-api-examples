#!/usr/bin/env bash
# Find a work email by name + company domain.
#
#   bash examples/curl/find-by-name.sh --dry-run
#   FULL_NAME="Jane Doe" DOMAIN=acme.com bash examples/curl/find-by-name.sh
#
# Equivalent request:
#   curl https://jevtypesafe.org/api/v1/people/email/find \
#     -H "Authorization: Bearer $JEV_API_KEY" \
#     -H "Content-Type: application/json" \
#     -d '{"full_name":"Jane Doe","domain":"acme.com","verify":true}'
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
load_example_env

if [[ "$DRY_RUN" == "1" ]]; then
  FULL_NAME="${FULL_NAME:-Jane Doe}"
  DOMAIN="${DOMAIN:-acme.com}"
else
  : "${FULL_NAME:?Set FULL_NAME}"
  : "${DOMAIN:?Set DOMAIN}"
fi
VERIFY="${VERIFY:-true}"
ROOT="$(jev_root)"

BODY="$(FULL_NAME="$FULL_NAME" DOMAIN="$DOMAIN" VERIFY="$VERIFY" ROOT="$ROOT" python - <<'PY'
import json, os, sys
sys.path.insert(0, os.path.join(os.environ["ROOT"], "examples", "python"))
import jev_client
body = jev_client.build_find_body({
    "full_name": os.environ["FULL_NAME"],
    "domain": os.environ["DOMAIN"],
    "verify": os.environ.get("VERIFY", "true") == "true",
})
jev_client.validate_find_input(body)
print(json.dumps(body))
PY
)"

api_post_retry "/api/v1/people/email/find" "$BODY" "$(new_idem)"
