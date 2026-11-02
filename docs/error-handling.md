# Error handling

People Search and decide return JSON `{ "error": "..." }` and, for most failures, a `code`. The examples retry only the cases below. A retry of People Search reuses one `Idempotency-Key` so Treg can treat it as the same call.

## What to do

| HTTP | `code` | Retry? | What it means |
| --- | --- | --- | --- |
| 400 | — | No | Body is not valid JSON, or you sent neither `linkedin_url` nor both `full_name` and `domain`. |
| 401 | — | No | Missing or invalid `Authorization: Bearer jv_live_...`. |
| 402 | `paywall` | No | Balance cannot cover the hold. `remaining`, `upgrade_url`, and `account_url` are included. Buy a pack; do not loop. |
| 403 | — | No | `Account disabled.` |
| 422 | `people_upstream` | No | Treg rejected the input. Read `error` and fix the body. |
| 429 | `rate_limit` or `people_upstream` | Yes | Invalid-key flood, decide RPM / burn cap, or an upstream rate limit. Wait for `Retry-After` (the host uses 60s on auth floods). |
| 502 | `people_upstream` or `people_failed` | Yes | Upstream blip, or the host could not finish the call. The credit hold is released when the host returns this for People Search. |
| 503 | `treg_not_configured` or none | Yes | Maintenance (`Service temporarily offline.`) or People Search is not configured. |

Decide uses the same 400 / 401 / 402 / 403 / 429 / 502 / 503 family. A decide 502 has `{ "error": "..." }` and may omit `code`. The clients retry 429 and 503 for both endpoints, and 502 only when `code` is `people_upstream` or `people_failed`.

## Do not retry these

- **400 / 401 / 403 / 422** — the next attempt will fail the same way.
- **402** — retrying spends nothing useful and can trip the invalid-traffic limits if you also rotate bad keys. 20 bad `Authorization` values from one IP in a minute returns 429 `rate_limit` with `Too many invalid API key attempts.`

## Retry rule in the clients

`examples/javascript/lib/client.mjs` (`shouldRetry`) and `examples/python/jev_client.py` (`should_retry`):

1. Up to 3 attempts.
2. Sleep `Retry-After` seconds when the header is present, otherwise 1s then 2s, capped at 8s.
3. People Search retries send the original `Idempotency-Key`.

curl (`examples/curl/_lib.sh`) follows the same status rule.

## Reading a success body

```json
{
  "data": { "email": "jane.doe@acme.com", "verified": true },
  "usage": {
    "treg_call_id": "1e0bf1cd3f7f42188980ecbe59829836",
    "credits_charged": 211905,
    "retail_usd": 0.089,
    "remaining_tokens": 11688095,
    "verify": true
  }
}
```

`data` is passed through from Treg. Do not assume `email` is always present; branch on your own checks. `usage.credits_charged` is `0` when upstream metered cost is `0` (a free miss is not billed here either). `usage.retail_usd` is the upstream USD × 10. Upstream cost of goods is not in the response.

## Paywall body

```json
{
  "error": "Insufficient token balance. Buy a prepaid pack on /pricing — tokens do not expire while your account is active.",
  "code": "paywall",
  "remaining": 0,
  "upgrade_url": "https://jevtypesafe.org/pricing/",
  "account_url": "https://jevtypesafe.org/account/"
}
```

The ICP scripts exit 0 when Jev says skip, so a skip is not an error. They exit 1 when decide or People Search returns an HTTP error.
