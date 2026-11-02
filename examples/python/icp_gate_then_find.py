"""Ask Jev whether a lead fits an ICP. Only then call People Search.

    python examples/python/icp_gate_then_find.py --dry-run
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
    parser = argparse.ArgumentParser(description="Jev ICP gate, then People Search")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--full-name", default=os.environ.get("FULL_NAME", ""))
    parser.add_argument("--domain", default=os.environ.get("DOMAIN", ""))
    parser.add_argument("--title", default=os.environ.get("TITLE", ""))
    parser.add_argument("--company", default=os.environ.get("COMPANY", ""))
    parser.add_argument(
        "--icp",
        default=os.environ.get("ICP", "B2B SaaS company; keep engineering or revenue leaders"),
    )
    parser.add_argument("--min-confidence", type=float, default=float(os.environ.get("MIN_CONFIDENCE", "0.6")))
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args()

    verify = False if args.no_verify else os.environ.get("VERIFY", "true") != "false"
    if args.dry_run and not (args.full_name and args.domain):
        args.full_name = args.full_name or "Jane Doe"
        args.domain = args.domain or "acme.com"
        args.title = args.title or "VP Engineering"
        args.company = args.company or "Acme"
    find_body = jev_client.build_find_body(
        {"full_name": args.full_name, "domain": args.domain, "verify": verify}
    )
    try:
        jev_client.validate_find_input(find_body)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    decide_body = jev_client.build_icp_decide_body(
        {
            "full_name": args.full_name,
            "title": args.title,
            "company": args.company,
            "domain": str(find_body.get("domain") or ""),
        },
        args.icp,
    )
    base_url = os.environ.get("JEV_BASE_URL", jev_client.DEFAULT_BASE_URL)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "note": (
                        "Dry run does not call Jev. The find request runs only when "
                        "answers.fit.choice is keep and confidence >= min_confidence."
                    ),
                    "min_confidence": args.min_confidence,
                    "decide": jev_client.preview_request(jev_client.DECIDE_PATH, decide_body, base_url=base_url),
                    "find_if_keep": jev_client.preview_request(
                        jev_client.FIND_PATH,
                        find_body,
                        base_url=base_url,
                        idempotency_key="generated-per-live-call",
                    ),
                },
                indent=2,
            )
        )
        return 0

    try:
        api_key = jev_client.require_api_key(os.environ.get("JEV_API_KEY"))
        decision = jev_client.post_json_with_retry(
            jev_client.DECIDE_PATH, decide_body, api_key, base_url=base_url
        )
    except (jev_client.ApiError, ValueError) as error:
        status = getattr(error, "status", None)
        payload = getattr(error, "body", None)
        print(f"decide HTTP {status}" if status else "decide failed", file=sys.stderr)
        print(json.dumps(payload or {"error": str(error)}, indent=2), file=sys.stderr)
        return 1

    answers = decision.get("answers") if isinstance(decision, dict) else None
    if not jev_client.passes_icp(answers, args.min_confidence):
        print(
            json.dumps(
                {
                    "skipped": True,
                    "reason": (
                        f"Jev did not choose keep at confidence >= {args.min_confidence}. "
                        "People Search was not called."
                    ),
                    "decide": decision,
                },
                indent=2,
            )
        )
        return 0

    try:
        found = jev_client.post_json_with_retry(
            jev_client.FIND_PATH,
            find_body,
            api_key,
            base_url=base_url,
            idempotency_key=jev_client.new_idempotency_key(),
        )
    except jev_client.ApiError as error:
        print(f"people search HTTP {error.status}", file=sys.stderr)
        print(json.dumps(error.body or {"error": str(error)}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps({"skipped": False, "decide": decision, "people_search": found}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
