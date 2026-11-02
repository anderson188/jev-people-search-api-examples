import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "examples" / "python"))

import jev_client  # noqa: E402


class ClientTest(unittest.TestCase):
    def test_normalize_domain(self) -> None:
        self.assertEqual(jev_client.normalize_domain("https://acme.com/about"), "acme.com")
        self.assertEqual(jev_client.normalize_domain("http://acme.com"), "acme.com")
        self.assertEqual(jev_client.normalize_domain("acme.com"), "acme.com")

    def test_find_body(self) -> None:
        self.assertEqual(
            jev_client.build_find_body(
                {"fullName": "Jane Doe", "domain": "https://acme.com/team", "verify": True}
            ),
            {"full_name": "Jane Doe", "domain": "acme.com", "verify": True},
        )
        linkedin = jev_client.build_find_body(
            {"linkedinUrl": "https://www.linkedin.com/in/example", "verify": "false"}
        )
        self.assertEqual(linkedin, {"linkedin_url": "https://www.linkedin.com/in/example"})
        with self.assertRaises(ValueError):
            jev_client.validate_find_input(jev_client.build_find_body({"full_name": "Jane Doe"}))

    def test_icp_body(self) -> None:
        body = jev_client.build_icp_decide_body(
            {"full_name": "Jane Doe", "title": "VP Engineering", "company": "Acme", "domain": "acme.com"},
            "B2B SaaS",
        )
        self.assertEqual(body["model"], "jev")
        self.assertEqual(body["questions"]["fit"]["type"], "choice")
        self.assertEqual(sorted(body["questions"]["fit"]["criteria"]), ["keep", "skip"])

    def test_passes_icp(self) -> None:
        self.assertTrue(jev_client.passes_icp({"fit": {"type": "choice", "choice": "keep", "confidence": 0.8}}))
        self.assertFalse(jev_client.passes_icp({"fit": {"type": "choice", "choice": "keep", "confidence": 0.4}}))
        self.assertFalse(jev_client.passes_icp({"fit": {"type": "choice", "choice": "skip", "confidence": 0.99}}))
        self.assertFalse(jev_client.passes_icp({"fit": {"type": "choice", "choice": "keep"}}))

    def test_should_retry(self) -> None:
        self.assertTrue(jev_client.should_retry(jev_client.ApiError(429, {"error": "slow", "code": "rate_limit"}, 60)))
        self.assertTrue(
            jev_client.should_retry(jev_client.ApiError(502, {"error": "down", "code": "people_upstream"}))
        )
        self.assertFalse(jev_client.should_retry(jev_client.ApiError(402, {"error": "pay", "code": "paywall"})))
        self.assertFalse(jev_client.should_retry(jev_client.ApiError(401, {"error": "nope"})))
        self.assertFalse(jev_client.should_retry(RuntimeError("network")))

    def test_dotenv_does_not_override(self) -> None:
        path = Path(__file__).resolve().parents[1] / ".env.example"
        os.environ["JEV_API_KEY"] = "jv_live_already_set"
        jev_client.load_dotenv(path)
        self.assertEqual(os.environ["JEV_API_KEY"], "jv_live_already_set")
        os.environ.pop("JEV_BASE_URL", None)
        jev_client.load_dotenv(path)
        self.assertEqual(os.environ["JEV_BASE_URL"], "https://jevtypesafe.org")


if __name__ == "__main__":
    unittest.main()
