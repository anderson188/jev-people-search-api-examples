# Treg People Search API examples (Jev)

Runnable curl, JavaScript, and Python for the **Treg People Search API** on [jevtypesafe.org](https://jevtypesafe.org/people-search/). One prepaid `jv_live_` key covers work-email find and a **Jev API** ICP gate.

**Try it in the browser, no clone:** [https://jevtypesafe.org/people-search/](https://jevtypesafe.org/people-search/)

That page has a live **Try the API** panel against `POST /api/v1/people/email/find`. Sign in, create a key on [Account](https://jevtypesafe.org/account/), and send a real request. Docs: [People Search API](https://jevtypesafe.org/docs/people-search/) · [Decide API](https://jevtypesafe.org/docs/api/).

This repo is an independent community example. It is not affiliated with TypeSafe AI or Treg / Superdesign. It is not an npm package and not a PyPI package — the scripts call HTTPS directly. An SDK can come later; these examples are the runnable part.

Enrichment uses personal data. Call it only with a lawful basis.

## Treg People Search API

[Treg](https://jevtypesafe.org/blog/what-is-treg-people-search/) is an open-source router for agent tools (“OpenRouter for tools”). **Treg People Search** is the lead-enrichment surface. On this host the tool id is `treg.people.email.find`, and you never see the upstream Treg token.

| | |
| --- | --- |
| Method | `POST` |
| URL | `https://jevtypesafe.org/api/v1/people/email/find` |
| Auth | `Authorization: Bearer jv_live_...` |
| Body | `linkedin_url`, **or** `full_name` + `domain` |
| Optional | `verify: true` (route-level verification when Treg supports it) |
| Optional header | `Idempotency-Key` (forwarded upstream; reuse it on retry) |

`domain` is a company host. The server strips `http://` / `https://` and any path, so `https://acme.com/about` is sent upstream as `acme.com`.

Contract: [`openapi.yaml`](openapi.yaml).

## Jev API integration

The useful pattern is: ask Jev if the lead fits an ICP, and only then spend a People Search call.

1. `POST /api/v1/decide` with `model: "jev"` and a `choice` question whose options are `keep` and `skip`.
2. Read `answers.fit.choice` and `answers.fit.confidence`.
3. Call People Search only when the choice is `keep` and confidence is at least `0.6` (override with `MIN_CONFIDENCE`).

Same API key, same prepaid balance. A skip does not call People Search.

```bash
node examples/javascript/icp-gate-then-find.mjs --dry-run
python examples/python/icp_gate_then_find.py --dry-run
bash examples/curl/icp-then-find.sh --dry-run
```

Jev question types used in production on this host are `choice`, `score`, and `noul`. This gate uses `choice` because the branch is explicit. Decide reference: [https://jevtypesafe.org/docs/api/](https://jevtypesafe.org/docs/api/).

## Authentication

Create a key at [https://jevtypesafe.org/account/](https://jevtypesafe.org/account/). It starts with `jv_live_`. Send it only as a bearer token.

```http
Authorization: Bearer jv_live_YOUR_KEY_HERE
Content-Type: application/json
```

```bash
cp .env.example .env
# then edit JEV_API_KEY
```

The runners load `.env` without overriding variables already in the environment. Do not commit `.env`. Do not paste a Treg token into these scripts — this host authenticates customers with `jv_live_` keys only.

Invalid keys return **401**. Twenty invalid attempts from one IP in a minute return **429** `rate_limit`.

## Quick Start

Requirements: Node.js 18+ (no install), Python 3.10+ (stdlib only), and bash + curl for the shell scripts.

```bash
npm test
python -m unittest discover -s tests -v
```

Dry-run prints the request and does not touch the network:

```bash
node examples/javascript/find-email.mjs --dry-run
python examples/python/find_email.py --dry-run
bash examples/curl/find-by-name.sh --dry-run
```

Live call (balance required — see Pricing):

```bash
node examples/javascript/find-email.mjs --full-name "Jane Doe" --domain acme.com
```

Step-by-step: [docs/quickstart.md](docs/quickstart.md).

## Request examples

Name and domain:

```bash
curl https://jevtypesafe.org/api/v1/people/email/find \
  -H "Authorization: Bearer jv_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 4f1c0b2e-8a7d-4e1a-9c3b-6d0e5f7a8b91" \
  -d '{
    "full_name": "Jane Doe",
    "domain": "acme.com",
    "verify": true
  }'
```

LinkedIn URL:

```bash
curl https://jevtypesafe.org/api/v1/people/email/find \
  -H "Authorization: Bearer jv_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/example",
    "verify": true
  }'
```

JavaScript and Python (no dependencies — the scripts build the body, validate it, and retry):

```bash
node examples/javascript/find-email.mjs --linkedin-url https://www.linkedin.com/in/example
python examples/python/find_email.py --domain acme.com --full-name "Jane Doe" --no-verify
```

ICP gate body (decide), then the find body only if Jev keeps the row:

```bash
node examples/javascript/icp-gate-then-find.mjs \
  --full-name "Jane Doe" --domain acme.com --title "VP Engineering" --company Acme
```

`Jane Doe` / `acme.com` is a shape example. Replace it with someone you are allowed to enrich.

## Response examples

Success is upstream `data` plus host `usage`. `data.email` is common and not guaranteed.

```json
{
  "data": {
    "email": "jane.doe@acme.com",
    "verified": true
  },
  "usage": {
    "treg_call_id": "1e0bf1cd3f7f42188980ecbe59829836",
    "credits_charged": 211905,
    "retail_usd": 0.089,
    "remaining_tokens": 11688095,
    "verify": true
  }
}
```

`credits_charged: 211905` is the debit for retail `$0.089` at this host’s `$0.42` per million credits (`ceil(0.089 / (0.42 / 1e6))`). If upstream cost is `$0`, `credits_charged` is `0`.

Jev keep answer (decide), which the ICP scripts require before find:

```json
{
  "answers": {
    "fit": { "type": "choice", "choice": "keep", "confidence": 0.84 }
  },
  "usage": {
    "input_tokens": 120,
    "billed_tokens": 120,
    "output_tokens": 0,
    "remaining_tokens": 9988000
  }
}
```

Failures:

```json
{ "error": "Provide linkedin_url, or both full_name and domain (company domain without protocol)." }
```

```json
{ "error": "Missing or invalid API key. Use Authorization: Bearer jv_live_..." }
```

```json
{
  "error": "Insufficient token balance. Buy a prepaid pack on /pricing — tokens do not expire while your account is active.",
  "code": "paywall",
  "remaining": 0,
  "upgrade_url": "https://jevtypesafe.org/pricing/",
  "account_url": "https://jevtypesafe.org/account/"
}
```

```json
{
  "error": "People Search upstream failed. Please try again later.",
  "code": "people_upstream"
}
```

Which codes to retry: [docs/error-handling.md](docs/error-handling.md).

## Pricing

Treg meters a catalog call at the provider rate (0% markup on their side). **This host charges 10× that upstream metered USD**, settled into the same prepaid credits as decide.

| Upstream metered | Retail on jevtypesafe.org | Credits debited (`$0.42` / M) |
| --- | --- | --- |
| $0 (free miss) | $0 | 0 |
| $0.0089 (published catalog-style example) | $0.089 | 211,905 |
| $0.05 (pre-call reserve estimate) | $0.50 held, then settled to the real cost | ~1,190,477 held |

The hold is released when the call fails, and it is replaced by the real debit when the call succeeds. A new account’s monthly grant is **10,000 credits**, which does not cover the People Search hold. Use **Try the API** on [https://jevtypesafe.org/people-search/](https://jevtypesafe.org/people-search/) once the balance can cover the hold, or buy a pack: [Pricing](https://jevtypesafe.org/pricing/). The `$5` pack is about 11.9M credits.

Upstream cost of goods is not returned to API clients. You see `usage.retail_usd` and `usage.credits_charged`.

## Documentation

| | |
| --- | --- |
| Try in the browser | [https://jevtypesafe.org/people-search/](https://jevtypesafe.org/people-search/) |
| People Search reference | [https://jevtypesafe.org/docs/people-search/](https://jevtypesafe.org/docs/people-search/) |
| Jev decide reference | [https://jevtypesafe.org/docs/api/](https://jevtypesafe.org/docs/api/) |
| What Treg People Search is | [https://jevtypesafe.org/blog/what-is-treg-people-search/](https://jevtypesafe.org/blog/what-is-treg-people-search/) |
| API guide | [https://jevtypesafe.org/blog/treg-people-search-api-guide/](https://jevtypesafe.org/blog/treg-people-search-api-guide/) |
| OpenAPI | [`openapi.yaml`](openapi.yaml) |
| Quick start | [`docs/quickstart.md`](docs/quickstart.md) |
| Errors and retries | [`docs/error-handling.md`](docs/error-handling.md) |
| Get a key | [https://jevtypesafe.org/account/](https://jevtypesafe.org/account/) |

Layout:

```
examples/curl/          bash + curl (find by name, LinkedIn, ICP gate)
examples/javascript/    Node 18 client, no dependencies
examples/python/        Python 3.10 client, stdlib only
```

## License

MIT. Example code only. Calling the API is still subject to the host [terms](https://jevtypesafe.org/terms/).
