import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  buildFindBody,
  buildIcpDecideBody,
  normalizeDomain,
  passesIcp,
  shouldRetry,
  validateFindInput,
} from "../examples/javascript/lib/client.mjs";

test("normalizeDomain matches the host strip", () => {
  assert.equal(normalizeDomain("https://acme.com/about"), "acme.com");
  assert.equal(normalizeDomain("http://acme.com"), "acme.com");
  assert.equal(normalizeDomain("acme.com"), "acme.com");
});

test("buildFindBody accepts name+domain or linkedin", () => {
  assert.deepEqual(
    buildFindBody({ fullName: "Jane Doe", domain: "https://acme.com/team", verify: true }),
    { full_name: "Jane Doe", domain: "acme.com", verify: true },
  );
  assert.deepEqual(buildFindBody({ linkedinUrl: "https://www.linkedin.com/in/example", verify: "false" }), {
    linkedin_url: "https://www.linkedin.com/in/example",
  });
  const missing = buildFindBody({ full_name: "Jane Doe" });
  assert.equal(validateFindInput(missing).ok, false);
  assert.equal(validateFindInput(buildFindBody({ linkedin_url: "https://www.linkedin.com/in/example" })).ok, true);
});

test("ICP decide body is a real choice question", () => {
  const body = buildIcpDecideBody(
    { full_name: "Jane Doe", title: "VP Engineering", company: "Acme", domain: "acme.com" },
    "B2B SaaS",
  );
  assert.equal(body.model, "jev");
  assert.equal(body.questions.fit.type, "choice");
  assert.deepEqual(Object.keys(body.questions.fit.criteria).sort(), ["keep", "skip"]);
  assert.equal(body.state.person.domain, "acme.com");
});

test("passesIcp requires keep and confidence", () => {
  assert.equal(
    passesIcp({ fit: { type: "choice", choice: "keep", confidence: 0.8 } }, 0.6),
    true,
  );
  assert.equal(
    passesIcp({ fit: { type: "choice", choice: "keep", confidence: 0.4 } }, 0.6),
    false,
  );
  assert.equal(
    passesIcp({ fit: { type: "choice", choice: "skip", confidence: 0.99 } }, 0.6),
    false,
  );
  assert.equal(passesIcp({ fit: { type: "choice", choice: "keep" } }, 0.6), false);
});

test("shouldRetry skips auth and paywall", () => {
  assert.equal(shouldRetry(new ApiError(429, { error: "slow", code: "rate_limit" }, 60)), true);
  assert.equal(shouldRetry(new ApiError(502, { error: "down", code: "people_upstream" })), true);
  assert.equal(shouldRetry(new ApiError(503, { error: "offline" })), true);
  assert.equal(shouldRetry(new ApiError(400, { error: "bad" })), false);
  assert.equal(shouldRetry(new ApiError(401, { error: "nope" })), false);
  assert.equal(shouldRetry(new ApiError(402, { error: "pay", code: "paywall" })), false);
  assert.equal(shouldRetry(new Error("network")), false);
});
