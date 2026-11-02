# Quick start

Try the hosted API in the browser before you clone anything:

**[https://jevtypesafe.org/people-search/](https://jevtypesafe.org/people-search/)**

Sign in, create a `jv_live_` key on [Account](https://jevtypesafe.org/account/), and use **Try the API**. A new account includes **3 free People Search trials**. The panel calls production `POST /api/v1/people/email/find`. The key stays in that browser tab.

## 1. Key

```bash
cp .env.example .env
```

Set `JEV_API_KEY`. The scripts read `.env` and do not override variables you already exported.

The first 3 successful finds on that account are free (`usage.trial_used: true`, `credits_charged: 0`). A failed lookup does not consume a trial. After that, People Search holds about 1.19M credits (~$0.50 retail) and settles to the real upstream cost × 10. See the pricing section in the README.

Use a person you have a lawful basis to look up. `Jane Doe` / `acme.com` only shows the request shape.

## 2. Dry-run (no network, no key)

```bash
node examples/javascript/find-email.mjs --dry-run
node examples/javascript/icp-gate-then-find.mjs --dry-run

python examples/python/find_email.py --dry-run
python examples/python/icp_gate_then_find.py --dry-run

bash examples/curl/find-by-name.sh --dry-run
bash examples/curl/find-by-linkedin.sh --dry-run
bash examples/curl/icp-then-find.sh --dry-run
```

Dry-run prints the POST it would send. The `Authorization` header is redacted.

## 3. Live find

```bash
node examples/javascript/find-email.mjs --full-name "Jane Doe" --domain acme.com
python examples/python/find_email.py --full-name "Jane Doe" --domain acme.com
FULL_NAME="Jane Doe" DOMAIN=acme.com bash examples/curl/find-by-name.sh
```

LinkedIn instead of name + domain:

```bash
node examples/javascript/find-email.mjs --linkedin-url https://www.linkedin.com/in/example
python examples/python/find_email.py --linkedin-url https://www.linkedin.com/in/example
LINKEDIN_URL=https://www.linkedin.com/in/example bash examples/curl/find-by-linkedin.sh
```

## 4. Jev ICP gate, then find

This spends a decide call first. People Search runs only when `answers.fit.choice` is `keep` and `confidence` is at least `MIN_CONFIDENCE` (default `0.6`).

```bash
node examples/javascript/icp-gate-then-find.mjs \
  --full-name "Jane Doe" --domain acme.com --title "VP Engineering" --company Acme

python examples/python/icp_gate_then_find.py \
  --full-name "Jane Doe" --domain acme.com --title "VP Engineering" --company Acme

FULL_NAME="Jane Doe" DOMAIN=acme.com TITLE="VP Engineering" COMPANY=Acme \
  bash examples/curl/icp-then-find.sh
```

A skip prints the decide payload and exits 0. The find call is not sent.

## Requirements

- Node.js 18+ for the JavaScript examples (no `npm install`)
- Python 3.10+ for the Python examples (stdlib only)
- bash + curl + python for `examples/curl`

Offline checks:

```bash
npm test
python -m unittest discover -s tests -v
```
