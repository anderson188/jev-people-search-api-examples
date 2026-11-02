import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Fill unset env vars from a KEY=VALUE file. Does not override existing values. */
export function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Repo-root .env, then the current working directory .env (cwd file wins over the repo file; real env wins over both). */
export function loadExampleEnv() {
  const cwdFile = resolve(process.cwd(), ".env");
  const rootFile = resolve(repoRoot, ".env");
  if (cwdFile === rootFile) {
    loadDotEnv(rootFile);
    return;
  }
  const fromCwd = {};
  if (existsSync(cwdFile)) {
    loadDotEnv(cwdFile);
    for (const key of ["JEV_API_KEY", "JEV_BASE_URL", "FULL_NAME", "DOMAIN", "LINKEDIN_URL", "VERIFY", "ICP", "TITLE", "COMPANY", "MIN_CONFIDENCE"]) {
      if (process.env[key]) fromCwd[key] = process.env[key];
    }
  }
  loadDotEnv(rootFile);
  for (const [key, value] of Object.entries(fromCwd)) process.env[key] = value;
}
