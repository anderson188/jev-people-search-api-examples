#!/usr/bin/env bash
# Find a work email from a LinkedIn profile URL.
#
#   LINKEDIN_URL=https://www.linkedin.com/in/example bash examples/curl/find-by-linkedin.sh --dry-run
#
# Equivalent request:
#   curl https://jevtypesafe.org/api/v1/people/email/find \
#     -H "Authorization: Bearer $JEV_API_KEY" \
#     -H "Content-Type: application/json" \
#     -d '{"linkedin_url":"https://www.linkedin.com/in/example","verify":true}'
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
load_example_env

if [[ "$DRY_RUN" == "1" ]]; then
  LINKEDIN_URL="${LINKEDIN_URL:-https://www.linkedin.com/in/example}"
else
  : "${LINKEDIN_URL:?Set LINKEDIN_URL}"
fi
VERIFY="${VERIFY:-true}"
ROOT="$(jev_root)"

BODY="$(LINKEDIN_URL="$LINKEDIN_URL" VERIFY="$VERIFY" ROOT="$ROOT" python - <<'PY'
import json, os, sys
sys.path.insert(0, os.path.join(os.environ["ROOT"], "examples", "python"))
import jev_client
body = jev_client.build_find_body({
    "linkedin_url": os.environ["LINKEDIN_URL"],
    "verify": os.environ.get("VERIFY", "true") == "true",
})
jev_client.validate_find_input(body)
print(json.dumps(body))
PY
)"

api_post_retry "/api/v1/people/email/find" "$BODY" "$(new_idem)"
