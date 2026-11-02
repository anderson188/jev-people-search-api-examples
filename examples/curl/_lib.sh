#!/usr/bin/env bash
# Shared helpers for the curl examples. Requires bash.
set -euo pipefail

jev_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

load_dotenv() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 ]]; then
      if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    if [[ -z "${!key:-}" ]]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done < "$file"
}

load_example_env() {
  local root
  root="$(jev_root)"
  load_dotenv "$(pwd)/.env"
  load_dotenv "$root/.env"
  export JEV_BASE_URL="${JEV_BASE_URL:-https://jevtypesafe.org}"
}

require_api_key() {
  if [[ "${JEV_API_KEY:-}" != jv_live_* ]]; then
    echo 'Set JEV_API_KEY to a key from https://jevtypesafe.org/account/ (it starts with "jv_live_").' >&2
    exit 2
  fi
}

new_idem() {
  if command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(crypto.randomUUID())'
  else
    python -c 'import uuid; print(uuid.uuid4(), end="")'
  fi
}

# Sets HTTP_STATUS and HTTP_BODY in the current shell. Does not print.
api_post() {
  local path="$1"
  local body="$2"
  local idem="${3:-}"
  local url="${JEV_BASE_URL%/}${path}"

  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    HTTP_STATUS="dry-run"
    HTTP_BODY="$(python - "$url" "$idem" "$body" <<'PY'
import json, sys
url, idem, body = sys.argv[1], sys.argv[2], sys.argv[3]
headers = {
    "Authorization": "Bearer jv_live_...",
    "Content-Type": "application/json",
}
if idem:
    headers["Idempotency-Key"] = idem
print(json.dumps({
    "method": "POST",
    "url": url,
    "headers": headers,
    "body": json.loads(body),
}, indent=2))
PY
)"
    return 0
  fi

  require_api_key
  local raw
  if [[ -n "$idem" ]]; then
    raw="$(curl -sS --max-time 60 -X POST "$url" \
      -H "Authorization: Bearer ${JEV_API_KEY}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -H "Idempotency-Key: ${idem}" \
      --data "$body" \
      -w $'\n%{http_code}')"
  else
    raw="$(curl -sS --max-time 60 -X POST "$url" \
      -H "Authorization: Bearer ${JEV_API_KEY}" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      --data "$body" \
      -w $'\n%{http_code}')"
  fi
  HTTP_STATUS="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

retryable_status() {
  local status="$1"
  local body="$2"
  [[ "$status" == "429" || "$status" == "503" ]] && return 0
  if [[ "$status" == "502" ]] && printf '%s' "$body" | python -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("code") in ("people_upstream","people_failed") else 1)' ; then
    return 0
  fi
  return 1
}

api_post_retry() {
  local path="$1"
  local body="$2"
  local idem="${3:-}"
  local attempt delay=1
  for attempt in 1 2 3; do
    api_post "$path" "$body" "$idem"
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
      printf '%s\n' "$HTTP_BODY"
      return 0
    fi
    if [[ "$HTTP_STATUS" =~ ^2 ]]; then
      printf '%s\n' "$HTTP_BODY"
      return 0
    fi
    if [[ "$attempt" -eq 3 ]] || ! retryable_status "$HTTP_STATUS" "$HTTP_BODY"; then
      echo "HTTP ${HTTP_STATUS}" >&2
      printf '%s\n' "$HTTP_BODY" >&2
      return 1
    fi
    sleep "$delay"
    delay=$((delay * 2))
    if [[ "$delay" -gt 8 ]]; then delay=8; fi
  done
}
