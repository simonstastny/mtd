#!/usr/bin/env node

import { chromium } from "playwright";
import { DEFAULT_PATTERN } from "./detect.mjs";

const HELP = `
mtd crawl — Crawl a website and detect missing translations

Usage:
  node crawl.mjs <url> [options]

Options:
  --pattern <regex>   Custom regex for translation keys (default: dot-notation keys)
  --selector <css>    Only scan inside a CSS selector (default: body)
  --wait <ms>         Wait for page to settle after load (default: 2000)
  --max <n>           Maximum pages to visit (default: 100)
  --concurrency <n>   Parallel page loads (default: 3)
  --json              Output results as JSON
  --headed            Run browser in headed mode (visible)
  --help              Show this help
`.trim();

const IGNORED_EXTENSIONS = [
  "com", "org", "net", "io", "dev", "app", "co", "js", "ts", "css",
  "html", "json", "xml", "svg", "png", "jpg", "jpeg", "gif", "webp",
  "woff", "woff2", "ttf", "eot", "pdf", "zip", "gz", "map", "md",
  "yml", "yaml", "toml", "env", "lock", "log", "txt", "csv",
];

const IGNORED_DOMAINS = [
  "ifortuna.cz", "ifortuna.sk", "efortuna.pl", "efortuna.ro",
  "psk.hr", "casapariurilor.ro",
];

const SKIP_EXTENSIONS = new Set([
  ".pdf", ".zip", ".gz", ".tar", ".png", ".jpg", ".jpeg", ".gif",
  ".svg", ".webp", ".ico", ".mp4", ".mp3", ".woff", ".woff2", ".ttf",
  ".eot", ".xml", ".rss", ".atom",
]);

function parseArgs(argv) {
  const args = {
    url: null, selector: "body", wait: 2000,
    max: 100, concurrency: 3,
    json: false, headed: false, pattern: null,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help") { console.log(HELP); process.exit(0); }
    else if (arg === "--pattern") { args.pattern = new RegExp(argv[++i], "g"); }
    else if (arg === "--selector") { args.selector = argv[++i]; }
    else if (arg === "--wait") { args.wait = parseInt(argv[++i], 10); }
    else if (arg === "--max") { args.max = parseInt(argv[++i], 10); }
    else if (arg === "--concurrency") { args.concurrency = parseInt(argv[++i], 10); }
    else if (arg === "--json") { args.json = true; }
    else if (arg === "--headed") { args.headed = true; }
    else if (!arg.startsWith("--")) {
      args.url = /^https?:\/\//.test(arg) ? arg : `https://${arg}`;
    }
    i++;
  }
  return args;
}

function normalizeUrl(raw, origin) {
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return null;
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const ext = u.pathname.match(/\.\w+$/)?.[0]?.toLowerCase();
    if (ext && SKIP_EXTENSIONS.has(ext)) return null;
    u.hash = "";
    return u.href.replace(/\/+$/, "") || u.origin;
  } catch {
    return null;
  }
}

async function scanAndCollectLinks(page, url, opts) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    return { url, error: "Navigation failed or timed out", links: [] };
  }
  if (opts.wait > 0) await page.waitForTimeout(opts.wait);

  const patternSource = (opts.pattern ?? DEFAULT_PATTERN).source;
  const patternFlags = (opts.pattern ?? DEFAULT_PATTERN).flags;

  const result = await page.evaluate(
    ({ selector, patternSource, patternFlags, ignoredExtensions, ignoredDomains }) => {
      const re = new RegExp(patternSource, patternFlags);
      const IGNORED_EXT = new Set(ignoredExtensions);

      const container = document.querySelector(selector);
      if (!container) return { error: `Selector "${selector}" not found`, links: [] };

      const findings = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const tag = node.parentElement?.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
            return NodeFilter.FILTER_REJECT;
          const style = node.parentElement ? getComputedStyle(node.parentElement) : null;
          if (style && (style.display === "none" || style.visibility === "hidden"))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        if (!text) continue;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const key = m[0];
          const last = key.split(".").pop().toLowerCase();
          if (IGNORED_EXT.has(last)) continue;
          if (ignoredDomains.some((d) => key.toLowerCase().includes(d))) continue;
          findings.push(key);
        }
      }

      const links = [...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .filter(Boolean);

      const unique = [...new Set(findings)];
      return { total: findings.length, unique: unique.length, keys: unique, links };
    },
    { selector: opts.selector, patternSource, patternFlags, ignoredExtensions: IGNORED_EXTENSIONS, ignoredDomains: IGNORED_DOMAINS },
  );

  return { url, ...result };
}

async function crawl(opts) {
  const origin = new URL(opts.url).origin;
  const visited = new Set();
  const queue = [opts.url.replace(/\/+$/, "") || origin];
  const allResults = [];
  const globalKeys = new Map();

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext();

  function log(msg) {
    if (!opts.json) process.stderr.write(msg + "\n");
  }

  log(`\nCrawling ${origin} (max ${opts.max} pages, concurrency ${opts.concurrency})\n`);

  try {
    while (queue.length > 0 && visited.size < opts.max) {
      const batch = [];
      while (batch.length < opts.concurrency && queue.length > 0 && visited.size + batch.length < opts.max) {
        const next = queue.shift();
        if (visited.has(next)) continue;
        visited.add(next);
        batch.push(next);
      }
      if (batch.length === 0) break;

      const tasks = batch.map(async (url) => {
        const page = await context.newPage();
        try {
          return await scanAndCollectLinks(page, url, opts);
        } finally {
          await page.close();
        }
      });

      const results = await Promise.all(tasks);

      for (const result of results) {
        if (result.error) {
          log(`  ✗ ${result.url} — ${result.error}`);
          continue;
        }

        allResults.push(result);
        log(`  ✓ ${result.url} — ${result.total} occurrences, ${result.unique} unique keys`);

        for (const key of result.keys) {
          if (!globalKeys.has(key)) globalKeys.set(key, []);
          globalKeys.get(key).push(result.url);
        }

        for (const link of result.links) {
          const normalized = normalizeUrl(link, origin);
          if (normalized && !visited.has(normalized)) {
            queue.push(normalized);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  return { origin, pagesScanned: visited.size, globalKeys, allResults };
}

function printSummary({ origin, pagesScanned, globalKeys, allResults }, opts) {
  if (opts.json) {
    const out = {
      origin,
      pagesScanned,
      totalUniqueKeys: globalKeys.size,
      keys: Object.fromEntries(
        [...globalKeys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, urls]) => [key, [...new Set(urls)]])
      ),
      pages: allResults.map(({ url, total, unique, keys }) => ({ url, total, unique, keys })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const bar = "═".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Crawl complete: ${origin}`);
  console.log(`  Pages scanned: ${pagesScanned}`);
  console.log(`  Total unique keys: ${globalKeys.size}`);
  console.log(bar);

  if (globalKeys.size === 0) {
    console.log("\n  No missing translations found!\n");
    return;
  }

  const sorted = [...globalKeys.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, urls] of sorted) {
    const uniqueUrls = [...new Set(urls)];
    console.log(`\n  ${key}`);
    for (const u of uniqueUrls) {
      console.log(`    └─ ${u}`);
    }
  }
  console.log();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.url) {
    console.log(HELP);
    process.exit(1);
  }

  const result = await crawl(opts);
  printSummary(result, opts);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
