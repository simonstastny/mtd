/**
 * MTD — Shared detection logic for missing translation keys.
 *
 * Translation keys are dot-separated identifiers like:
 *   home.welcome.title, errors.notFound, common.buttons.submit
 *
 * The default regex targets visible text that looks like an untranslated key
 * (2+ dot-separated segments, starting with a lowercase letter).
 */

const DEFAULT_PATTERN =
  /(?<![/@.#:])(?:\b[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){1,}\b)(?![/@.(])/g;

const IGNORED_EXTENSIONS = new Set([
  "com", "org", "net", "io", "dev", "app", "co", "js", "ts", "css",
  "html", "json", "xml", "svg", "png", "jpg", "jpeg", "gif", "webp",
  "woff", "woff2", "ttf", "eot", "pdf", "zip", "gz", "map", "md",
  "yml", "yaml", "toml", "env", "lock", "log", "txt", "csv",
]);

const IGNORED_DOMAINS = [
  "ifortuna.cz", "ifortuna.sk", "efortuna.pl", "efortuna.ro",
  "psk.hr", "casapariurilor.ro",
];

function looksLikeUrl(match, fullText) {
  const idx = fullText.indexOf(match);
  if (idx > 0) {
    const before = fullText.slice(Math.max(0, idx - 10), idx);
    if (/https?:\/\//.test(before) || before.endsWith("://") || before.endsWith("www.")) {
      return true;
    }
  }
  return false;
}

function looksLikeFileOrDomain(key) {
  const last = key.split(".").pop().toLowerCase();
  return IGNORED_EXTENSIONS.has(last);
}

function containsIgnoredDomain(key) {
  const lower = key.toLowerCase();
  return IGNORED_DOMAINS.some((d) => lower.includes(d));
}

/**
 * Detect missing translation keys in a text string.
 * @param {string} text - The text to scan.
 * @param {RegExp} [pattern] - Custom regex (must have global flag).
 * @returns {string[]} Array of matched translation keys.
 */
export function detectKeys(text, pattern) {
  const re = pattern ?? DEFAULT_PATTERN;
  const keys = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[0];
    if (looksLikeUrl(candidate, text)) continue;
    if (looksLikeFileOrDomain(candidate)) continue;
    if (containsIgnoredDomain(candidate)) continue;
    keys.push(candidate);
  }
  return keys;
}

export { DEFAULT_PATTERN };
