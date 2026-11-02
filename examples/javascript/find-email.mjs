/**
 * Find a work email.
 *
 *   node examples/javascript/find-email.mjs --dry-run
 *   node examples/javascript/find-email.mjs --full-name "Jane Doe" --domain acme.com
 *   node examples/javascript/find-email.mjs --linkedin-url https://www.linkedin.com/in/example
 */

import { loadExampleEnv } from "./lib/env.mjs";
import {
  DEFAULT_BASE_URL,
  FIND_PATH,
  buildFindBody,
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
const verifyFlag = process.argv.includes("--no-verify")
  ? false
  : process.argv.includes("--verify")
    ? true
    : process.env.VERIFY !== "false";

let fullName = flag("--full-name") ?? process.env.FULL_NAME ?? "";
let domain = flag("--domain") ?? process.env.DOMAIN ?? "";
const linkedinUrl = flag("--linkedin-url") ?? process.env.LINKEDIN_URL ?? "";
if (dryRun && !linkedinUrl && !(fullName && domain)) {
  fullName = fullName || "Jane Doe";
  domain = domain || "acme.com";
}

const body = buildFindBody({
  full_name: fullName,
  domain,
  linkedin_url: linkedinUrl,
  verify: verifyFlag,
});

const check = validateFindInput(body);
if (!check.ok) {
  console.error(check.error);
  process.exit(2);
}

const baseUrl = process.env.JEV_BASE_URL || DEFAULT_BASE_URL;
const idempotencyKey = process.env.IDEMPOTENCY_KEY || crypto.randomUUID();

if (dryRun) {
  console.log(JSON.stringify(previewRequest({ baseUrl, path: FIND_PATH, body, idempotencyKey }), null, 2));
  process.exit(0);
}

const apiKey = requireApiKey(process.env.JEV_API_KEY);
try {
  const result = await postJsonWithRetry({
    baseUrl,
    path: FIND_PATH,
    apiKey,
    body,
    idempotencyKey,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const status = /** @type {{ status?: number }} */ (error).status;
  const payload = /** @type {{ body?: unknown }} */ (error).body;
  console.error(status ? `HTTP ${status}` : "request failed");
  console.error(JSON.stringify(payload ?? { error: String(error.message || error) }, null, 2));
  process.exit(1);
}
