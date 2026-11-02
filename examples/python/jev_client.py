"""Stdlib client for jevtypesafe.org People Search and Jev decide.

People Search: POST /api/v1/people/email/find
Jev decide:    POST /api/v1/decide
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

DEFAULT_BASE_URL = "https://jevtypesafe.org"
FIND_PATH = "/api/v1/people/email/find"
DECIDE_PATH = "/api/v1/decide"


class ApiError(Exception):
    def __init__(self, status: int, body: Any, retry_after_sec: float | None = None) -> None:
        self.status = status
        self.body = body
        self.code = body.get("code") if isinstance(body, dict) else None
        self.retry_after_sec = retry_after_sec
        message = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), str) else f"HTTP {status}"
        super().__init__(message)


def normalize_domain(domain: str) -> str:
    """Same stripping the host applies before it calls upstream."""
    text = domain.strip()
    lowered = text.lower()
    if lowered.startswith("https://"):
        text = text[8:]
    elif lowered.startswith("http://"):
        text = text[7:]
    slash = text.find("/")
    if slash >= 0:
        text = text[:slash]
    return text


def build_find_body(data: dict[str, Any]) -> dict[str, Any]:
    full_name = str(data.get("full_name") or data.get("fullName") or "").strip()
    domain_raw = str(data.get("domain") or "").strip()
    linkedin = str(data.get("linkedin_url") or data.get("linkedinUrl") or "").strip()
    body: dict[str, Any] = {}
    if full_name:
        body["full_name"] = full_name
    if domain_raw:
        domain = normalize_domain(domain_raw)
        if domain:
            body["domain"] = domain
    if linkedin:
        body["linkedin_url"] = linkedin
    verify = data.get("verify")
    if verify is True or verify == "true":
        body["verify"] = True
    return body


def validate_find_input(body: dict[str, Any]) -> None:
    if not body.get("linkedin_url") and not (body.get("full_name") and body.get("domain")):
        raise ValueError(
            "Provide linkedin_url, or both full_name and domain (company domain without protocol)."
        )


def build_icp_decide_body(person: dict[str, str], icp: str) -> dict[str, Any]:
    return {
        "model": "jev",
        "state": {
            "person": {
                "full_name": person.get("full_name", ""),
                "title": person.get("title", ""),
                "company": person.get("company", ""),
                "domain": person.get("domain", ""),
            },
            "icp": icp,
        },
        "questions": {
            "fit": {
                "type": "choice",
                "instructions": (
                    "Does this person fit the ICP? Choose keep only when they are a plausible "
                    "buyer and an enrichment credit is justified. Choose skip otherwise."
                ),
                "criteria": {
                    "keep": "Role and company match the ICP closely enough to look up a work email.",
                    "skip": "Wrong function, wrong company, or not enough evidence to enrich.",
                },
            }
        },
    }


def passes_icp(answers: Any, min_confidence: float = 0.6) -> bool:
    if not isinstance(answers, dict):
        return False
    fit = answers.get("fit")
    if not isinstance(fit, dict):
        return False
    if fit.get("type") != "choice" or fit.get("choice") != "keep":
        return False
    confidence = fit.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        return False
    return float(confidence) >= min_confidence


def should_retry(error: BaseException) -> bool:
    if not isinstance(error, ApiError):
        return False
    if error.status in (429, 503):
        return True
    if error.status == 502 and error.code in ("people_upstream", "people_failed"):
        return True
    return False


def require_api_key(api_key: str | None) -> str:
    key = (api_key or "").strip()
    if not key.startswith("jv_live_"):
        raise ValueError(
            'Set JEV_API_KEY to a key from https://jevtypesafe.org/account/ (it starts with "jv_live_").'
        )
    return key


def preview_request(
    path: str,
    body: dict[str, Any],
    base_url: str = DEFAULT_BASE_URL,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    headers = {
        "Authorization": "Bearer jv_live_...",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return {
        "method": "POST",
        "url": base_url.rstrip("/") + path,
        "headers": headers,
        "body": body,
    }


def post_json(
    path: str,
    body: dict[str, Any],
    api_key: str,
    base_url: str = DEFAULT_BASE_URL,
    idempotency_key: str | None = None,
    timeout_sec: float = 60,
) -> Any:
    url = base_url.rstrip("/") + path
    payload = json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = {"error": raw[:500]}
        retry_header = error.headers.get("Retry-After") if error.headers else None
        retry_after = float(retry_header) if retry_header and retry_header.isdigit() else None
        raise ApiError(error.code, parsed, retry_after) from None


def post_json_with_retry(
    path: str,
    body: dict[str, Any],
    api_key: str,
    base_url: str = DEFAULT_BASE_URL,
    idempotency_key: str | None = None,
    timeout_sec: float = 60,
    max_attempts: int = 3,
) -> Any:
    delay = 1.0
    last_error: ApiError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return post_json(
                path,
                body,
                api_key,
                base_url=base_url,
                idempotency_key=idempotency_key,
                timeout_sec=timeout_sec,
            )
        except ApiError as error:
            last_error = error
            if attempt == max_attempts or not should_retry(error):
                raise
            wait = min(error.retry_after_sec or delay, 8)
            time.sleep(wait)
            delay = min(delay * 2, 8)
    assert last_error is not None
    raise last_error


def load_dotenv(path: Path) -> None:
    """Fill unset environment variables. Does not override existing values."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key and not os.environ.get(key):
            os.environ[key] = value


def load_example_env() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    cwd_file = Path.cwd() / ".env"
    root_file = repo_root / ".env"
    if cwd_file.resolve() == root_file.resolve():
        load_dotenv(root_file)
        return
    snapshot = {key: os.environ[key] for key in list(os.environ) if os.environ.get(key)}
    load_dotenv(cwd_file)
    cwd_keys = {
        key: os.environ[key]
        for key in (
            "JEV_API_KEY",
            "JEV_BASE_URL",
            "FULL_NAME",
            "DOMAIN",
            "LINKEDIN_URL",
            "VERIFY",
            "ICP",
            "TITLE",
            "COMPANY",
            "MIN_CONFIDENCE",
        )
        if os.environ.get(key) and key not in snapshot
    }
    load_dotenv(root_file)
    os.environ.update(cwd_keys)


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
