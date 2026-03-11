# MTD — Missing Translation Detector

Find untranslated keys (dot-notation like `home.welcome.title`) on deployed web pages. Comes with two tools:

1. **CLI Scanner** — headless browser scan that outputs a report
2. **Browser Bookmarklet** — visual overlay that highlights missing translations in-page

## Setup

```bash
npm install
npx playwright install chromium
```

## CLI Scanner

```bash
# Basic scan
node scan.mjs https://your-app.com

# Scan a specific section
node scan.mjs https://your-app.com --selector "#main-content"

# Custom regex pattern
node scan.mjs https://your-app.com --pattern "[A-Z_]{2,}\.[A-Z_]{2,}"

# JSON output (for piping to other tools)
node scan.mjs https://your-app.com --json

# Scan multiple pages
node scan.mjs https://your-app.com https://your-app.com/settings

# Visible browser (for debugging)
node scan.mjs https://your-app.com --headed

# Increase wait time for slow pages
node scan.mjs https://your-app.com --wait 5000
```

### CLI Options

| Option | Description | Default |
|---|---|---|
| `--pattern <regex>` | Custom regex for translation keys | Dot-notation keys |
| `--selector <css>` | CSS selector to scope the scan | `body` |
| `--wait <ms>` | Wait after page load (ms) | `2000` |
| `--json` | Output as JSON | `false` |
| `--headed` | Show the browser window | `false` |

### Example Output

```
────────────────────────────────────────────────────────────
  URL: https://your-app.com
  Found: 5 occurrences of 3 unique keys
────────────────────────────────────────────────────────────

  home.welcome.title
    └─ main.container > div.hero > h1.title

  nav.menu.settings
    └─ header > nav.main-nav > a.nav-link
    └─ footer > nav.footer-nav > a.link

  errors.generic.message
    └─ div.toast > p.message
```

## Browser Bookmarklet

### Option A: Paste in Console

1. Open your page in a browser
2. Open DevTools (F12) → Console
3. Paste the contents of `bookmarklet.js` and press Enter

### Option B: Create a Bookmarklet

1. Create a new bookmark in your browser
2. Set the URL to:

```
javascript:void(fetch('https://raw.githubusercontent.com/YOUR_USER/mtd/main/bookmarklet.js').then(r=>r.text()).then(eval))
```

Or minify `bookmarklet.js` and prefix with `javascript:`.

### Bookmarklet Features

- Highlights all missing translation keys in **red** on the page
- Floating panel lists all found keys with occurrence counts
- **Click a highlighted key** to copy it to clipboard (turns green briefly)
- **Click a key in the panel** to scroll to it on the page
- **"Copy all keys"** button exports the full list
- **Draggable panel** — move it by dragging the header
- **Run again** to refresh results; **close** (✕) to clean up

## How Detection Works

The default regex matches dot-separated identifiers that look like translation keys:

```
word.word.word       ✓  (home.welcome.title)
camelCase.mixedCase  ✓  (errors.notFound)
a.b                  ✓  (nav.home)
google.com           ✗  (filtered — known extension)
some.file.js         ✗  (filtered — known extension)
https://api.example  ✗  (filtered — URL context)
```

False positives are minimized by:
- Ignoring common file extensions and TLDs
- Skipping URL-adjacent text
- Only scanning visible text nodes (no `<script>`, `<style>`, hidden elements)

## Customization

To adjust the regex pattern for your project's translation key format, modify the `PATTERN` or `DEFAULT_PATTERN` constant in the respective files.
