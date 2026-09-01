// Persistent floating toggle (user-requested, modeled on the same pattern
// as the sibling Design System Extractor project's own on-page toolbar).
// Separate from the transient hover tooltip — this stays on screen the
// whole time, active or paused, so you can flip hover-capture on/off (or
// jump to the full side panel) without leaving the page. Mirrors the same
// `harvestActive` storage state the side panel's switch controls; either
// one changes it, both stay in sync via chrome.storage.onChanged.
(function () {
  const Harvest = window.Harvest;
  const ACCENT = "#1D3461"; // matches overlay.js — one accent across every Harvest surface
  const POS_STORAGE_KEY = "harvestToolbarPos";

  // Icons come from Harvest.ICONS (shared.js) — the exact same definitions
  // the side panel uses, so the two surfaces are actually one design
  // system, not two that happen to look similar.
  const { cursor: ICON_CURSOR, panel: ICON_PANEL, close: ICON_CLOSE } = Harvest.ICONS;
  const INTER_URL = chrome.runtime.getURL("fonts/Inter-var.woff2"); // same bundled local file overlay.js uses

  const SHEET = `
    :host {
      all: initial;
      /* Same token values as sidepanel.css and overlay.js — see design-tokens.md. */
      --color-surface: #FFFFFF;
      --color-text: #17181A;
      --color-text-muted: #6B6E76;
      --color-accent: ${ACCENT};
      --color-accent-wash: rgba(29,52,97,0.10);
      --color-bg: #FAFAFA;
      --color-border: rgba(23,24,26,0.09);
      --radius-sm: 8px;
      --shadow-overlay: 0 8px 24px rgba(23,24,26,0.14), 0 24px 48px rgba(23,24,26,0.16), 0 2px 6px rgba(23,24,26,0.08);
      --ease-fast: 120ms ease-out;
    }
    @font-face {
      font-family: "Inter";
      src: url("${INTER_URL}") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    * { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: var(--radius-sm); }
    /* Was a full 999px pill — the sibling Design System Extractor project's
       own floating bar deliberately uses a softer rounded-rect (its outer
       bar noticeably less round than a full pill, individual buttons
       rounder-cornered-square rather than circular) and reads more like a
       considered toolbar than a chip. The exact 12px/8px values from that
       project's own .bar/button CSS, not an approximation from Harvest's
       token scale — an earlier pass substituted --radius-lg (20px) here,
       which is visibly rounder than the 12px original and didn't actually
       match. */
    .pill {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
      background: var(--color-surface); border-radius: 12px;
      box-shadow: var(--shadow-overlay);
      border: 1px solid var(--color-border);
      display: flex; align-items: center; gap: 4px; padding: 4px;
      pointer-events: auto; transition: box-shadow var(--ease-fast);
    }
    .pill[hidden] { display: none; }
    .pill.dragging { box-shadow: var(--shadow-overlay); }
    .brand {
      width: 32px; height: 32px; flex: none; cursor: grab; touch-action: none;
      /* padding, not margin — margin is empty space outside the element's
         own box and never receives pointer events, so that whole gap
         between the logo and the next icon used to be dead air you
         couldn't grab; only the 32px logo square itself was draggable.
         Padding keeps the gap the same visual width but makes it part of
         .brand's own hit area, so the drag handle actually covers the
         space it visually implies. */
      padding-right: 20px; box-sizing: content-box;
      display: flex; align-items: center; justify-content: flex-start;
    }
    /* cover (not contain) + a real corner radius — matches the sibling
       project's own logo treatment for the same floating-bar mark, and
       gives the mark the same rounded-square language as the buttons
       beside it instead of a hard-edged square sitting among round ones. */
    .brand img { width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm); pointer-events: none; flex: none; }
    .brand:active { cursor: grabbing; }
    button {
      border: none; background: transparent; width: 32px; height: 32px; border-radius: var(--radius-sm);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      color: var(--color-text-muted); flex: none; transition: background var(--ease-fast), color var(--ease-fast);
    }
    button:hover { background: var(--color-bg); color: var(--color-text); }
    .toggle-btn[data-active="true"] { background: var(--color-accent-wash); color: var(--color-accent); }
    /* Every icon at the same size regardless of its own inline width/height
       — cursor/panel draw at 15x15, close at 13x13, note at 10x10 (all on
       the same 16x16 viewBox, just sized differently at authoring time),
       which threw off the row's visual rhythm exactly the way the sibling
       project's own floating toolbar described fixing for itself. One rule
       for every button's icon, not scoped to just .toggle-btn, so all four
       — cursor, notes, panel, close — actually align. */
    button svg { width: 16px; height: 16px; flex: none; }
    .divider { width: 1px; height: 18px; background: var(--color-border); margin: 0 1px; flex: none; }
  `;

  let host, shadow, pillEl, toggleBtn, notesToggleBtn;
  let active = false; // off until explicitly turned on (chrome.storage read below is the real source of truth)
  // A second, separate capture mode (highlight text on the page instead of
  // hovering an element) with its own storage key and its own listener
  // (src/content/notes.js). Off by default, same reasoning as `active`.
  // Mutually EXCLUSIVE with `active`, not independent — two capture
  // tooltips live on the same page at once read as broken/conflicting
  // (confirmed confusing in practice), so each toggle's click handler
  // below turns the other one off in the same storage write.
  let notesActive = false;
  // Persisted (chrome.storage.local), not a page-session in-memory flag —
  // it was reported that closing the pill and refreshing brought it right
  // back, which is a real "you skipped fixing this end to end" gap: a
  // close button whose effect doesn't survive a refresh isn't really a
  // close button. Global, same as harvestActive, not per-site — reachable
  // again via the "Show floating toolbar" link in the side panel footer
  // (see sidepanel.js), since removing it with no way back would be a trap.
  let dismissed = false;

  function ensureHost() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = SHEET;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    Harvest.registerOwnRoot(host);
  }

  function applyStoredPosition() {
    chrome.storage.local.get([POS_STORAGE_KEY], (res) => {
      const pos = res[POS_STORAGE_KEY];
      if (!pos) return; // no saved position — default bottom-right CSS stands
      const w = pillEl.offsetWidth || 140;
      const h = pillEl.offsetHeight || 40;
      const left = Math.min(Math.max(pos.left, 4), window.innerWidth - w - 4);
      const top = Math.min(Math.max(pos.top, 4), window.innerHeight - h - 4);
      pillEl.style.left = `${left}px`;
      pillEl.style.top = `${top}px`;
      pillEl.style.right = "auto";
      pillEl.style.bottom = "auto";
    });
  }

  function setupDrag(handle) {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      const rect = pillEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      pillEl.classList.add("dragging");
      pillEl.style.right = "auto";
      pillEl.style.bottom = "auto";
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = pillEl.offsetWidth;
      const h = pillEl.offsetHeight;
      const left = Math.min(Math.max(startLeft + dx, 4), window.innerWidth - w - 4);
      const top = Math.min(Math.max(startTop + dy, 4), window.innerHeight - h - 4);
      pillEl.style.left = `${left}px`;
      pillEl.style.top = `${top}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      pillEl.classList.remove("dragging");
      const rect = pillEl.getBoundingClientRect();
      chrome.storage.local.set({ [POS_STORAGE_KEY]: { left: rect.left, top: rect.top } });
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  // Shared by every button below that writes to chrome.storage — if this
  // page was already open when the extension got reloaded (exactly what
  // "reload done" mid-session means for any other already-open tab), the
  // content script's extension context is invalidated and any chrome.*
  // call throws synchronously. Without catching that, the click does
  // nothing at all with zero feedback — indistinguishable from a real bug.
  // panelBtn already had this exact guard (sendMessage failing the same
  // way); this generalizes it to toggleBtn/notesToggleBtn/closeBtn too, one
  // small flash of the actual fix (refresh the page) instead of silence.
  function makeStaleErrorFlasher(btn, idleHTML, idleTitle) {
    let timer = null;
    return function flash() {
      clearTimeout(timer);
      btn.innerHTML = Harvest.ICONS.warning;
      btn.title = "Harvest was reloaded — refresh this page to reconnect";
      timer = setTimeout(() => {
        btn.innerHTML = idleHTML;
        btn.title = idleTitle;
      }, 2200);
    };
  }

  function render() {
    ensureHost();
    if (pillEl) pillEl.remove();
    pillEl = document.createElement("div");
    pillEl.className = "pill";
    pillEl.hidden = dismissed;
    pillEl.setAttribute("role", "toolbar");
    pillEl.setAttribute("aria-label", "Harvest");

    const brand = document.createElement("div");
    brand.className = "brand";
    brand.title = "Drag to move";
    const brandImg = document.createElement("img");
    brandImg.src = chrome.runtime.getURL("icons/icon48.png");
    brandImg.alt = "Harvest";
    brandImg.draggable = false; // avoid the browser's native image-drag fighting our own pointer-based drag
    brand.appendChild(brandImg);
    pillEl.appendChild(brand);

    toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.dataset.active = String(active);
    toggleBtn.title = active ? "Hover-capture is on — click to pause" : "Hover-capture is paused — click to resume";
    toggleBtn.setAttribute("aria-pressed", String(active));
    toggleBtn.setAttribute("aria-label", "Toggle hover-capture");
    toggleBtn.innerHTML = ICON_CURSOR;
    const flashToggleStale = makeStaleErrorFlasher(toggleBtn, ICON_CURSOR, toggleBtn.title);
    toggleBtn.addEventListener("click", () => {
      const next = !active;
      try {
        // Switching one capture mode on turns the other off — see the
        // matching comment on sidepanel.js's setHarvestActive. Both this
        // file and sidepanel.js write storage directly (no shared function
        // between the two contexts), so this exclusivity rule is
        // duplicated in both places on purpose, kept identical.
        chrome.storage.local.set(next ? { harvestActive: true, harvestNotesActive: false } : { harvestActive: false });
      } catch (_) {
        flashToggleStale();
      }
    });
    pillEl.appendChild(toggleBtn);

    // Second, independent toggle — text-selection capture (notes.js). Same
    // button shape/pattern as the hover-capture toggle above, own storage
    // key, own icon (Harvest.ICONS.note — already exists, used elsewhere
    // for the note-badge/edit affordances, reused here rather than
    // inventing a new glyph).
    notesToggleBtn = document.createElement("button");
    notesToggleBtn.className = "toggle-btn";
    notesToggleBtn.type = "button";
    notesToggleBtn.dataset.active = String(notesActive);
    notesToggleBtn.title = notesActive
      ? "Notes capture is on — select text on the page to collect it"
      : "Notes capture is off — click to turn on";
    notesToggleBtn.setAttribute("aria-pressed", String(notesActive));
    notesToggleBtn.setAttribute("aria-label", "Toggle text-selection notes capture");
    notesToggleBtn.innerHTML = Harvest.ICONS.note;
    const flashNotesToggleStale = makeStaleErrorFlasher(notesToggleBtn, Harvest.ICONS.note, notesToggleBtn.title);
    notesToggleBtn.addEventListener("click", () => {
      const next = !notesActive;
      try {
        chrome.storage.local.set(next ? { harvestNotesActive: true, harvestActive: false } : { harvestNotesActive: false });
      } catch (_) {
        flashNotesToggleStale();
      }
    });
    pillEl.appendChild(notesToggleBtn);

    const panelBtn = document.createElement("button");
    panelBtn.type = "button";
    panelBtn.title = "Open Harvest panel";
    panelBtn.setAttribute("aria-label", "Open Harvest side panel");
    panelBtn.innerHTML = ICON_PANEL;
    // sidePanel.open() can fail even when called correctly (background.js)
    // — an icon-only button has no room for error text, so a brief swap to
    // a warning glyph is the whole feedback, but it beats a silent no-op:
    // at least the click visibly did something, and the button stays put
    // to retry from instead of the panel just never appearing with no clue
    // why.
    let panelBtnErrorTimer = null;
    function flashPanelBtnError() {
      clearTimeout(panelBtnErrorTimer);
      panelBtn.innerHTML = Harvest.ICONS.warning;
      panelBtn.title = "Couldn't open the panel — try again";
      panelBtnErrorTimer = setTimeout(() => {
        panelBtn.innerHTML = ICON_PANEL;
        panelBtn.title = "Open Harvest panel";
      }, 1800);
    }
    panelBtn.addEventListener("click", () => {
      // Dismissing the floating pill on a successful open used to be this
      // button's own job — sidepanel.js now does it unconditionally the
      // moment its own script runs, for every path that opens the panel
      // (this message, or the real browser toolbar icon, which
      // background.js never even sees), so this handler only needs to
      // report failure.
      try {
        chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            flashPanelBtnError();
          }
        });
      } catch (_) {
        // Extension context invalidated (reloaded while this page was
        // already open) — without this the click would do nothing at all,
        // not even the error flash, since the throw happens before the
        // callback ever gets a chance to run.
        flashPanelBtnError();
      }
    });
    pillEl.appendChild(panelBtn);

    const divider = document.createElement("div");
    divider.className = "divider";
    pillEl.appendChild(divider);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.title = "Turn off hover-capture and hide this toolbar";
    closeBtn.setAttribute("aria-label", "Turn off hover-capture and hide Harvest toolbar");
    closeBtn.innerHTML = ICON_CLOSE;
    const flashCloseStale = makeStaleErrorFlasher(closeBtn, ICON_CLOSE, closeBtn.title);
    closeBtn.addEventListener("click", () => {
      // Closing used to only hide the pill — hover-capture kept running
      // invisibly underneath (no toolbar on screen, but hovering the page
      // still popped tooltips) until you separately remembered to click
      // the cursor toggle first. "Close" pausing capture too, in one click,
      // is what "close means close" actually means — you shouldn't have to
      // turn the tool off and then close it as two separate steps.
      //
      // Wrapped in try/catch (was missing before): a page left open across
      // an extension reload has an invalidated context, so this call
      // throws — previously that meant the click did visibly nothing at
      // all, which is exactly "clicking the X doesn't close it."
      try {
        chrome.storage.local.set({ harvestActive: false, harvestToolbarDismissed: true });
      } catch (_) {
        flashCloseStale();
      }
    });
    pillEl.appendChild(closeBtn);

    shadow.appendChild(pillEl);
    setupDrag(brand);
    applyStoredPosition();
  }

  function setActive(next) {
    active = next;
    if (toggleBtn) {
      toggleBtn.dataset.active = String(active);
      toggleBtn.title = active ? "Hover-capture is on — click to pause" : "Hover-capture is paused — click to resume";
      toggleBtn.setAttribute("aria-pressed", String(active));
    }
  }

  function setNotesActive(next) {
    notesActive = next;
    if (notesToggleBtn) {
      notesToggleBtn.dataset.active = String(notesActive);
      notesToggleBtn.title = notesActive
        ? "Notes capture is on — select text on the page to collect it"
        : "Notes capture is off — click to turn on";
      notesToggleBtn.setAttribute("aria-pressed", String(notesActive));
    }
  }

  chrome.storage.local.get(["harvestActive", "harvestToolbarDismissed", "harvestNotesActive"], (res) => {
    active = res.harvestActive === true;
    dismissed = Boolean(res.harvestToolbarDismissed);
    notesActive = res.harvestNotesActive === true;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.harvestActive) {
      setActive(changes.harvestActive.newValue === true);
    }
    if (changes.harvestToolbarDismissed) {
      dismissed = Boolean(changes.harvestToolbarDismissed.newValue);
      if (pillEl) {
        pillEl.hidden = dismissed;
        // applyStoredPosition's own clamp only has something real to clamp
        // against once the pill is actually laid out — offsetWidth reads 0
        // while `hidden`, which was falling back to a rough 140px guess at
        // the render() call that first set this up (often while the pill
        // started out dismissed). That guess is narrower than the real
        // pill, so the position it clamped to could sit the real, wider
        // pill partway off the right/bottom edge once shown — reproduced:
        // collapsing to the floating toolbar left it with its right edge
        // ~69px past the actual viewport. Re-clamping here, right as it
        // becomes visible, uses the pill's real width/height and the
        // window's current size instead of a stale guess.
        if (!dismissed) applyStoredPosition();
      }
    }
    if (changes.harvestNotesActive) {
      setNotesActive(changes.harvestNotesActive.newValue === true);
    }
  });
})();
