"""Find a work email.

    python examples/python/find_email.py --dry-run
    python examples/python/find_email.py --full-name "Jane Doe" --domain acme.com
    python examples/python/find_email.py --linkedin-url https://www.linkedin.com/in/example
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jev_client  # noqa: E402


def main() -> int:
    jev_client.load_example_env()
    parser = argparse.ArgumentParser(description="POST /api/v1/people/email/find")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--full-name", default=os.environ.get("FULL_NAME", ""))
    parser.add_argument("--domain", default=os.environ.get("DOMAIN", ""))
    parser.add_argument("--linkedin-url", default=os.environ.get("LINKEDIN_URL", ""))
    parser.add_argument("--verify", dest="verify", action="store_true", default=None)
    parser.add_argument("--no-verify", dest="verify", action="store_false")
    args = parser.parse_args()

    verify = args.verify
    if verify is None:
        verify = os.environ.get("VERIFY", "true") != "false"

    if args.dry_run and not args.linkedin_url and not (args.full_name and args.domain):
        args.full_name = args.full_name or "Jane Doe"
        args.domain = args.domain or "acme.com"

    body = jev_client.build_find_body(
        {
            "full_name": args.full_name,
            "domain": args.domain,
            "linkedin_url": args.linkedin_url,
            "verify": verify,
        }
    )
    try:
        jev_client.validate_find_input(body)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    base_url = os.environ.get("JEV_BASE_URL", jev_client.DEFAULT_BASE_URL)
    idempotency_key = os.environ.get("IDEMPOTENCY_KEY") or jev_client.new_idempotency_key()

    if args.dry_run:
        print(
            json.dumps(
                jev_client.preview_request(
                    jev_client.FIND_PATH, body, base_url=base_url, idempotency_key=idempotency_key
                ),
                indent=2,
            )
        )
        return 0

    try:
        api_key = jev_client.require_api_key(os.environ.get("JEV_API_KEY"))
        result = jev_client.post_json_with_retry(
            jev_client.FIND_PATH,
            body,
            api_key,
            base_url=base_url,
            idempotency_key=idempotency_key,
        )
    except (jev_client.ApiError, ValueError) as error:
        status = getattr(error, "status", None)
        payload = getattr(error, "body", None)
        print(f"HTTP {status}" if status else "request failed", file=sys.stderr)
        print(json.dumps(payload or {"error": str(error)}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
