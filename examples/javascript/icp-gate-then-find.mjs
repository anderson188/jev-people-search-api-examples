/**
 * Ask Jev whether a lead fits an ICP. Only then call People Search.
 *
 *   node examples/javascript/icp-gate-then-find.mjs --dry-run
 *   FULL_NAME="Jane Doe" DOMAIN=acme.com TITLE="VP Engineering" \
 *     node examples/javascript/icp-gate-then-find.mjs
 */

import { loadExampleEnv } from "./lib/env.mjs";
import {
  DEFAULT_BASE_URL,
  DECIDE_PATH,
  FIND_PATH,
  buildFindBody,
  buildIcpDecideBody,
  passesIcp,
  postJsonWithRetry,
  previewRequest,
  requireApiKey,
  validateFindInput,
} from "./lib/client.mjs";

loadExampleEnv();

function flag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const dryRun = process.argv.includes("--dry-run");
let fullName = flag("--full-name") ?? process.env.FULL_NAME ?? "";
let domain = flag("--domain") ?? process.env.DOMAIN ?? "";
let title = flag("--title") ?? process.env.TITLE ?? "";
let company = flag("--company") ?? process.env.COMPANY ?? "";
if (dryRun && !(fullName && domain)) {
  fullName = fullName || "Jane Doe";
  domain = domain || "acme.com";
  title = title || "VP Engineering";
  company = company || "Acme";
}
const icp = flag("--icp") ?? process.env.ICP ?? "B2B SaaS company; keep engineering or revenue leaders";
const minConfidence = Number(flag("--min-confidence") ?? process.env.MIN_CONFIDENCE ?? "0.6");
const verify = process.argv.includes("--no-verify") ? false : process.env.VERIFY !== "false";

const findBody = buildFindBody({ full_name: fullName, domain, verify });
const findCheck = validateFindInput(findBody);
if (!findCheck.ok) {
  console.error(findCheck.error);
  process.exit(2);
}

const decideBody = buildIcpDecideBody(
  { full_name: fullName, title, company, domain: findBody.domain },
  icp,
);
const baseUrl = process.env.JEV_BASE_URL || DEFAULT_BASE_URL;

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        note: "Dry run does not call Jev. The find request runs only when answers.fit.choice is keep and confidence >= min_confidence.",
        min_confidence: minConfidence,
        decide: previewRequest({ baseUrl, path: DECIDE_PATH, body: decideBody }),
        find_if_keep: previewRequest({
          baseUrl,
          path: FIND_PATH,
          body: findBody,
          idempotencyKey: "generated-per-live-call",
        }),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const apiKey = requireApiKey(process.env.JEV_API_KEY);

/** @type {{ answers?: unknown, usage?: unknown }} */
let decision;
try {
  decision = /** @type {{ answers?: unknown }} */ (
    await postJsonWithRetry({ baseUrl, path: DECIDE_PATH, apiKey, body: decideBody })
  );
} catch (error) {
  const status = /** @type {{ status?: number }} */ (error).status;
  const payload = /** @type {{ body?: unknown }} */ (error).body;
  console.error(status ? `decide HTTP ${status}` : "decide failed");
  console.error(JSON.stringify(payload ?? { error: String(error.message || error) }, null, 2));
  process.exit(1);
}

if (!passesIcp(decision.answers, minConfidence)) {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: `Jev did not choose keep at confidence >= ${minConfidence}. People Search was not called.`,
        decide: decision,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const found = await postJsonWithRetry({
    baseUrl,
    path: FIND_PATH,
    apiKey,
    body: findBody,
    idempotencyKey: crypto.randomUUID(),
  });
  console.log(JSON.stringify({ skipped: false, decide: decision, people_search: found }, null, 2));
} catch (error) {
  const status = /** @type {{ status?: number }} */ (error).status;
  const payload = /** @type {{ body?: unknown }} */ (error).body;
  console.error(status ? `people search HTTP ${status}` : "people search failed");
  console.error(JSON.stringify(payload ?? { error: String(error.message || error) }, null, 2));
  process.exit(1);
}
