/**
 * Tiny client for jevtypesafe.org.
 * People Search: POST /api/v1/people/email/find
 * Jev decide:    POST /api/v1/decide
 * No npm dependencies. Node 18+.
 */

export const DEFAULT_BASE_URL = "https://jevtypesafe.org";
export const FIND_PATH = "/api/v1/people/email/find";
export const DECIDE_PATH = "/api/v1/decide";

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {unknown} body
   * @param {number | undefined} retryAfterSec
   */
  constructor(status, body, retryAfterSec) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `HTTP ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : undefined;
    this.retryAfterSec =
      typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) ? retryAfterSec : undefined;
  }
}

/** Same stripping the host applies before it calls upstream. */
export function normalizeDomain(domain) {
  return String(domain).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function nonEmpty(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * @param {{
 *   full_name?: string,
 *   fullName?: string,
 *   domain?: string,
 *   linkedin_url?: string,
 *   linkedinUrl?: string,
 *   verify?: boolean | string,
 * }} input
 */
export function buildFindBody(input) {
  const fullName = nonEmpty(input.full_name ?? input.fullName);
  const domainRaw = nonEmpty(input.domain);
  const linkedin = nonEmpty(input.linkedin_url ?? input.linkedinUrl);
  /** @type {Record<string, string | boolean>} */
  const body = {};
  if (fullName) body.full_name = fullName;
  if (domainRaw) {
    const domain = normalizeDomain(domainRaw);
    if (domain) body.domain = domain;
  }
  if (linkedin) body.linkedin_url = linkedin;
  if (input.verify === true || input.verify === "true") body.verify = true;
  return body;
}

/** Mirrors the host 400 rule. */
export function validateFindInput(body) {
  if (!body.linkedin_url && !(body.full_name && body.domain)) {
    return {
      ok: false,
      error:
        "Provide linkedin_url, or both full_name and domain (company domain without protocol).",
    };
  }
  return { ok: true };
}

/**
 * @param {{ full_name?: string, title?: string, company?: string, domain?: string }} person
 * @param {string} icp
 */
export function buildIcpDecideBody(person, icp) {
  return {
    model: "jev",
    state: {
      person: {
        full_name: person.full_name ?? "",
        title: person.title ?? "",
        company: person.company ?? "",
        domain: person.domain ?? "",
      },
      icp,
    },
    questions: {
      fit: {
        type: "choice",
        instructions:
          "Does this person fit the ICP? Choose keep only when they are a plausible buyer and an enrichment credit is justified. Choose skip otherwise.",
        criteria: {
          keep: "Role and company match the ICP closely enough to look up a work email.",
          skip: "Wrong function, wrong company, or not enough evidence to enrich.",
        },
      },
    },
  };
}

/**
 * @param {unknown} answers
 * @param {number} minConfidence
 */
export function passesIcp(answers, minConfidence = 0.6) {
  if (!answers || typeof answers !== "object") return false;
  const fit = /** @type {{ type?: string, choice?: string, confidence?: number }} */ (
    /** @type {Record<string, unknown>} */ (answers).fit
  );
  if (!fit || fit.type !== "choice" || fit.choice !== "keep") return false;
  if (typeof fit.confidence !== "number" || !Number.isFinite(fit.confidence)) return false;
  return fit.confidence >= minConfidence;
}

/** Retry upstream blips and rate limits. Do not retry bad input, auth, or paywall. */
export function shouldRetry(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 429 || error.status === 503) return true;
  if (error.status === 502 && (error.code === "people_upstream" || error.code === "people_failed")) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   baseUrl?: string,
 *   path: string,
 *   apiKey: string,
 *   body: unknown,
 *   idempotencyKey?: string,
 *   timeoutMs?: number,
 * }} options
 */
export async function postJson(options) {
  const base = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${options.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${base}${options.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });

  const text = await response.text();
  /** @type {unknown} */
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const retryHeader = response.headers.get("retry-after");
    const retryAfterSec = retryHeader ? Number(retryHeader) : undefined;
    throw new ApiError(response.status, parsed, retryAfterSec);
  }
  return parsed;
}

/**
 * @param {Parameters<typeof postJson>[0] & { maxAttempts?: number }} options
 */
export async function postJsonWithRetry(options) {
  const maxAttempts = options.maxAttempts ?? 3;
  const idempotencyKey = options.idempotencyKey;
  let delayMs = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson({ ...options, idempotencyKey });
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      const retryAfterMs =
        error instanceof ApiError && error.retryAfterSec
          ? Math.min(error.retryAfterSec * 1000, 8000)
          : delayMs;
      await sleep(retryAfterMs);
      delayMs = Math.min(delayMs * 2, 8000);
    }
  }
  throw new Error("unreachable");
}

export function previewRequest(options) {
  const base = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    method: "POST",
    url: `${base}${options.path}`,
    headers: {
      Authorization: "Bearer jv_live_...",
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body,
  };
}

export function requireApiKey(apiKey) {
  const key = (apiKey || "").trim();
  if (!key.startsWith("jv_live_")) {
    throw new Error(
      'Set JEV_API_KEY to a key from https://jevtypesafe.org/account/ (it starts with "jv_live_").',
    );
  }
  return key;
}
