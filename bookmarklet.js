/**
 * Missing Translation Detector — Browser Bookmarklet
 *
 * Highlights untranslated dot-notation keys on the current page
 * and shows a floating panel with all found keys.
 *
 * To use as a bookmarklet, minify this and prefix with `javascript:`.
 * Or paste directly into the browser console.
 */
(function () {
  "use strict";

  const PANEL_ID = "__mtd_panel";
  const HIGHLIGHT_CLASS = "__mtd_highlight";
  const STYLE_ID = "__mtd_scrollbar_style";

  const PATTERN =
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

  function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  const BTN_STYLE = {
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    padding: "6px 16px",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: "600",
  };

  let dragAbort = null;
  let navAbort = null;
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  function cleanup() {
    const prev = document.getElementById(PANEL_ID);
    if (prev) prev.remove();
    const prevStyle = document.getElementById(STYLE_ID);
    if (prevStyle) prevStyle.remove();
    if (dragAbort) { dragAbort.abort(); dragAbort = null; }
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });
  }

  function stopNavigationWatch() {
    if (navAbort) { navAbort.abort(); navAbort = null; }
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
  }

  function startNavigationWatch() {
    stopNavigationWatch();
    navAbort = new AbortController();
    const opts = { signal: navAbort.signal };
    let currentUrl = location.href;

    function onNavigate() {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        run();
      }
    }

    history.pushState = function (...args) {
      origPushState(...args);
      onNavigate();
    };
    history.replaceState = function (...args) {
      origReplaceState(...args);
      onNavigate();
    };
    window.addEventListener("popstate", onNavigate, opts);
  }

  function run() {
    cleanup();

    // --- Scan page ---
    const findings = [];
    const keySet = new Set();
    const textNodes = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentElement?.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        if (!isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const text = node.textContent;
      if (!text.trim()) continue;

      PATTERN.lastIndex = 0;
      const matches = [];
      let m;
      while ((m = PATTERN.exec(text)) !== null) {
        const key = m[0];
        const last = key.split(".").pop().toLowerCase();
        if (IGNORED_EXTENSIONS.has(last)) continue;
        if (IGNORED_DOMAINS.some((d) => key.toLowerCase().includes(d))) continue;
        matches.push({ key, index: m.index, length: key.length });
      }

      if (matches.length === 0) continue;

      const frag = document.createDocumentFragment();
      let cursor = 0;

      for (const match of matches) {
        if (match.index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }
        const span = document.createElement("span");
        span.className = HIGHLIGHT_CLASS;
        span.textContent = match.key;
        span.title = "Missing translation: " + match.key;
        Object.assign(span.style, {
          backgroundColor: "#ff2d55",
          color: "#fff",
          padding: "1px 4px",
          borderRadius: "3px",
          fontWeight: "bold",
          outline: "2px solid #ff2d55",
          outlineOffset: "1px",
          cursor: "pointer",
        });
        span.addEventListener("click", () => {
          navigator.clipboard.writeText(match.key).then(() => {
            span.style.backgroundColor = "#34c759";
            span.style.outlineColor = "#34c759";
            setTimeout(() => {
              span.style.backgroundColor = "#ff2d55";
              span.style.outlineColor = "#ff2d55";
            }, 600);
          });
        });
        frag.appendChild(span);
        keySet.add(match.key);
        findings.push(match.key);
        cursor = match.index + match.length;
      }

      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }

      node.parentNode.replaceChild(frag, node);
    }

    // --- Build floating panel ---
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      width: "max-content",
      minWidth: "360px",
      maxWidth: "min(560px, 90vw)",
      maxHeight: "50vh",
      background: "#1c1c1e",
      color: "#f5f5f7",
      borderRadius: "12px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: "13px",
      zIndex: "999999",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    });

    // Header
    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "12px 16px",
      background: "#2c2c2e",
      borderBottom: "1px solid #3a3a3c",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "move",
      userSelect: "none",
    });

    const title = document.createElement("span");
    title.innerHTML = `<strong>MTD</strong> — ${findings.length} found, ${keySet.size} unique`;
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#f5f5f7",
      fontSize: "16px",
      cursor: "pointer",
      padding: "0 4px",
    });
    closeBtn.addEventListener("click", () => { cleanup(); stopNavigationWatch(); });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Drag support
    let isDragging = false, dragX, dragY;
    dragAbort = new AbortController();
    const dragOpts = { signal: dragAbort.signal };
    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragX = e.clientX - panel.getBoundingClientRect().left;
      dragY = e.clientY - panel.getBoundingClientRect().top;
    }, dragOpts);
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - dragX) + "px";
      panel.style.top = (e.clientY - dragY) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }, dragOpts);
    document.addEventListener("mouseup", () => { isDragging = false; }, dragOpts);

    // Scrollbar styling
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.id = STYLE_ID;
    scrollbarStyle.textContent = `
      #${PANEL_ID} *::-webkit-scrollbar { width: 6px; }
      #${PANEL_ID} *::-webkit-scrollbar-track { background: #1c1c1e; }
      #${PANEL_ID} *::-webkit-scrollbar-thumb { background: #3a3a3c; border-radius: 3px; }
      #${PANEL_ID} *::-webkit-scrollbar-thumb:hover { background: #48484a; }
    `;
    document.head.appendChild(scrollbarStyle);

    // Key list
    const list = document.createElement("div");
    Object.assign(list.style, {
      overflowY: "auto",
      padding: "8px 0",
      scrollbarColor: "#3a3a3c #1c1c1e",
      scrollbarWidth: "thin",
    });

    if (keySet.size === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No missing translations found!";
      Object.assign(empty.style, { padding: "16px", textAlign: "center", color: "#86868b" });
      list.appendChild(empty);
    } else {
      const sorted = [...keySet].sort();
      for (const key of sorted) {
        const count = findings.filter((k) => k === key).length;
        const row = document.createElement("div");
        Object.assign(row.style, {
          padding: "6px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          borderBottom: "1px solid #2c2c2e",
        });
        row.addEventListener("mouseenter", () => { row.style.background = "#2c2c2e"; });
        row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
        row.addEventListener("click", () => {
          const match = [...document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)].find(
            (el) => el.textContent === key
          );
          if (match) match.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        const keySpan = document.createElement("span");
        keySpan.textContent = key;
        Object.assign(keySpan.style, { fontFamily: "monospace", fontSize: "12px", whiteSpace: "nowrap" });

        const badge = document.createElement("span");
        badge.textContent = `×${count}`;
        Object.assign(badge.style, {
          background: "#ff2d55",
          color: "#fff",
          borderRadius: "10px",
          padding: "1px 8px",
          fontSize: "11px",
          fontWeight: "bold",
          marginLeft: "8px",
          flexShrink: "0",
        });

        row.appendChild(keySpan);
        row.appendChild(badge);
        list.appendChild(row);
      }
    }

    panel.appendChild(list);

    // Footer
    const footer = document.createElement("div");
    Object.assign(footer.style, {
      padding: "8px 16px",
      borderTop: "1px solid #3a3a3c",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexShrink: "0",
    });

    const COOKIE_NAME = "debugShowTcKeys";
    const showingKeys = document.cookie.split("; ").some((c) => c.startsWith(COOKIE_NAME + "="));

    const toggleWrap = document.createElement("label");
    Object.assign(toggleWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      cursor: "pointer",
      userSelect: "none",
      fontSize: "12px",
      fontWeight: "600",
      color: "#f5f5f7",
    });

    const toggleLabel = document.createElement("span");
    toggleLabel.textContent = "Show keys";
    toggleWrap.appendChild(toggleLabel);

    const toggleTrack = document.createElement("div");
    Object.assign(toggleTrack.style, {
      width: "36px",
      height: "20px",
      borderRadius: "10px",
      background: showingKeys ? "#30d158" : "#48484a",
      position: "relative",
      transition: "background 0.2s",
      flexShrink: "0",
    });

    const toggleThumb = document.createElement("div");
    Object.assign(toggleThumb.style, {
      width: "16px",
      height: "16px",
      borderRadius: "50%",
      background: "#fff",
      position: "absolute",
      top: "2px",
      left: showingKeys ? "18px" : "2px",
      transition: "left 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    });
    toggleTrack.appendChild(toggleThumb);
    toggleWrap.appendChild(toggleTrack);

    toggleWrap.addEventListener("click", () => {
      if (showingKeys) {
        document.cookie = COOKIE_NAME + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
      } else {
        document.cookie = COOKIE_NAME + "=true; path=/";
      }
      location.reload();
    });
    footer.appendChild(toggleWrap);

    const footerButtons = document.createElement("div");
    Object.assign(footerButtons.style, { display: "flex", gap: "8px" });

    if (keySet.size > 0) {
      const copyAll = document.createElement("button");
      copyAll.textContent = "Copy all keys";
      Object.assign(copyAll.style, { ...BTN_STYLE, background: "#4a6fa5" });
      copyAll.addEventListener("click", () => {
        navigator.clipboard.writeText([...keySet].sort().join("\n")).then(() => {
          copyAll.textContent = "Copied!";
          setTimeout(() => { copyAll.textContent = "Copy all keys"; }, 1200);
        });
      });
      footerButtons.appendChild(copyAll);
    }

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    Object.assign(refreshBtn.style, { ...BTN_STYLE, background: "#636366" });
    refreshBtn.addEventListener("click", run);
    footerButtons.appendChild(refreshBtn);

    footer.appendChild(footerButtons);

    panel.appendChild(footer);
    document.body.appendChild(panel);

    console.log(
      `%c MTD %c Found ${findings.length} missing translations (${keySet.size} unique)`,
      "background:#ff2d55;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold",
      "color:#ff2d55;font-weight:bold"
    );
    if (keySet.size > 0) console.table([...keySet].sort().map((k) => ({ key: k })));

    startNavigationWatch();
  }

  run();
})();
