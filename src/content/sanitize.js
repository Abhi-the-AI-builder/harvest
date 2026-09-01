// Section 9 guardrails — capture-time sanitization. This is layer 1 of 2:
// the background service worker re-sanitizes again before writing to
// IndexedDB (layer 2), and render-time sanitization (layer 3, Library /
// Compare / export) lands in later phases but the capture-time output here
// is written assuming it will always be re-checked, never trusted alone.
(function () {
  const Harvest = window.Harvest;

  const DANGEROUS_TAGS = ["script", "iframe", "object", "embed"];
  // Attributes that commonly carry personal/session data, or that can
  // execute (event handlers, javascript: URIs live in href/src which we
  // handle separately).
  const DROPPED_ATTR_PREFIXES = ["on", "data-"];
  const DROPPED_ATTRS = new Set([
    "srcdoc", // could embed an inline HTML document with live script
  ]);
  const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction"];
  const MAX_NODES = 500;
  const MAX_HTML_BYTES = 300 * 1024; // "a few hundred KB"

  // Real bug, found via adversarial testing: browsers strip ASCII tab/
  // newline/CR characters from ANYWHERE in a URL during parsing (WHATWG URL
  // spec — this is the actual mechanism behind the classic
  // "java\tscript:alert(1)" XSS filter bypass, not a theoretical concern).
  // The old `/^\s*javascript:/i` pattern only tolerates LEADING whitespace,
  // so `href="java\tscript:alert(1)"` sailed through as "not a javascript:
  // URI" while a real browser would still execute it as one on click.
  // Stripping those three characters from the whole string first (not just
  // testing around them) matches how the browser itself will actually
  // interpret the string, regardless of where the bypass characters sit.
  function isJavascriptUri(value) {
    if (!value) return false;
    return /^\s*javascript:/i.test(String(value).replace(/[\t\n\r]/g, ""));
  }

  function sanitizeAttributes(el) {
    // Never touch <input>/<textarea>/<select> current values — but note
    // .value is a JS property, not an attribute, so simply not reading it
    // anywhere in this pipeline is the real guarantee (see stripFieldValues).
    const toRemove = [];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (DROPPED_ATTRS.has(name)) {
        toRemove.push(attr.name);
        continue;
      }
      if (DROPPED_ATTR_PREFIXES.some((p) => name.startsWith(p))) {
        toRemove.push(attr.name);
        continue;
      }
      // aria-* attributes: keep structural ones (aria-hidden, aria-label on
      // decorative icons) is a judgment call the spec leaves open; per
      // Section 9 ("drop attributes that commonly carry personal or session
      // data") we drop ALL aria-* to stay on the safe side — they can carry
      // user-specific text (aria-label="Welcome, Jane").
      if (name.startsWith("aria-")) {
        toRemove.push(attr.name);
        continue;
      }
      if (URL_ATTRS.includes(name) && isJavascriptUri(attr.value)) {
        toRemove.push(attr.name);
        continue;
      }
    }
    toRemove.forEach((n) => el.removeAttribute(n));
  }

  function stripFieldValues(el) {
    // Form fields: keep the element (for visual/style reference) but never
    // let a current value survive into the clone. Clear both the attribute
    // (which clone already copied) and any inline reflection.
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      el.removeAttribute("value");
      el.value = "";
      el.removeAttribute("checked");
    } else if (tag === "textarea") {
      el.textContent = "";
      el.value = "";
    } else if (tag === "select") {
      for (const opt of Array.from(el.options)) {
        opt.removeAttribute("selected");
      }
      el.selectedIndex = -1;
    }
  }

  /**
   * Sanitizes a live DOM element for capture. Returns
   * { html, nodeCount, byteLength, oversized, containsLikelyPII }.
   * Operates on a detached clone — never mutates the live page.
   */
  Harvest.sanitizeCaptureElement = function sanitizeCaptureElement(liveEl) {
    if (DANGEROUS_TAGS.includes(liveEl.tagName.toLowerCase())) {
      // Defense in depth: the UI already refuses to offer "+ Collect" for
      // these (see overlay.js's iframe special-case), but never trust a
      // single layer — return an empty capture rather than ever cloning
      // a live <script>/<iframe>/<object>/<embed> as the root.
      return { html: "", nodeCount: 0, byteLength: 0, oversized: false, containsLikelyPII: false };
    }
    const clone = liveEl.cloneNode(true);

    // Remove dangerous descendant tags entirely.
    DANGEROUS_TAGS.forEach((tag) => {
      clone.querySelectorAll(tag).forEach((n) => n.remove());
    });

    let nodeCount = 1;
    const walk = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        sanitizeAttributes(node);
        stripFieldValues(node);
      }
      for (const child of Array.from(node.children || [])) {
        nodeCount += 1;
        walk(child);
      }
    };
    walk(clone);

    const html = clone.outerHTML || "";
    const byteLength = new Blob([html]).size;
    const oversized = nodeCount > MAX_NODES || byteLength > MAX_HTML_BYTES;
    const containsLikelyPII = Harvest.PII_PATTERN.test(
      clone.textContent || ""
    );

    return { html, nodeCount, byteLength, oversized, containsLikelyPII };
  };

  Harvest.SANITIZE_LIMITS = { MAX_NODES, MAX_HTML_BYTES };
  // Was private to this file — notes.js needs the same javascript: URI
  // check for links captured out of a text selection, and duplicating a
  // security check instead of sharing it is exactly the kind of drift
  // GROUND_RULES.md's sanitization rules are meant to prevent.
  Harvest.isJavascriptUri = isJavascriptUri;
})();
