#!/usr/bin/env bash
# Ask Jev whether a lead fits an ICP. Call People Search only on keep.
#
#   bash examples/curl/icp-then-find.sh --dry-run
#   FULL_NAME="Jane Doe" DOMAIN=acme.com TITLE="VP Engineering" \
#     bash examples/curl/icp-then-find.sh
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
load_example_env

if [[ "$DRY_RUN" == "1" ]]; then
  FULL_NAME="${FULL_NAME:-Jane Doe}"
  DOMAIN="${DOMAIN:-acme.com}"
  TITLE="${TITLE:-VP Engineering}"
  COMPANY="${COMPANY:-Acme}"
else
  : "${FULL_NAME:?Set FULL_NAME}"
  : "${DOMAIN:?Set DOMAIN}"
fi
TITLE="${TITLE:-}"
COMPANY="${COMPANY:-}"
ICP="${ICP:-B2B SaaS company; keep engineering or revenue leaders}"
MIN_CONFIDENCE="${MIN_CONFIDENCE:-0.6}"
VERIFY="${VERIFY:-true}"
ROOT="$(jev_root)"

BODIES="$(FULL_NAME="$FULL_NAME" DOMAIN="$DOMAIN" TITLE="$TITLE" COMPANY="$COMPANY" ICP="$ICP" VERIFY="$VERIFY" ROOT="$ROOT" python - <<'PY'
import json, os, sys
sys.path.insert(0, os.path.join(os.environ["ROOT"], "examples", "python"))
import jev_client
find_body = jev_client.build_find_body({
    "full_name": os.environ["FULL_NAME"],
    "domain": os.environ["DOMAIN"],
    "verify": os.environ.get("VERIFY", "true") == "true",
})
jev_client.validate_find_input(find_body)
decide_body = jev_client.build_icp_decide_body({
    "full_name": os.environ["FULL_NAME"],
    "title": os.environ.get("TITLE", ""),
    "company": os.environ.get("COMPANY", ""),
    "domain": find_body.get("domain", ""),
}, os.environ["ICP"])
print(json.dumps(decide_body))
print(json.dumps(find_body))
PY
)"

DECIDE_BODY="$(printf '%s\n' "$BODIES" | sed -n '1p')"
FIND_BODY="$(printf '%s\n' "$BODIES" | sed -n '2p')"

if [[ "$DRY_RUN" == "1" ]]; then
  python - "$JEV_BASE_URL" "$MIN_CONFIDENCE" "$DECIDE_BODY" "$FIND_BODY" <<'PY'
import json, sys
base, minimum, decide_body, find_body = sys.argv[1:]
def preview(path, body):
    return {
        "method": "POST",
        "url": base.rstrip("/") + path,
        "headers": {"Authorization": "Bearer jv_live_...", "Content-Type": "application/json"},
        "body": json.loads(body),
    }
print(json.dumps({
    "note": "Dry run does not call Jev. Find runs only when answers.fit.choice is keep.",
    "min_confidence": float(minimum),
    "decide": preview("/api/v1/decide", decide_body),
    "find_if_keep": preview("/api/v1/people/email/find", find_body),
}, indent=2))
PY
  exit 0
fi

api_post "/api/v1/decide" "$DECIDE_BODY"
if [[ ! "$HTTP_STATUS" =~ ^2 ]]; then
  echo "decide HTTP ${HTTP_STATUS}" >&2
  printf '%s\n' "$HTTP_BODY" >&2
  exit 1
fi

KEEP="$(printf '%s' "$HTTP_BODY" | MIN_CONFIDENCE="$MIN_CONFIDENCE" python - <<'PY'
import json, os, sys
decision = json.load(sys.stdin)
fit = (decision.get("answers") or {}).get("fit") or {}
confidence = fit.get("confidence")
minimum = float(os.environ["MIN_CONFIDENCE"])
ok = (
    fit.get("type") == "choice"
    and fit.get("choice") == "keep"
    and isinstance(confidence, (int, float))
    and not isinstance(confidence, bool)
    and float(confidence) >= minimum
)
print("yes" if ok else "no")
PY
)"

if [[ "$KEEP" != "yes" ]]; then
  MIN_CONFIDENCE="$MIN_CONFIDENCE" python - "$MIN_CONFIDENCE" "$HTTP_BODY" <<'PY'
import json, sys
minimum, raw = sys.argv[1], sys.argv[2]
print(json.dumps({
    "skipped": True,
    "reason": f"Jev did not choose keep at confidence >= {minimum}. People Search was not called.",
    "decide": json.loads(raw),
}, indent=2))
PY
  exit 0
fi

api_post_retry "/api/v1/people/email/find" "$FIND_BODY" "$(new_idem)"
