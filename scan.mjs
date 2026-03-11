#!/usr/bin/env node

import { chromium } from "playwright";
import { detectKeys, DEFAULT_PATTERN } from "./detect.mjs";

const HELP = `
mtd — Missing Translation Detector

Usage:
  node scan.mjs <url> [options]

Options:
  --pattern <regex>   Custom regex for translation keys (default: dot-notation keys)
  --selector <css>    Only scan inside a CSS selector (default: body)
  --wait <ms>         Wait for page to settle after load (default: 2000)
  --dom               Show DOM path for each occurrence
  --json              Output results as JSON
  --headed            Run browser in headed mode (visible)
  --help              Show this help
`.trim();

function parseArgs(argv) {
  const args = { urls: [], selector: "body", wait: 2000, json: false, headed: false, dom: false, pattern: null };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help") { console.log(HELP); process.exit(0); }
    else if (arg === "--pattern") { args.pattern = new RegExp(argv[++i], "g"); }
    else if (arg === "--selector") { args.selector = argv[++i]; }
    else if (arg === "--wait") { args.wait = parseInt(argv[++i], 10); }
    else if (arg === "--json") { args.json = true; }
    else if (arg === "--dom") { args.dom = true; }
    else if (arg === "--headed") { args.headed = true; }
    else if (!arg.startsWith("--")) {
      const url = /^https?:\/\//.test(arg) ? arg : `https://${arg}`;
      args.urls.push(url);
    }
    i++;
  }
  return args;
}

async function scanPage(page, url, opts) {
  await page.goto(url, { waitUntil: "networkidle" });
  if (opts.wait > 0) await page.waitForTimeout(opts.wait);

  const patternSource = (opts.pattern ?? DEFAULT_PATTERN).source;
  const patternFlags = (opts.pattern ?? DEFAULT_PATTERN).flags;

  const results = await page.evaluate(
    ({ selector, patternSource, patternFlags, ignoredExtensions }) => {
      const re = new RegExp(patternSource, patternFlags);
      const IGNORED = new Set(ignoredExtensions);
      const container = document.querySelector(selector);
      if (!container) return { error: `Selector "${selector}" not found` };

      const findings = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const tag = node.parentElement?.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
            return NodeFilter.FILTER_REJECT;
          }
          const style = node.parentElement ? getComputedStyle(node.parentElement) : null;
          if (style && (style.display === "none" || style.visibility === "hidden")) {
            return NodeFilter.FILTER_REJECT;
          }
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
          if (IGNORED.has(last)) continue;
          const el = walker.currentNode.parentElement;
          const path = [];
          let cur = el;
          while (cur && cur !== document.body) {
            let seg = cur.tagName.toLowerCase();
            if (cur.id) seg += `#${cur.id}`;
            else if (cur.className && typeof cur.className === "string")
              seg += `.${cur.className.trim().split(/\s+/)[0]}`;
            path.unshift(seg);
            cur = cur.parentElement;
          }
          findings.push({
            key,
            text: text.length > 120 ? text.slice(0, 120) + "…" : text,
            path: path.join(" > "),
          });
        }
      }

      const unique = [...new Set(findings.map((f) => f.key))];
      return { total: findings.length, unique: unique.length, keys: unique, findings };
    },
    {
      selector: opts.selector,
      patternSource,
      patternFlags,
      ignoredExtensions: [
        "com", "org", "net", "io", "dev", "app", "co", "js", "ts", "css",
        "html", "json", "xml", "svg", "png", "jpg", "jpeg", "gif", "webp",
        "woff", "woff2", "ttf", "eot", "pdf", "zip", "gz", "map", "md",
        "yml", "yaml", "toml", "env", "lock", "log", "txt", "csv",
      ],
    }
  );

  return { url, ...results };
}

function printResults(result, { json, dom }) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.error) {
    console.error(`\n  Error: ${result.error}\n`);
    return;
  }

  const bar = "─".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  URL: ${result.url}`);
  console.log(`  Found: ${result.total} occurrences of ${result.unique} unique keys`);
  console.log(bar);

  if (result.findings.length === 0) {
    console.log("  No missing translations found.\n");
    return;
  }

  if (dom) {
    const grouped = {};
    for (const f of result.findings) {
      if (!grouped[f.key]) grouped[f.key] = [];
      grouped[f.key].push(f);
    }
    for (const [key, occurrences] of Object.entries(grouped)) {
      console.log(`\n  ${key}`);
      for (const occ of occurrences) {
        console.log(`    └─ ${occ.path}`);
      }
    }
  } else {
    for (const key of result.keys) {
      console.log(`  ${key}`);
    }
  }
  console.log();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.urls.length === 0) {
    console.log(HELP);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext();

  try {
    for (const url of opts.urls) {
      const page = await context.newPage();
      try {
        const result = await scanPage(page, url, opts);
        printResults(result, opts);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
