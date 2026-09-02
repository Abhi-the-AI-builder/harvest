(function () {
  // Figma's public REST API has no endpoint that creates design nodes —
  // that only exists via the Plugin API, which is exactly what the
  // companion harvest-figma-plugin/ in this repo uses:
  // "Export to Figma" downloads the v2 JSON payload that plugin's code.js
  // already parses (layoutTree-aware, per-type node building —
  // buildComponentCardFromTree etc.). This is the real, working path to
  // actual Figma layers — turned on.
  const ENABLE_FIGMA_EXPORT = true;
  // "Download JSON for plugin" — full layoutTree export as a file, for
  // debugging or manual import. Hidden when false; performPluginJsonExport()
  // stays wired either way.
  const ENABLE_FIGMA_PLUGIN_COPY = true;
  const gridEl = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const siteLineEl = document.getElementById("site-line");
  const siteLineTextEl = document.getElementById("site-line-text");
  const collapseBtn = document.getElementById("collapse-btn");
  const activeToggle = document.getElementById("active-toggle");
  const notesToggle = document.getElementById("notes-toggle");
  const libraryGridEl = document.getElementById("library-grid");
  const libraryEmptyEl = document.getElementById("library-empty");
  const backBtn = document.getElementById("back-to-library-btn");
  const selectToggleBtn = document.getElementById("select-toggle-btn");
  const libraryTabsEl = document.getElementById("library-tabs");
  const tabSitesBtn = document.getElementById("tab-sites");
  const tabCollectionsBtn = document.getElementById("tab-collections");
  const tabNotesBtn = document.getElementById("tab-notes");
  const collectionsGridEl = document.getElementById("collections-grid");
  const collectionsEmptyEl = document.getElementById("collections-empty");
  const notesGridEl = document.getElementById("notes-grid");
  const notesEmptyEl = document.getElementById("notes-empty");
  const selectBarEl = document.getElementById("select-bar");
  const selectChipsEl = document.getElementById("select-chips");
  const selectExportZipBtn = document.getElementById("select-export-zip-btn");
  const selectExportToggleBtn = document.getElementById("select-export-toggle-btn");
  const selectExportMenu = document.getElementById("select-export-menu");
  const selectExportNotionBtn = document.getElementById("select-export-notion-btn");
  const selectExportFigmaBtn = document.getElementById("select-export-figma-btn");
  const selectExportPluginCopyBtn = document.getElementById("select-export-plugin-copy-btn");
  const selectAddBtn = document.getElementById("select-add-btn");
  const selectRemoveBtn = document.getElementById("select-remove-btn");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const compareToggle = document.getElementById("compare-toggle");
  const libraryTabsSelectToggle = document.getElementById("library-select-toggle");
  const librarySelectBarEl = document.getElementById("library-select-bar");
  const librarySelectSummaryEl = document.getElementById("library-select-summary");
  const libraryExportZipBtn = document.getElementById("library-export-zip-btn");
  const libraryExportToggleBtn = document.getElementById("library-export-toggle-btn");
  const libraryExportMenu = document.getElementById("library-export-menu");
  const libraryExportNotionBtn = document.getElementById("library-export-notion-btn");
  const libraryExportFigmaBtn = document.getElementById("library-export-figma-btn");
  const libraryExportPluginCopyBtn = document.getElementById("library-export-plugin-copy-btn");
  const compareViewEl = document.getElementById("compare-view");
  const compareHeadingSelect = document.getElementById("compare-heading-select");
  const compareBodySelect = document.getElementById("compare-body-select");
  const compareEmptyEl = document.getElementById("compare-empty");
  const compareSampleEl = document.getElementById("compare-sample");
  const compareSampleHeadingEl = document.getElementById("compare-sample-heading");
  const compareSampleBodyEl = document.getElementById("compare-sample-body");
  const compareSaveBtn = document.getElementById("compare-save-btn");
  activeToggle.innerHTML = Harvest.ICONS.cursor;
  notesToggle.innerHTML = Harvest.ICONS.note;
  compareToggle.innerHTML = Harvest.ICONS.compare;
  collapseBtn.innerHTML = Harvest.ICONS.panel;

  // With Figma export off, only its own 3 menu items hide — the chevron
  // and dropdown themselves stay (Export to Notion is a real, independent
  // destination now, not gated by this flag). Only fall back to the
  // full-pill "nothing to open" treatment if Notion ever gets flagged off
  // too and truly leaves the menu empty.
  if (!ENABLE_FIGMA_EXPORT) {
    document.querySelectorAll("#library-export-figma-btn, #select-export-figma-btn").forEach((btn) => { btn.hidden = true; });
  }
  if (!ENABLE_FIGMA_PLUGIN_COPY) {
    document.querySelectorAll("#library-export-plugin-copy-btn, #select-export-plugin-copy-btn").forEach((btn) => { btn.hidden = true; });
  }

  // Expanded-view density toggle was removed — the Library now always
  // renders in compact/grid mode. Kept as a constant (not deleted outright)
  // since the expanded-card rendering branches below still read it; this
  // keeps them permanently on the grid path without touching that logic.
  const expanded = false;
  let currentHostname = null;
  let currentCollectionId = null;
  // Which side a Collection's detail view was opened from — "notes" when
  // reached via the Notes tab's "My folders" section, "default" via the
  // Collections tab. A mixed Collection (some notes, some not) shows in
  // BOTH tabs' grids (see showLibraryCollections/showLibraryNotes), so the
  // detail view itself has to filter by this instead of showing everything
  // it resolves — otherwise opening it from the Notes side would leak
  // non-note items into a "notes" view and vice versa.
  let currentCollectionMode = "default";
  // 'auto-site': currentHostname always follows whatever tab is active
  // (the default). 'manual-site': showing a specific folder the user
  // picked from the library grid — tab changes must NOT yank this away
  // mid-browse. 'library': the all-sites/collections grid. 'collection-
  // detail': one collection's resolved items.
  let viewMode = "auto-site";
  let libraryTab = "sites"; // 'sites' | 'collections' | 'notes', sub-tab within 'library' viewMode

  // Multi-select — scoped to the two views that show individual ITEMS
  // (per-site and collection-detail). The folder grid and collections grid
  // show folders/collections, not items, so "select items to add to a
  // collection" doesn't apply there.
  let selectMode = false;
  let selectedItems = new Map(); // id -> item

  // Folder-level select — scoped to the Sites tab of the library grid.
  // Replaces the old standalone top-bar Export button: pick one or more
  // site folders here, then export exactly that selection from the bar
  // that appears, instead of a separate always-visible Export screen.
  let folderSelectMode = false;
  let selectedFolderHostnames = new Set();
  let selectedFolderItemsMap = new Map(); // hostname -> that folder's items, refreshed on each toggle

  // Real icons, not letters — matches the tooltip's own type-icon badges
  // (overlay.js) so the same four categories read as the same four glyphs
  // everywhere they appear in the product, not a different abbreviation
  // scheme per surface.
  const TYPE_CHIP = {
    color: Harvest.ICONS.ring,
    font: Harvest.ICONS.font,
    image: Harvest.ICONS.image,
    component: Harvest.ICONS.component,
    note: Harvest.ICONS.note,
  };

  // Same 4-color palette as the capture-time picker (src/content/notes.js'
  // NOTE_COLORS) — duplicated values, not shared code, same tradeoff every
  // other design token in this codebase already makes across the content-
  // script/side-panel boundary. Used to tint a note's badge to whichever
  // color it was captured with, defaulting to "blue" for notes captured
  // before this feature existed (item.data.color is simply absent on
  // those — same default the capture-time picker itself starts from).
  const NOTE_COLORS = {
    blue: { bg: "#E3EEFB", fg: "#2A6CA8" },
    green: { bg: "#E1F3E5", fg: "#2F7D4F" },
    yellow: { bg: "#FCF1CF", fg: "#9C7A0A" },
    pink: { bg: "#FBE7EE", fg: "#B23E68" },
  };

  // Predefined tags — the handful a highlighter/research tool's users
  // actually reach for over and over (matches what Diigo suggests and what
  // Hypothesis/Glasp users converge on freely): a reason to keep it (worth
  // circling back to, worth citing), a reminder to circle back, or a
  // reading-response category. Fixed set, not free-form — a note capture
  // is a fast, in-flow action; typing a new tag name mid-read is exactly
  // the friction this whole feature exists to avoid. One shared list, used
  // everywhere a note renders (buildNoteTile is the only place notes ever
  // render — the aggregate Notes tab AND every per-site folder's own Notes
  // section both call it), so a tag picked in one context looks and behaves
  // identically in the other, not two separate implementations to keep in sync.
  // Each tag gets its own line-icon (Pattern 3 — categorization reads by
  // shape, not just by reading five words in a plain list), but NOT five
  // more colors on top of the 4 capture-type + 4 note colors already in
  // the system — Section 2's color budget stays intact; every tag icon
  // shares the one existing accent tint, differentiated by glyph alone.
  const NOTE_TAGS = [
    {
      key: "important",
      label: "Important",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><line x1="8" y1="5" x2="8" y2="9.2"/><circle cx="8" cy="11.2" r="0.6" fill="currentColor" stroke="none"/></svg>`,
    },
    {
      key: "idea",
      label: "Idea",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.8 1 .8 1.6v.3h3.2v-.3c0-.6.3-1.2.8-1.6A4.2 4.2 0 0 0 8 1.8Z"/><line x1="6.4" y1="13.4" x2="9.6" y2="13.4"/><line x1="6.8" y1="14.6" x2="9.2" y2="14.6"/></svg>`,
    },
    {
      key: "quote",
      label: "Quote",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.6c0-1.8 1-2.9 2.6-3.2M3 6.6v2.8a1 1 0 0 0 1 1h1.4a1 1 0 0 0 1-1V8.2a1 1 0 0 0-1-1H3.9"/><path d="M9.4 6.6c0-1.8 1-2.9 2.6-3.2M9.4 6.6v2.8a1 1 0 0 0 1 1h1.4a1 1 0 0 0 1-1V8.2a1 1 0 0 0-1-1h-1.5"/></svg>`,
    },
    {
      key: "toread",
      label: "To-read",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5h7a1 1 0 0 1 1 1v10l-4.5-3-4.5 3v-10a1 1 0 0 1 1-1Z"/></svg>`,
    },
    {
      key: "question",
      label: "Question",
      icon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M6.3 6.3a1.75 1.75 0 1 1 2.7 1.5c-.55.4-.9.75-.9 1.5v.2"/><circle cx="8" cy="11.1" r="0.6" fill="currentColor" stroke="none"/></svg>`,
    },
  ];

  function relativeTime(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  // Day-level grouping for the Notes views — "Today" / "Yesterday" / the
  // weekday name / a full date, same chronological-clustering idea as a
  // journal timeline (as opposed to relativeTime above, which is per-item
  // and keeps ticking — "3h ago" on one note and "Today" as its group
  // header would read as two different clocks disagreeing with each
  // other, so this is calendar-day math, not elapsed-time math).
  function dateGroupLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(
      undefined,
      d.getFullYear() === now.getFullYear()
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" }
    );
  }

  // notes must already be sorted newest-first (both call sites already
  // sort this way) — grouping just walks that order and opens a new
  // cluster whenever the label changes, so it stays a single pass with no
  // separate sort/bucket-then-reorder step.
  function groupNotesByDate(notes) {
    const groups = [];
    let currentLabel = null;
    let currentGroup = null;
    notes.forEach((item) => {
      const label = dateGroupLabel(item.capturedAt);
      if (label !== currentLabel) {
        currentLabel = label;
        currentGroup = { label, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(item);
    });
    return groups;
  }

  // Splits an already-ordered list of notes into consecutive runs sharing
  // the same source page — every note in a run repeated the identical
  // "www.example.com · 43m ago" caption before, which stopped reading as
  // useful the moment you'd collected several notes in one sitting off the
  // same page (or the same site). Grouped by sourceUrl specifically (not
  // just hostname) so a same-site page change still starts a new run, not
  // just a cross-site one — a URL falling back to hostname only when a
  // note genuinely has no sourceUrl at all.
  function groupNotesBySource(items) {
    const runs = [];
    let currentKey = null;
    let currentRun = null;
    items.forEach((item) => {
      const key = item.sourceUrl || item.hostname || "";
      if (key !== currentKey) {
        currentKey = key;
        currentRun = { item, items: [] };
        runs.push(currentRun);
      }
      currentRun.items.push(item);
    });
    return runs;
  }

  // The one-time header shown above a run of same-source notes — same
  // real <a> + icon + hostname the per-tile caption already used, just
  // shown once per run instead of once per tile.
  function buildNoteSourceHeader(item) {
    const header = document.createElement("div");
    header.className = "note-source-group-header";
    let sourceLabel = item.sourceUrl || item.hostname || "";
    try {
      if (item.sourceUrl) sourceLabel = new URL(item.sourceUrl).hostname;
    } catch (_) {
      // sourceUrl wasn't a real URL — fall back to whatever string we had
    }
    if (item.sourceUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "note-tile-source-link";
      sourceLink.href = item.sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.title = `Open ${sourceLabel}`;
      const linkIcon = document.createElement("span");
      linkIcon.innerHTML = Harvest.ICONS.externalLink;
      sourceLink.appendChild(linkIcon);
      const linkLabel = document.createElement("span");
      linkLabel.textContent = sourceLabel;
      sourceLink.appendChild(linkLabel);
      header.appendChild(sourceLink);
    } else {
      const label = document.createElement("span");
      label.textContent = sourceLabel;
      header.appendChild(label);
    }
    return header;
  }

  // Shared by both places notes render as a list (the per-site Notes
  // section inside render(), and the cross-site Notes tab's
  // showLibraryNotes()) — one grouping implementation, not two copies that
  // could drift.
  function appendGroupedNoteTiles(container, notes) {
    groupNotesByDate(notes).forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "note-date-group";

      // The label is a real button now, not a static span — clicking it
      // collapses/expands this day's notes. Collapse state lives only on
      // this DOM node (no persistence): reopening the panel always starts
      // expanded, which matters more than remembering a UI toggle across
      // sessions for something this lightweight.
      const label = document.createElement("button");
      label.type = "button";
      label.className = "note-date-group-label";
      label.setAttribute("aria-expanded", "true");
      const labelText = document.createElement("span");
      labelText.textContent = group.label;
      label.appendChild(labelText);
      const chevron = document.createElement("span");
      chevron.className = "note-date-group-chevron";
      chevron.innerHTML = `<svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1.5 6 6.5 11 1.5"/></svg>`;
      label.appendChild(chevron);
      groupEl.appendChild(label);

      // A separate wrapper for the tiles themselves — collapsing hides
      // this one element (display:none) rather than juggling visibility
      // on every individual tile, and keeps the label as a permanent,
      // always-visible sibling regardless of collapse state.
      const itemsWrap = document.createElement("div");
      itemsWrap.className = "note-date-group-items";
      groupNotesBySource(group.items).forEach((run) => {
        // Real per-item identity (which exact source URL, at what exact
        // time) never goes away — it's still on every tile's own title/
        // href, still exported/copied correctly, still what "+ Tag" and
        // delete act on. Only the REPEATED on-screen caption line is
        // deduplicated; a single-note run still shows its own caption
        // exactly as before (no header needed for something that isn't
        // actually repeating).
        if (run.items.length > 1) {
          itemsWrap.appendChild(buildNoteSourceHeader(run.item));
          run.items.forEach((item) => itemsWrap.appendChild(buildNoteTile(item, false)));
        } else {
          run.items.forEach((item) => itemsWrap.appendChild(buildNoteTile(item, true)));
        }
      });
      groupEl.appendChild(itemsWrap);

      label.addEventListener("click", () => {
        const collapsed = groupEl.classList.toggle("is-collapsed");
        label.setAttribute("aria-expanded", String(!collapsed));
      });

      container.appendChild(groupEl);
    });
  }

  // --- Toast (undo) ------------------------------------------------
  function showToast(message, undoFn) {
    toastRoot.innerHTML = "";
    const toast = document.createElement("div");
    toast.className = "sp-toast";
    toast.setAttribute("role", "status");
    const msg = document.createElement("span");
    msg.textContent = message;
    toast.appendChild(msg);
    if (undoFn) {
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "sp-toast-undo";
      undoBtn.textContent = "Undo";
      undoBtn.addEventListener("click", () => {
        toastRoot.innerHTML = "";
        undoFn();
      });
      toast.appendChild(undoBtn);
    }
    toastRoot.appendChild(toast);
    // ~10s window for destructive-delete undo (Section 8: "support undo
    // for at least ~10 seconds after deletion" for folder delete; kept the
    // same duration for item delete too rather than a shorter, different
    // timer to remember).
    setTimeout(() => {
      if (toastRoot.contains(toast)) toastRoot.removeChild(toast);
    }, 10000);
  }

  const sanitizeFilename = HarvestExportHelpers.sanitizeFilename;
  let exportContext = null;

  function showExportFeedback(msg, type = "info") {
    showToast(type === "error" ? `${msg}` : msg, null);
  }

  const copyDeps = {
    showFeedback: showExportFeedback,
    showToast,
  };

  // --- Lightweight custom confirm modal (never native window.confirm) ---
  function showConfirm({ title, body, confirmLabel, onConfirm }) {
    modalRoot.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "sp-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sp-modal";
    const h = document.createElement("div");
    h.className = "sp-modal-title";
    h.textContent = title;
    const p = document.createElement("div");
    p.className = "sp-modal-body";
    p.textContent = body;
    const actions = document.createElement("div");
    actions.className = "sp-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sp-modal-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => { modalRoot.innerHTML = ""; });
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "sp-modal-confirm";
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener("click", () => {
      modalRoot.innerHTML = "";
      onConfirm();
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(h);
    modal.appendChild(p);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) modalRoot.innerHTML = "";
    });
    modalRoot.appendChild(overlay);
  }

  // --- Note editor (add/edit a note after capture) -------------------
  // The tooltip's own note field (overlay.js) only ever runs once, at
  // capture time — this is the one place a note can be added or changed
  // afterward. Sends the same UPDATE_NOTE message background.js already
  // handles (HarvestDB.updateItemNote + an ITEMS_UPDATED broadcast this
  // panel already listens for below), so no separate refresh call is
  // needed here — the existing listener repaints the grid once it lands.
  function showNoteEditor(item) {
    modalRoot.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "sp-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sp-modal sp-modal-note";

    const h = document.createElement("div");
    h.className = "sp-modal-title";
    h.textContent = item.note ? "Edit note" : "Add a note";
    modal.appendChild(h);

    const textarea = document.createElement("textarea");
    textarea.className = "note-editor-textarea";
    textarea.maxLength = 140;
    textarea.value = item.note || "";
    textarea.placeholder = "A short note about this capture…";
    modal.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "sp-modal-actions";
    actions.style.marginTop = "var(--space-4)";

    if (item.note) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "note-editor-remove";
      removeBtn.innerHTML = Harvest.ICONS.trash;
      removeBtn.title = "Remove note";
      removeBtn.setAttribute("aria-label", "Remove note");
      removeBtn.addEventListener("click", () => {
        modalRoot.innerHTML = "";
        chrome.runtime.sendMessage({ type: "UPDATE_NOTE", payload: { id: item.id, note: "" } });
      });
      actions.appendChild(removeBtn);
    }
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "sp-modal-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => { modalRoot.innerHTML = ""; });
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "sp-modal-confirm sp-modal-confirm-accent";
    saveBtn.textContent = "Save note";
    saveBtn.addEventListener("click", () => {
      const note = textarea.value.trim();
      modalRoot.innerHTML = "";
      chrome.runtime.sendMessage({ type: "UPDATE_NOTE", payload: { id: item.id, note } });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) modalRoot.innerHTML = ""; });
    modalRoot.appendChild(overlay);
    textarea.focus();
  }

  function buildThumbNode(item) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:inherit;";

    if (item.type === "color") {
      wrap.style.backgroundColor = item.data.hex || "#ccc";
      wrap.title = item.data.hex || "";
    } else if (item.type === "font") {
      // A clean "Aa" glyph set in the actual captured font — not the raw
      // scraped sentence text. The raw text was wrapping mid-word with no
      // ellipsis inside a tiny square tile, which read as broken rather
      // than "extracted." Every other font surface in this product (the
      // tooltip's session-capture stack, the empty-state illustration)
      // already uses this same glyph-only treatment — this was the one
      // inconsistent spot still dumping arbitrary page text in.
      wrap.style.background = "var(--type-font-bg)";
      const glyph = document.createElement("div");
      glyph.className = "font-sample";
      glyph.textContent = "Aa";
      glyph.style.fontFamily = item.data.fallbackStack || "sans-serif";
      glyph.style.fontWeight = item.data.weight || "600";
      wrap.appendChild(glyph);
    } else if (item.type === "image" && item.data.url && item.data.isVideo) {
      // GIF captured as a <video> (the common modern replacement for real
      // .gif files) — an <img> tag can't render a video file at all, it'd
      // just show a broken-image glyph, so this needs its own element.
      const video = document.createElement("video");
      video.src = item.data.url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "width:100%; height:100%; object-fit:cover;";
      wrap.appendChild(video);
    } else if (item.type === "image" && item.data.url) {
      const img = document.createElement("img");
      img.src = item.data.url;
      Harvest.withPinterestFallback(img, item.data.url);
      img.alt = item.data.altText || "";
      img.loading = "lazy";
      wrap.appendChild(img);
    } else if (item.type === "note") {
      // Fell through to the generic "component" glyph before this branch
      // existed — a notes-only folder's cover showed the wrong capture
      // type entirely, which reads as "this folder doesn't actually have
      // my notes in it" even though it does. Same tinted-badge treatment
      // as everywhere else a note appears (the tooltip's type-badge, the
      // note-tile chip), colored by this specific note's own color pick.
      const c = NOTE_COLORS[item.data && item.data.color] || NOTE_COLORS.blue;
      wrap.style.background = c.bg;
      const icon = document.createElement("div");
      icon.style.cssText = "display:flex; color:" + c.fg + ";";
      icon.innerHTML = Harvest.ICONS.note;
      // Harvest.ICONS.note ships intrinsically 10x10 (sized for an 18px
      // inline badge elsewhere) — too small on its own for this bigger
      // thumbnail slot, so scaled up here to match the other type glyphs'
      // presence in the same spot (.component-icon svg is 22px).
      const svg = icon.querySelector("svg");
      if (svg) { svg.setAttribute("width", "22"); svg.setAttribute("height", "22"); }
      wrap.appendChild(icon);
    } else if (item.data && item.data.previewImage) {
      // A real screenshot of the component, captured at collect time
      // (captureElementPreview, overlay.js) — the exact thing that was
      // collected, not just a piece of it or a generic icon.
      const img = document.createElement("img");
      img.src = item.data.previewImage;
      img.alt = "";
      img.loading = "lazy";
      wrap.appendChild(img);
    } else {
      // Older items captured before the real-screenshot feature existed
      // have no previewImage — a component that actually contains a real
      // photo still gets that photo as its thumbnail, parsed from the
      // stored (already-sanitized) outerHTML string rather than a live
      // element, since that's all a library tile has.
      const previewSrc = componentPreviewSrcFrom(item.data && item.data.outerHTML, item.sourceUrl);
      if (previewSrc) {
        const img = document.createElement("img");
        img.src = previewSrc;
        Harvest.withPinterestFallback(img, previewSrc);
        img.alt = "";
        img.loading = "lazy";
        wrap.appendChild(img);
      } else {
        // Flat accent-wash card with a centered glyph, instead of a bare
        // icon floating on the tile's plain surface — a component capture
        // has no photographic thumbnail of its own, so it needs a
        // deliberate placeholder treatment rather than reading as "thumbnail
        // failed to load."
        wrap.style.background = "var(--color-accent-wash)";
        const icon = document.createElement("div");
        icon.className = "component-icon";
        const kind = Harvest.componentIconFor(item.data && item.data.outerHTML);
        icon.innerHTML = kind === "image" ? Harvest.ICONS.image : kind === "font" ? Harvest.ICONS.font : Harvest.ICONS.component;
        wrap.appendChild(icon);
      }
    }
    return wrap;
  }

  // Shared by buildThumbNode's component branch and buildCard's own
  // component preview (below) — parses the stored outerHTML string (a
  // component item has no live element by the time it's shown here, just
  // this string) for the first real <img>/<video> and returns a usable src,
  // or null if there isn't one. DOMParser, not a regex, so this can't be
  // fooled by an unrelated src-looking attribute inside e.g. an inline SVG.
  function componentPreviewSrcFrom(outerHTML, sourceUrl) {
    if (!outerHTML) return null;
    try {
      const doc = new DOMParser().parseFromString(outerHTML, "text/html");
      const media = doc.querySelector("img, video");
      if (!media) return null;
      // Read the raw attribute, not the .src/.currentSrc IDL property — this
      // node was never attached to the real page, just parsed here in the
      // side panel's own chrome-extension:// document, so those properties
      // would resolve a relative path against the WRONG origin. Resolving
      // the raw string against the item's own sourceUrl (the page it was
      // actually captured from) is what gets a relative "/img/foo.jpg" back
      // to the real https://the-site.com/img/foo.jpg it always meant.
      // Same lazy-load gap Harvest.resolveImgSrc covers for a live element
      // — checked as raw attributes here too, not that helper directly,
      // since this node was never attached to the real page (its own
      // .src/.currentSrc IDL properties would resolve against the wrong
      // origin, per the comment above).
      const lazyAttrs = ["src", "data-src", "data-lazy-src", "data-original", "data-lazy"];
      const firstAttr = (el) => {
        for (const attr of lazyAttrs) {
          const val = el.getAttribute(attr);
          if (val) return val;
        }
        return null;
      };
      const raw = media.tagName.toLowerCase() === "video"
        ? firstAttr(media) || (media.querySelector("source") && firstAttr(media.querySelector("source")))
        : firstAttr(media);
      if (!raw) return null;
      if (/^(data:|https?:)/i.test(raw)) return raw;
      if (!sourceUrl) return null;
      return new URL(raw, sourceUrl).href;
    } catch (_) {
      return null;
    }
  }

  // --- Delete (item) -------------------------------------------------
  async function deleteItemFlow(item) {
    const result = await HarvestDB.deleteItem(item.id);
    if (!result) return;
    const affected = result.affectedCollections;
    const msg =
      affected.length > 0
        ? `Deleted — also removed from ${affected.length} collection${affected.length === 1 ? "" : "s"}`
        : "Deleted";
    showToast(msg, async () => {
      await HarvestDB.restoreItem(result.item, affected.map((c) => c.id));
      refreshCurrentView();
    });
    refreshCurrentView();
  }

  function buildDeleteBtn(onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-delete-btn";
    btn.innerHTML = Harvest.ICONS.close;
    btn.setAttribute("aria-label", "Delete");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function buildDownloadBtn(onClick, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-download-btn";
    btn.innerHTML = Harvest.ICONS.download;
    btn.setAttribute("aria-label", label || "Download this image");
    btn.title = "Download";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function buildCopyBtn(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-copy-btn";
    btn.innerHTML = Harvest.ICONS.copy;
    btn.setAttribute("aria-label", "Copy this item");
    btn.title = "Copy";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyOneItem(item, btn);
    });
    return btn;
  }

  function appendTileActionButtons(tile, item) {
    const hasDownload = item.type === "image" || item.type === "component";
    const copyBtn = buildCopyBtn(item);
    if (hasDownload) {
      copyBtn.classList.add("card-copy-btn-with-download");
      tile.appendChild(copyBtn);
      if (item.type === "image") tile.appendChild(buildDownloadBtn(() => downloadOneImage(item)));
      else tile.appendChild(buildDownloadBtn(() => downloadOneComponent(item), "Download this component"));
    } else {
      tile.appendChild(copyBtn);
    }
    if (!item.note) tile.appendChild(buildEditBtn(item));
  }

  async function copyOneItem(item, btn) {
    await HarvestClipboardCopy.copySingleItem(item, btn, copyDeps);
  }

  // Factored out the same way buildDeleteBtn/buildDownloadBtn already are —
  // was previously inlined once, only inside buildTile; buildRichCard now
  // needs the identical button too, so it's a shared helper instead of a
  // second copy-pasted block.
  function buildEditBtn(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile-edit-btn";
    btn.innerHTML = Harvest.ICONS.edit;
    btn.setAttribute("aria-label", "Add a note");
    btn.title = "Add a note";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showNoteEditor(item);
    });
    return btn;
  }

  // Cross-origin image URLs ignore <a download> entirely without this —
  // the browser just navigates/opens the image instead of saving it, since
  // the download attribute is only honored same-origin without CORS
  // headers the source site controls, not this extension. Fetching first
  // and downloading the resulting blob (same approach the ZIP export
  // already uses) sidesteps that limitation reliably.
  async function downloadImageBlob(url, filename) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch failed (${resp.status})`);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }

  function imageFilenameFor(item) {
    const ext = (item.data.format || "jpg").split("?")[0].replace(/[^a-z0-9]/gi, "") || "jpg";
    return `${sanitizeFilename(item.selector || "image")}-${item.id.slice(0, 6)}.${ext}`;
  }

  async function downloadOneImage(item) {
    if (!item.data || !item.data.url) {
      showToast("This image has no direct file to download.", null);
      return;
    }
    try {
      await downloadImageBlob(item.data.url, imageFilenameFor(item));
    } catch (err) {
      showToast("Couldn't download this image — try Export instead.", null);
    }
  }

  function componentFilenameFor(item) {
    return `${sanitizeFilename(item.selector || "component")}-${item.id.slice(0, 6)}.png`;
  }

  // Same download affordance as an image, sourced from the component's own
  // captured screenshot (data.previewImage) instead of a live page URL —
  // components don't have one file "at a URL" the way an <img> does. A
  // data: URL fetches locally with no network/CORS involved, so this reuses
  // downloadImageBlob unchanged.
  async function downloadOneComponent(item) {
    if (!item.data || !item.data.previewImage) {
      showToast("This component has no captured image to download.", null);
      return;
    }
    try {
      await downloadImageBlob(item.data.previewImage, componentFilenameFor(item));
    } catch (err) {
      showToast("Couldn't download this component — try Export instead.", null);
    }
  }

  // The "Download all" action on an Images section header (Section 7F, same
  // per-folder flow requested for Export) — bundles just that section's
  // images into one ZIP rather than requiring a detour through the
  // separate Export view to get the same items.
  async function downloadAllImages(items, scopeName) {
    const withUrls = items.filter((i) => i.data && i.data.url);
    if (withUrls.length === 0) {
      showToast("No downloadable images here.", null);
      return;
    }
    try {
      const zip = new JSZip();
      let fetched = 0;
      for (const item of withUrls) {
        try {
          const resp = await fetch(item.data.url);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          zip.file(imageFilenameFor(item), blob);
          fetched++;
        } catch (_) {
          // skip this one, keep going with the rest
        }
      }
      if (fetched === 0) {
        showToast("Couldn't download any of these images.", null);
        return;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(scopeName || "images")}-images.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`Downloaded ${fetched} image${fetched === 1 ? "" : "s"}.`, null);
    } catch (err) {
      showToast("Download failed — try again.", null);
    }
  }

  function buildSelectCheck(item) {
    const check = document.createElement("div");
    check.className = "select-check";
    check.dataset.itemId = item.id;
    const isChecked = selectedItems.has(item.id);
    check.dataset.checked = String(isChecked);
    check.innerHTML = isChecked ? "✓" : "";
    return check;
  }

  function toggleItemSelected(item, tileOrCard) {
    if (selectedItems.has(item.id)) {
      selectedItems.delete(item.id);
    } else {
      selectedItems.set(item.id, item);
    }
    const check = tileOrCard.querySelector(".select-check");
    if (check) {
      const isChecked = selectedItems.has(item.id);
      check.dataset.checked = String(isChecked);
      check.innerHTML = isChecked ? "✓" : "";
    }
    updateSelectBar();
  }

  function chipLabelFor(item) {
    if (item.type === "color") return item.data.hex || "Color";
    if (item.type === "font") return item.data.family || "Font";
    if (item.type === "image") return "Image";
    return "Component";
  }

  // Pattern 4 — selected items as removable chips (thumbnail + label + x),
  // not a bare "N selected" counter. Capped so a 20-item selection doesn't
  // blow out the bar — the rest collapse into a plain "+N more" chip.
  const SELECT_CHIP_CAP = 6;
  function updateSelectBar() {
    const n = selectedItems.size;
    selectBarEl.hidden = n === 0;
    selectChipsEl.innerHTML = "";
    const items = Array.from(selectedItems.values());
    items.slice(0, SELECT_CHIP_CAP).forEach((item) => {
      const chip = document.createElement("div");
      chip.className = "select-chip";
      const thumb = document.createElement("div");
      thumb.className = "select-chip-thumb";
      thumb.appendChild(buildThumbNode(item));
      chip.appendChild(thumb);
      const label = document.createElement("span");
      label.className = "select-chip-label";
      label.textContent = chipLabelFor(item);
      chip.appendChild(label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "select-chip-remove";
      remove.setAttribute("aria-label", `Remove ${chipLabelFor(item)} from selection`);
      remove.innerHTML = Harvest.ICONS.close;
      remove.addEventListener("click", () => {
        selectedItems.delete(item.id);
        const tileOrCard = document.querySelector(`.select-check[data-item-id="${item.id}"]`)?.closest(".tile, .card");
        if (tileOrCard) {
          const check = tileOrCard.querySelector(".select-check");
          if (check) { check.dataset.checked = "false"; check.innerHTML = ""; }
        }
        updateSelectBar();
      });
      chip.appendChild(remove);
      selectChipsEl.appendChild(chip);
    });
    if (n > SELECT_CHIP_CAP) {
      const overflow = document.createElement("div");
      overflow.className = "select-chip select-chip-overflow";
      overflow.textContent = `+${n - SELECT_CHIP_CAP} more`;
      selectChipsEl.appendChild(overflow);
    }
  }

  // Color and font tiles get a real two-part card — a swatch/glyph on top
  // (with the same concave-notch technique the folder covers already use,
  // reused here for the same "one shape flows into the other" reason) and
  // an info body underneath actually showing what was captured: the hex
  // code for a color, the family name + weight/size for a font. The old
  // version was a bare color square or bare "Aa" glyph with zero of that
  // information visible without hovering — this is design-extractor's own
  // pattern for the same information (see its BRAND COLORS card).
  // A single continuous sweeping curve across the full width — low on the
  // left (barely any body color visible above it), rising smoothly to a
  // high point on the right — not a small corner notch. The type icon is
  // its own independent floating circular badge on top of the swatch,
  // unconnected to the curve, matching the reference's "⋮" button exactly:
  // a separate round pill with its own shadow sitting on the photo, not
  // built into the card's silhouette.
  function buildRichTile(item, reserveNoteSpace) {
    const tile = document.createElement("div");
    tile.className = `tile tile-rich tile-rich-${item.type}`;
    tile.title = [item.selector, item.note].filter(Boolean).join(" — ");

    const top = document.createElement("div");
    top.className = "tile-rich-top";
    if (item.type === "color") {
      top.style.background = item.data.hex || "#ccc";
    } else {
      top.style.background = "var(--type-font-bg)";
      const glyph = document.createElement("div");
      glyph.className = "tile-rich-glyph";
      glyph.textContent = "Aa";
      glyph.style.fontFamily = item.data.fallbackStack || "sans-serif";
      glyph.style.fontWeight = item.data.weight || "600";
      top.appendChild(glyph);
    }
    // Ported from design-extractor's own color-card — the notch is a
    // mask-image on .tile-rich-body itself (see sidepanel.css), not a
    // separate element here. Matches the tooltip's own color preview
    // (overlay.js), same source technique at both scales.
    tile.appendChild(top);

    const body = document.createElement("div");
    body.className = "tile-rich-body";

    // Small muted caption above the bold value — the reference's own
    // "5 days ago · Active" sitting above "Personal Email Assistant", not
    // a bare value with nothing over it. Reuses real data we actually
    // have (when this was captured) rather than inventing a field like
    // "Active" that has no Harvest equivalent.
    const caption = document.createElement("div");
    caption.className = "tile-rich-caption";
    caption.textContent = relativeTime(item.capturedAt);
    body.appendChild(caption);

    const value = document.createElement("div");
    value.className = "tile-rich-value";
    if (item.type === "color") {
      value.textContent = (item.data.hex || "").toUpperCase();
      body.appendChild(value);
    } else {
      value.textContent = item.data.family || "Untitled";
      body.appendChild(value);
      const meta = document.createElement("div");
      meta.className = "tile-rich-meta";
      const weight = item.data.weight || "400";
      const size = item.data.sizePx ? `${Math.round(item.data.sizePx)}px` : null;
      meta.textContent = [weight, size].filter(Boolean).join(" · ");
      body.appendChild(meta);
    }
    // The note's actual text, not just a badge you have to hover/click to
    // read — same "say what it actually is" treatment the expanded card
    // view got. buildTile skips its own note-badge for rich tiles that
    // render one here, so this doesn't end up shown twice.
    if (item.note) {
      const noteEl = buildNoteControl(item);
      if (noteEl) {
        noteEl.classList.add("tile-rich-note");
        body.appendChild(noteEl);
      }
    } else if (reserveNoteSpace) {
      // Only reserved when a sibling actually in this same grid row has a
      // note — every tile in that row then ends up the same height
      // instead of a ragged edge (align-items:start, see
      // .grid-section-items, stopped the opposite bug: a note-less tile
      // stretching to fill a taller sibling's extra space). When NO tile
      // in the row has a note, nothing is reserved anywhere — every tile
      // in a plain, note-free row stays fully compact, no dead space
      // added for a note that doesn't exist anywhere nearby.
      const spacer = document.createElement("div");
      spacer.className = "tile-rich-note-spacer";
      body.appendChild(spacer);
    }
    tile.appendChild(body);
    return tile;
  }

  function buildTile(item, reserveNoteSpace) {
    const isRich = item.type === "color" || item.type === "font";
    const tile = isRich ? buildRichTile(item, reserveNoteSpace) : document.createElement("div");
    if (!isRich) {
      tile.className = "tile";
      tile.title = [item.selector, item.note].filter(Boolean).join(" — ");
      tile.appendChild(buildThumbNode(item));
    }
    // The plain-notch swatch card has no floating badge of its own — every
    // tile still gets the standard corner type-chip, same as image/component.
    const chip = document.createElement("div");
    chip.className = `type-chip type-chip-${item.type}`;
    chip.innerHTML = TYPE_CHIP[item.type] || "?";
    tile.appendChild(chip);

    // A note typed at collect time was previously only reachable via this
    // tile's own `title` attribute — a native browser tooltip nobody
    // discovers by looking at the grid. A small visible badge (full text on
    // its own hover) means "this one has a note" is actually visible, not
    // just technically present in the DOM somewhere. Rich tiles (color/
    // font) show the note's actual text inside the body instead (see
    // buildRichTile) — this badge would just duplicate that.
    if (isRich) {
      // no badge — buildRichTile already rendered the note text in-body
    } else if (item.note && !selectMode) {
      // The badge itself is the edit entry point now — clicking it opens
      // the same editor a fresh "add note" click would, just pre-filled.
      // One affordance doing double duty instead of a badge plus a
      // separate edit button competing for the same tiny corner.
      const noteBadge = document.createElement("button");
      noteBadge.type = "button";
      noteBadge.className = "tile-note-badge";
      noteBadge.innerHTML = Harvest.ICONS.note;
      noteBadge.title = item.note;
      noteBadge.setAttribute("aria-label", "Edit note");
      noteBadge.addEventListener("click", (e) => { e.stopPropagation(); showNoteEditor(item); });
      tile.appendChild(noteBadge);
    } else if (item.note) {
      const noteBadge = document.createElement("div");
      noteBadge.className = "tile-note-badge";
      noteBadge.innerHTML = Harvest.ICONS.note;
      noteBadge.title = item.note;
      tile.appendChild(noteBadge);
    }

    if (selectMode) {
      tile.classList.add("selectable");
      tile.appendChild(buildSelectCheck(item));
      tile.addEventListener("click", () => toggleItemSelected(item, tile));
    } else {
      tile.appendChild(buildDeleteBtn(() => deleteItemFlow(item)));
      appendTileActionButtons(tile, item);
    }
    return tile;
  }

  // Shared by both card variants below — the same three-way branch
  // (editable note / read-only note in select mode / "add a note") used
  // on tiles, just factored out instead of copy-pasted a third time.
  function buildNoteControl(item) {
    if (item.note && !selectMode) {
      const note = document.createElement("button");
      note.type = "button";
      note.className = "note note-editable";
      note.textContent = item.note;
      note.setAttribute("aria-label", "Edit note");
      note.addEventListener("click", (e) => { e.stopPropagation(); showNoteEditor(item); });
      return note;
    }
    if (item.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = item.note;
      return note;
    }
    if (!selectMode) {
      const addNote = document.createElement("button");
      addNote.type = "button";
      addNote.className = "note note-add";
      addNote.textContent = "+ Add note";
      addNote.addEventListener("click", (e) => { e.stopPropagation(); showNoteEditor(item); });
      return addNote;
    }
    return null;
  }

  // Every expanded-view card now gets the same swatch-card treatment as
  // the compact tile (buildRichTile) and the tooltip's own color preview
  // (overlay.js's .color-swatch-card) — same coupled margin/mask/radius
  // values, just re-proportioned for a wider card. The old flat thumb+row
  // layout (a 48px square next to two lines of text, stretched across a
  // full-width single-column row) is what was leaving all that dead width;
  // all four capture types share one card shape now instead of color/font
  // looking designed and image/component looking like a leftover list row.
  function buildRichCard(item) {
    const card = document.createElement("div");
    card.className = `card card-rich card-rich-${item.type}`;

    const top = document.createElement("div");
    top.className = "card-rich-top";
    if (item.type === "color") {
      top.style.background = item.data.hex || "#ccc";
    } else if (item.type === "font") {
      top.style.background = "var(--type-font-bg)";
      const glyph = document.createElement("div");
      glyph.className = "card-rich-glyph";
      glyph.textContent = "Aa";
      glyph.style.fontFamily = item.data.fallbackStack || "sans-serif";
      glyph.style.fontWeight = item.data.weight || "600";
      top.appendChild(glyph);
    } else {
      // image / component — the same real photo/video, or the accent-wash
      // placeholder icon, the compact tile already uses for these types.
      if (item.type === "component") top.classList.add("card-rich-top-wash");
      top.appendChild(buildThumbNode(item));
    }
    card.appendChild(top);

    const body = document.createElement("div");
    body.className = "card-rich-body";

    const row = document.createElement("div");
    row.className = "card-rich-row";
    const value = document.createElement("div");
    value.className = "card-rich-value";
    if (item.type === "color") value.textContent = (item.data.hex || "").toUpperCase();
    else if (item.type === "font") value.textContent = item.data.family || "Untitled";
    else if (item.type === "image") value.textContent = item.data.width && item.data.height ? `${item.data.width}×${item.data.height}` : "Image";
    else value.textContent = item.selector || "Component";
    row.appendChild(value);
    const typeLabel = document.createElement("div");
    typeLabel.className = `type-label type-label-${item.type}`;
    typeLabel.textContent = item.family || item.type;
    row.appendChild(typeLabel);
    body.appendChild(row);

    const meta = document.createElement("div");
    meta.className = "card-rich-meta";
    if (item.type === "font") {
      const weight = item.data.weight || "400";
      const size = item.data.sizePx ? `${Math.round(item.data.sizePx)}px` : null;
      meta.textContent = [weight, size].filter(Boolean).join(" · ") + " · " + relativeTime(item.capturedAt);
    } else if (item.type === "component" && item.data.boundingBoxWidth && item.data.boundingBoxHeight) {
      meta.textContent = `${Math.round(item.data.boundingBoxWidth)}×${Math.round(item.data.boundingBoxHeight)} · ${relativeTime(item.capturedAt)}`;
    } else {
      meta.textContent = relativeTime(item.capturedAt);
    }
    body.appendChild(meta);

    const noteEl = buildNoteControl(item);
    if (noteEl) body.appendChild(noteEl);

    card.appendChild(body);

    if (selectMode) {
      card.classList.add("selectable");
      card.appendChild(buildSelectCheck(item));
      card.addEventListener("click", () => toggleItemSelected(item, card));
    } else {
      card.appendChild(buildDeleteBtn(() => deleteItemFlow(item)));
      appendTileActionButtons(card, item);
    }
    return card;
  }

  function buildCard(item) {
    return buildRichCard(item);
  }

  // Singleton tag picker — only one can ever be open at a time (matching
  // the same one-menu-at-a-time convention the notes tooltip itself uses),
  // so a plain module-level reference is enough; no per-tile state needed.
  let openTagMenuEl = null;
  function closeTagPicker() {
    if (openTagMenuEl) {
      openTagMenuEl.remove();
      openTagMenuEl = null;
    }
    document.removeEventListener("click", tagPickerOutsideClick, true);
    document.removeEventListener("keydown", tagPickerEscape, true);
  }
  function tagPickerOutsideClick(e) {
    if (openTagMenuEl && !openTagMenuEl.contains(e.target)) closeTagPicker();
  }
  function tagPickerEscape(e) {
    if (e.key === "Escape") closeTagPicker();
  }
  // getCurrentTags reads fresh on every render instead of taking a static
  // array — the menu stays open across multiple picks (checking several
  // tags in one sitting shouldn't mean reopening it each time), so its own
  // checkmarks have to reflect whatever onToggle just changed, not what was
  // true when the menu first opened.
  function openTagPicker(anchorBtn, getCurrentTags, onToggle) {
    closeTagPicker();
    const menu = document.createElement("div");
    menu.className = "note-tag-menu";
    function renderItems() {
      menu.innerHTML = "";
      const current = getCurrentTags();
      NOTE_TAGS.forEach((t) => {
        const tagBtn = document.createElement("button");
        tagBtn.type = "button";
        tagBtn.className = "note-tag-menu-item";
        const isActive = current.includes(t.key);
        tagBtn.setAttribute("aria-checked", String(isActive));
        // Icon leads (what kind of tag this is, always visible — this is
        // the whole point of giving each tag its own glyph instead of a
        // plain text row), checkmark trails and only appears once picked.
        const iconBadge = document.createElement("span");
        iconBadge.className = "note-tag-menu-icon";
        iconBadge.innerHTML = t.icon;
        tagBtn.appendChild(iconBadge);
        const label = document.createElement("span");
        label.className = "note-tag-menu-label";
        label.textContent = t.label;
        tagBtn.appendChild(label);
        const check = document.createElement("span");
        check.className = "note-tag-menu-check";
        if (isActive) check.innerHTML = Harvest.ICONS.check;
        tagBtn.appendChild(check);
        tagBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onToggle(t.key);
          renderItems();
        });
        menu.appendChild(tagBtn);
      });
    }
    renderItems();
    document.body.appendChild(menu);
    const r = anchorBtn.getBoundingClientRect();
    const margin = 6;
    menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - margin)}px`;
    let top = r.bottom + margin;
    if (top + menu.offsetHeight > window.innerHeight) top = r.top - menu.offsetHeight - margin;
    menu.style.top = `${Math.max(top, margin)}px`;
    openTagMenuEl = menu;
    // Deferred one tick so the click that opened this menu doesn't
    // immediately register as the "outside click" that closes it again.
    setTimeout(() => {
      document.addEventListener("click", tagPickerOutsideClick, true);
      document.addEventListener("keydown", tagPickerEscape, true);
    }, 0);
  }

  // --- In-note highlighting (mark part of a captured note's own text) ---
  // Same singleton-floating-control shape as the tag picker above: select
  // text inside a note's excerpt, a small "Highlight" button appears near
  // the selection, clicking it marks that exact substring. Highlights are
  // stored as character offsets into item.data.text (HarvestDB.
  // updateItemHighlights), not a duplicated copy of the text, and
  // re-rendered by splitting the text into plain/<mark> segments at
  // render time — see renderNoteText below.
  let openHighlightBtnEl = null;
  function closeHighlightBtn() {
    if (openHighlightBtnEl) {
      openHighlightBtnEl.remove();
      openHighlightBtnEl = null;
    }
    document.removeEventListener("mousedown", highlightBtnOutsideClick, true);
  }
  function highlightBtnOutsideClick(e) {
    if (openHighlightBtnEl && !openHighlightBtnEl.contains(e.target)) closeHighlightBtn();
  }
  function openHighlightBtn(x, y, onConfirm) {
    closeHighlightBtn();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-highlight-btn";
    btn.innerHTML = `${Harvest.ICONS.note}<span>Highlight</span>`;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't let this click itself collapse the selection before onConfirm reads it
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onConfirm();
      closeHighlightBtn();
    });
    document.body.appendChild(btn);
    const margin = 6;
    btn.style.left = `${Math.min(Math.max(x - btn.offsetWidth / 2, margin), window.innerWidth - btn.offsetWidth - margin)}px`;
    btn.style.top = `${Math.max(y - btn.offsetHeight - 10, margin)}px`;
    openHighlightBtnEl = btn;
    setTimeout(() => document.addEventListener("mousedown", highlightBtnOutsideClick, true), 0);
  }

  // Character offset of (node, nodeOffset) relative to container's own
  // full text content — walks the same text-node order the browser uses
  // for selection, so this matches what getRangeAt(0) reports regardless
  // of how many <mark> elements already split the text up.
  function getTextOffsetIn(container, node, nodeOffset) {
    let offset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {
      if (current === node) return offset + nodeOffset;
      offset += current.textContent.length;
    }
    return offset;
  }

  // Merges a new [start,end) range into existing ones, combining any that
  // now overlap or touch — without this, highlighting slightly overlapping
  // spans twice would corrupt the plain/<mark> segment split in
  // renderNoteText (two <mark> ranges covering the same characters isn't a
  // renderable state, only a set of non-overlapping ones is).
  function mergeHighlightRanges(existing, added) {
    const all = existing.concat([added]).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of all) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ start: r.start, end: r.end });
    }
    return merged;
  }

  // A heading with a manual <br> (or multiple text nodes) used to produce
  // several adjacent headingRanges with a \n sitting in the gap between
  // them. The renderer treated that gap as plain body text, so pre-line
  // forced an early line break when collapsed and -webkit-box ate the
  // gap's whitespace when expanded (words ran together). Coalesce any
  // ranges separated only by whitespace — a real heading→body break always
  // has non-heading body text after the gap, not another heading range.
  function mergeAdjacentHeadingRanges(text, headingRanges) {
    const sorted = (Array.isArray(headingRanges) ? headingRanges : [])
      .filter((h) => h.start < h.end && h.start >= 0 && h.end <= text.length)
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const h of sorted) {
      const last = merged[merged.length - 1];
      if (last) {
        const gap = text.slice(last.end, h.start);
        if (h.start <= last.end || /^[\s]*$/.test(gap)) {
          last.end = Math.max(last.end, h.end);
          continue;
        }
      }
      merged.push({ start: h.start, end: h.end });
    }
    return merged;
  }

  // Renders text as a mix of plain text nodes and <mark> spans at the
  // given offsets — the inverse of getTextOffsetIn, and the only place
  // that ever builds a note-tile-text's actual DOM content, so the two
  // stay in sync by construction.
  function renderNoteText(container, text, highlights, headingRanges) {
    container.innerHTML = "";
    const heads = mergeAdjacentHeadingRanges(text, headingRanges);
    // Appends [from, to) as plain content, splitting further on any
    // heading ranges inside it so text captured from an h1-h6 on the
    // source page renders bold here too — the whole selection used to
    // flatten to one uniform weight regardless of what was actually a
    // heading vs. body text on the page. Only touches the non-highlighted
    // portions; the highlight-mark loop below is untouched, so a highlight
    // still stays exactly one <mark> per range (the click-to-remove logic
    // in buildNoteTile position-indexes marks and would break if a
    // highlight could get split into more than one).
    function appendPlainSpan(from, to) {
      let cursor = from;
      heads.forEach((h) => {
        const hs = Math.max(h.start, from);
        const he = Math.min(h.end, to);
        if (hs >= he) return;
        if (hs > cursor) container.appendChild(document.createTextNode(text.slice(cursor, hs)));
        const strong = document.createElement("strong");
        strong.className = "note-tile-heading-text";
        // A real, author-placed <br> INSIDE a single source heading (a
        // display-size headline manually broken into "Deploy custom" /
        // "integrations in days" at the site's own much wider column) gets
        // captured as a literal \n by Selection.toString(), same as the
        // meaningful heading→body break this file's own white-space:
        // pre-line was added for. That line break made sense at the
        // source's font size/column width; reproduced literally in this
        // tile's narrow, much-smaller-type column it just reads as
        // wrapping early for no visible reason. Collapsed to a space HERE
        // ONLY — text.slice(hs, he) is guaranteed entirely inside one
        // heading's own span, so this can't touch the actual
        // heading-to-body break (which lives outside any heading range) or
        // shift any offset highlight positions are computed against.
        strong.textContent = text.slice(hs, he).replace(/[\r\n]+/g, " ");
        container.appendChild(strong);
        cursor = he;
      });
      if (cursor < to) container.appendChild(document.createTextNode(text.slice(cursor, to)));
    }
    const sorted = (Array.isArray(highlights) ? highlights : [])
      .filter((h) => h.start < h.end && h.start >= 0 && h.end <= text.length)
      .sort((a, b) => a.start - b.start);
    let cursor = 0;
    sorted.forEach((h) => {
      if (h.start > cursor) appendPlainSpan(cursor, h.start);
      const mark = document.createElement("mark");
      mark.className = "note-tile-highlight";
      mark.title = "Click to remove highlight";
      mark.textContent = text.slice(h.start, h.end);
      container.appendChild(mark);
      cursor = Math.max(cursor, h.end);
    });
    if (cursor < text.length) appendPlainSpan(cursor, text.length);
  }

  // --- Notes (text-selection captures, src/content/notes.js) -----------
  // A note is text, not a swatch/thumbnail — buildTile/buildRichCard both
  // assume an image-hero shape that doesn't fit here, so this is its own
  // small renderer: Pattern 1 (label-above-value) — a muted source+time
  // caption above, the captured text itself as the bold "value" below,
  // clamped to 3 lines the same way the tooltip's own note field is.
  // showSource=false when appendGroupedNoteTiles has already rendered a
  // shared header for a run of consecutive notes from the same page —
  // this tile then shows just its own time, not a repeat of the same
  // site link/hostname text every other tile in the run already has.
  function buildNoteTile(item, showSource = true) {
    const data = item.data || {};
    const tile = document.createElement("div");
    tile.className = selectMode ? "note-tile selectable" : "note-tile";
    // No per-note color stripe here — it used to sit as a solid colored
    // left border, directly parallel to the timeline's own dashed spine,
    // which read as visual clutter (two competing vertical lines) rather
    // than a useful signal. The color pick itself is still saved on the
    // item and still visible at capture time (the tooltip's own badge).

    const body = document.createElement("div");
    body.className = "note-tile-body";

    const caption = document.createElement("div");
    caption.className = "note-tile-caption";
    let sourceLabel = item.sourceUrl || item.hostname || "";
    try {
      if (item.sourceUrl) sourceLabel = new URL(item.sourceUrl).hostname;
    } catch (_) {
      // sourceUrl wasn't a real URL — fall back to whatever string we had
    }
    // A note only ever shows inside ITS OWN site's folder (where "which
    // site" is already obvious from context) or in the flat cross-site
    // Notes tab / a multi-site Collection (where it isn't) — the link icon
    // is what makes origin scannable at a glance in that second case,
    // exactly where a bare text caption stops being enough. Real <a>, not
    // a button + window.open, so it's a genuine link (hover preview,
    // middle-click-to-new-tab, etc. all work for free).
    if (showSource) {
      if (item.sourceUrl) {
        const sourceLink = document.createElement("a");
        sourceLink.className = "note-tile-source-link";
        sourceLink.href = item.sourceUrl;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.title = `Open ${sourceLabel}`;
        // Two nodes, not one innerHTML interpolation — sourceLabel falls
        // back to raw item.sourceUrl/item.hostname when the URL parse above
        // fails, and that fallback string isn't guaranteed to be markup-safe
        // (unlike the .hostname property, which the URL parser itself
        // already constrains). The icon markup is a static constant either
        // way, never concatenated with page-derived text.
        const linkIcon = document.createElement("span");
        linkIcon.innerHTML = Harvest.ICONS.externalLink;
        sourceLink.appendChild(linkIcon);
        const linkLabel = document.createElement("span");
        linkLabel.textContent = sourceLabel;
        sourceLink.appendChild(linkLabel);
        // The tile itself has no click behavior today, so this doesn't
        // currently need to fight anything for the click — kept anyway,
        // matching every other in-tile control here, so a future tile-level
        // click handler can't silently swallow this one.
        sourceLink.addEventListener("click", (e) => e.stopPropagation());
        caption.appendChild(sourceLink);
      } else {
        const label = document.createElement("span");
        label.textContent = sourceLabel;
        caption.appendChild(label);
      }
    }
    const timeEl = document.createElement("span");
    timeEl.className = "note-tile-time";
    // No leading "· " separator when there's no source link before it in
    // this tile (showSource=false) — that middot exists to separate two
    // things sitting next to each other, not to prefix a lone value.
    timeEl.textContent = showSource ? `· ${relativeTime(item.capturedAt)}` : relativeTime(item.capturedAt);
    caption.appendChild(timeEl);
    body.appendChild(caption);

    const value = document.createElement("div");
    value.className = "note-tile-text";
    const noteText = data.text || "";
    renderNoteText(value, noteText, data.highlights, data.headingRanges);
    // Select part of the note's own text → a floating "Highlight" button
    // appears near the selection, same interaction shape as notes.js's
    // own capture-time tooltip (select text, act on it right there).
    // Shared by mouseup AND keyup (Shift+Arrow extends a selection too —
    // click once to place a caret in the text, then Shift+Arrow, works
    // without needing this element to be focusable, since text-selection
    // extension follows the document's current selection anchor, not
    // element focus) so a mouse drag isn't the only way to highlight.
    function handleTextSelectionForHighlight(clientX, clientY) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!value.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== value) return;
      const start = getTextOffsetIn(value, range.startContainer, range.startOffset);
      const end = getTextOffsetIn(value, range.endContainer, range.endOffset);
      if (end <= start) return;
      // Keyboard path has no mouse coordinates — anchor to the selected
      // range's own on-screen position instead.
      let x = clientX;
      let y = clientY;
      if (x == null || y == null) {
        const rect = range.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top;
      }
      openHighlightBtn(x, y, () => {
        const current = Array.isArray(data.highlights) ? data.highlights : [];
        const next = mergeHighlightRanges(current, { start, end });
        data.highlights = next;
        HarvestDB.updateItemHighlights(item.id, next);
        renderNoteText(value, noteText, next, data.headingRanges);
        sel.removeAllRanges();
      });
    }
    value.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      handleTextSelectionForHighlight(e.clientX, e.clientY);
    });
    value.addEventListener("keyup", (e) => {
      if (!["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      handleTextSelectionForHighlight(null, null);
    });
    // Click an existing highlight to remove just that one — a highlight
    // that can only ever be added and never undone isn't really a marker
    // tool, it's a one-way mistake generator.
    value.addEventListener("click", (e) => {
      const mark = e.target.closest(".note-tile-highlight");
      if (!mark) return;
      e.stopPropagation();
      const current = Array.isArray(data.highlights) ? data.highlights : [];
      // Identify by rendered position among marks, not by text content —
      // two different highlighted spans can legitimately contain the same
      // words, so matching on text alone could remove the wrong one.
      const marksInOrder = Array.from(value.querySelectorAll(".note-tile-highlight"));
      const idx = marksInOrder.indexOf(mark);
      const sortedCurrent = [...current].sort((a, b) => a.start - b.start);
      if (idx === -1 || idx >= sortedCurrent.length) return;
      const next = sortedCurrent.filter((_, i) => i !== idx);
      data.highlights = next;
      HarvestDB.updateItemHighlights(item.id, next);
      renderNoteText(value, noteText, next, data.headingRanges);
    });
    body.appendChild(value);

    // The 3-line clamp (.note-tile-text) has no way out — a captured note
    // longer than that was just permanently cut off with an ellipsis and
    // no way to read the rest without opening the .md download. Worse when
    // a captured heading eats 1-2 of those 3 lines by itself, leaving only
    // one real line of body text visible. A "Show more" toggle removes the
    // clamp on click; measured after the tile is actually in the document
    // (scrollHeight only means anything once laid out — this function
    // returns a detached node the caller appends a moment later), so it
    // only ever appears when the text is genuinely overflowing, never as a
    // dead control on a short note that already fits.
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "note-tile-expand-btn";
    expandBtn.textContent = "Show more";
    expandBtn.hidden = true;
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const expanded = value.classList.toggle("note-tile-text-expanded");
      expandBtn.textContent = expanded ? "Show less" : "Show more";
    });
    requestAnimationFrame(() => {
      if (value.scrollHeight > value.clientHeight + 1) expandBtn.hidden = false;
    });
    body.appendChild(expandBtn);

    // Real thumbnails and real links, not just a "5 images · 3 links"
    // count with no way to actually see them — the count told you
    // something was captured but gave no way to look at it without
    // leaving the panel.
    if (data.images && data.images.length) {
      const imagesRow = document.createElement("div");
      imagesRow.className = "note-tile-images";
      function buildImageThumb(src) {
        const thumbLink = document.createElement("a");
        thumbLink.className = "note-tile-image-thumb";
        thumbLink.href = src;
        thumbLink.target = "_blank";
        thumbLink.rel = "noopener noreferrer";
        thumbLink.title = "Open image";
        thumbLink.addEventListener("click", (e) => e.stopPropagation());
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.loading = "lazy";
        thumbLink.appendChild(img);
        return thumbLink;
      }
      const shown = data.images.slice(0, 4);
      shown.forEach((src) => imagesRow.appendChild(buildImageThumb(src)));
      const overflow = data.images.length - shown.length;
      if (overflow > 0) {
        // Was a plain, non-interactive <span> — looked exactly like every
        // other "+N" overflow badge in the app (folder covers, the select
        // bar), but unlike those, there was no OTHER way to ever reach the
        // hidden image(s): the shown thumbnails are real openable links,
        // the ones past the cap of 4 just had no path to them at all.
        // Clicking it now reveals the rest as the same real thumbnail
        // links, then removes itself.
        const more = document.createElement("button");
        more.type = "button";
        more.className = "note-tile-image-overflow";
        more.textContent = `+${overflow}`;
        more.title = `Show ${overflow} more image${overflow === 1 ? "" : "s"}`;
        more.setAttribute("aria-label", `Show ${overflow} more image${overflow === 1 ? "" : "s"}`);
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          data.images.slice(4).forEach((src) => imagesRow.insertBefore(buildImageThumb(src), more));
          more.remove();
        });
        imagesRow.appendChild(more);
      }
      body.appendChild(imagesRow);
    }
    if (data.links && data.links.length) {
      const linksRow = document.createElement("div");
      linksRow.className = "note-tile-links";
      data.links.forEach((l) => {
        const linkChip = document.createElement("a");
        linkChip.className = "note-tile-link-chip";
        linkChip.href = l.href;
        linkChip.target = "_blank";
        linkChip.rel = "noopener noreferrer";
        linkChip.title = l.href;
        linkChip.addEventListener("click", (e) => e.stopPropagation());
        const chipIcon = document.createElement("span");
        chipIcon.innerHTML = Harvest.ICONS.externalLink;
        linkChip.appendChild(chipIcon);
        const chipLabel = document.createElement("span");
        chipLabel.textContent = l.text || l.href;
        linkChip.appendChild(chipLabel);
        linksRow.appendChild(linkChip);
      });
      body.appendChild(linksRow);
    }

    // "+ Tag" lives inline with the site/time caption now, pushed to the
    // row's right edge (margin-left: auto) — built once here, not
    // recreated on every renderTags() call, since it now lives outside the
    // chip row that gets wiped and rebuilt on every tag change.
    const addTagBtn = document.createElement("button");
    addTagBtn.type = "button";
    addTagBtn.className = "note-tag-add-btn";
    addTagBtn.title = "Add a tag";
    addTagBtn.setAttribute("aria-label", "Add a tag");
    addTagBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTagPicker(
        addTagBtn,
        () => (Array.isArray(data.tags) ? data.tags : []),
        (key) => {
          const current = Array.isArray(data.tags) ? data.tags : [];
          const next = current.includes(key) ? current.filter((k) => k !== key) : current.concat([key]);
          data.tags = next;
          HarvestDB.updateItemTags(item.id, next);
          renderTags();
        }
      );
    });
    // Editing (tags, annotation, highlights) doesn't make sense while
    // multi-selecting for a bulk action — matching buildTile/buildRichCard,
    // which replace their own per-item edit controls with just the
    // checkbox in select mode instead of leaving them live alongside it.
    if (!selectMode) caption.appendChild(addTagBtn);

    const tagsRow = document.createElement("div");
    tagsRow.className = "note-tile-tags";
    // Chips only now — the add-button that used to live in this row moved
    // up into the caption (see addTagBtn above). "+ Add note" used to sit
    // beside it here too, doing the exact same thing as the pencil edit
    // button already sitting in the hover-actions column below (both call
    // showNoteEditor) — a genuine duplicate control, not two different
    // features, so it's gone from here; the pencil button is the one
    // entry point now.
    function renderTags() {
      tagsRow.innerHTML = "";
      const activeTags = Array.isArray(data.tags) ? data.tags : [];
      activeTags.forEach((key) => {
        const def = NOTE_TAGS.find((t) => t.key === key);
        if (!def) return; // a tag removed from NOTE_TAGS in some future version — drop it silently rather than showing a raw key
        const chip = document.createElement("span");
        chip.className = "note-tag-chip";
        const chipIcon = document.createElement("span");
        chipIcon.className = "note-tag-chip-icon";
        chipIcon.innerHTML = def.icon;
        chip.appendChild(chipIcon);
        const chipLabel = document.createElement("span");
        chipLabel.textContent = def.label;
        chip.appendChild(chipLabel);
        tagsRow.appendChild(chip);
      });
      addTagBtn.textContent = activeTags.length ? "+" : "+ Tag";
      tagsRow.hidden = activeTags.length === 0;
    }
    renderTags();
    body.appendChild(tagsRow);

    if (item.note) {
      const noteEl = buildNoteControl(item);
      if (noteEl) body.appendChild(noteEl);
    }

    // Select mode: same swap buildTile/buildRichCard already do — a
    // checkbox and a whole-tile click-to-toggle, in place of the normal
    // per-item action row (download/copy/edit/delete don't apply while
    // multi-selecting for a bulk action).
    if (selectMode) {
      tile.appendChild(buildSelectCheck(item));
      tile.addEventListener("click", () => toggleItemSelected(item, tile));
    } else {
      // A normal-flow row below the text now, not an absolutely-positioned
      // overlay — that version anchored to the tile's own top-right corner
      // and, for any tile shorter than the 4-icon column's own height (a
      // one-line note, say), spilled straight past the tile's bottom edge
      // into whatever rendered next below it on hover. Real flow can't
      // overlap anything outside its own box by definition. Space is
      // reserved always (this row layout doesn't shift on hover — only
      // opacity toggles), using the space already sitting empty below the
      // text/tags rather than floating over any of it.
      const actions = document.createElement("div");
      actions.className = "note-tile-actions";
      const downloadBtn = document.createElement("button");
      downloadBtn.type = "button";
      downloadBtn.className = "note-tile-action-btn";
      downloadBtn.innerHTML = Harvest.ICONS.download;
      downloadBtn.title = "Download as .txt";
      downloadBtn.setAttribute("aria-label", "Download this note as a text file");
      downloadBtn.addEventListener("click", (e) => { e.stopPropagation(); downloadOneNote(item); });
      actions.appendChild(downloadBtn);
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "note-tile-action-btn";
      copyBtn.innerHTML = Harvest.ICONS.copy;
      copyBtn.title = "Copy text";
      copyBtn.setAttribute("aria-label", "Copy this note's text");
      copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyOneNote(item, copyBtn); });
      actions.appendChild(copyBtn);
      if (!item.note) actions.appendChild(buildEditBtn(item));
      actions.appendChild(buildDeleteBtn(() => deleteItemFlow(item)));
      body.appendChild(actions);
    }

    tile.appendChild(body);

    return tile;
  }

  function noteFilenameFor(item) {
    const data = item.data || {};
    return `${sanitizeFilename((data.text || "note").slice(0, 40) || "note")}-${item.id.slice(0, 6)}.md`;
  }

  // Real Markdown, not plain text with a renamed extension — a blockquote
  // for the captured text (so it visually reads as "quoted from
  // elsewhere," not authored), bold field labels, and a real [text](url)
  // source link, so pasting the downloaded file straight into Notion/
  // Obsidian/any Markdown-aware app renders correctly instead of showing
  // literal ">"/"**" characters. Two competitors researched for this
  // (Readwise, Glasp) treat exactly this — export you can actually reuse
  // elsewhere — as their core paid value; this is the free version of
  // that for Harvest.
  function noteTextBlockFor(item) {
    const data = item.data || {};
    const when = new Date(item.capturedAt).toLocaleString();
    let sourceLabel = item.sourceUrl || item.hostname || "";
    try {
      if (item.sourceUrl) sourceLabel = new URL(item.sourceUrl).hostname;
    } catch (_) {
      // sourceUrl wasn't a real URL — fall back to whatever string we had
    }
    const lines = [];
    if (item.sourcePageTitle) lines.push(`### ${item.sourcePageTitle}`, "");
    // Each line of the captured text needs its own "> " to stay one
    // blockquote in Markdown — a bare multi-line string would only quote
    // its first line and let the rest fall back to plain paragraph text.
    lines.push(`> ${(data.text || "").split("\n").join("\n> ")}`, "");
    // data.truncated is set at capture time (notes.js) when the original
    // selection was longer than the 4000-char cap — flagging it here too so
    // it isn't only a 4-second banner the person collecting it could have
    // missed; the exported/downloaded record itself should say so.
    if (data.truncated) lines.push("*(Selection was longer than what got captured — truncated at 4,000 characters.)*", "");
    lines.push(`**Source:** ${item.sourceUrl ? `[${sourceLabel}](${item.sourceUrl})` : sourceLabel}`);
    lines.push(`**Captured:** ${when}`);
    if (item.note) lines.push(`**My note:** ${item.note}`);
    if (Array.isArray(item.tags) && item.tags.length) {
      const tagLabels = item.tags.map((key) => (NOTE_TAGS.find((t) => t.key === key) || {}).label || key);
      lines.push(`**Tags:** ${tagLabels.join(", ")}`);
    }
    if (data.links && data.links.length) {
      lines.push(`**Links:** ${data.links.map((l) => `[${l.text || l.href}](${l.href})`).join(", ")}`);
    }
    if (data.images && data.images.length) {
      lines.push(`**Images:** ${data.images.join(", ")}`);
    }
    return lines.join("\n");
  }

  async function downloadOneNote(item) {
    const blob = new Blob([noteTextBlockFor(item)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = noteFilenameFor(item);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function copyOneNote(item, btn) {
    await HarvestClipboardCopy.copySingleItem(item, btn, copyDeps);
  }

  // Text-native equivalent of "Download all" for images (downloadAllImages
  // above) — one combined .md file, clearly separated per note (a "---"
  // horizontal rule, which is both a readable divider AND valid Markdown),
  // rather than a ZIP of many tiny files.
  async function downloadAllNotes(items, scopeName) {
    if (items.length === 0) {
      showToast("No notes here.", null);
      return;
    }
    const blocks = items.map((item) => noteTextBlockFor(item));
    const blob = new Blob([blocks.join("\n\n---\n\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(scopeName || "notes")}-notes.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`Downloaded ${items.length} note${items.length === 1 ? "" : "s"}.`, null);
  }

  // Chrome's local favicon cache (already stored on-device from normal
  // browsing) via the "favicon" permission's _favicon endpoint — NOT a new
  // network request to the remote site. This is the whole reason it's
  // worth using over a naive `https://${hostname}/favicon.ico` <img src>,
  // which WOULD be a real new outbound call to an arbitrary remembered
  // site regardless of what's currently being browsed, and that's exactly
  // the class of thing Section 9's local-only commitment rules out.
  function faviconUrl(hostname) {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", `https://${hostname}`);
    url.searchParams.set("size", "32");
    return url.toString();
  }

  // A literal folder silhouette, not just a tinted rectangle: a colored
  // top band (the fanned previews sit here, like items peeking out of a
  // folder) with a white paper "flap" peeling up over it at the bottom,
  // carrying the name + metadata — the shape the user pointed at directly
  // and asked to be used, on top of (not instead of) everything already
  // here (fan, favicon/pin, hostname, count). `badgeNode` is built by the
  // caller since a folder and a Collection use different badges for the
  // same slot; `metaHtml` is the count/recency line, now living in the
  // white flap rather than below the card.
  function buildFanCover(items, tintSeed, name, badgeNode, overflowCount, metaHtml) {
    const cover = document.createElement("div");
    cover.className = "folder-cover";

    const tint = document.createElement("div");
    tint.className = "folder-tint";
    const tone = Harvest.folderTint(tintSeed);
    tint.style.background = tone.bg;
    cover.appendChild(tint);

    const fan = document.createElement("div");
    fan.className = "folder-fan";
    const positions = [
      { left: "6px", rot: "-8deg", z: 1 },
      { left: "36px", rot: "4deg", z: 2 },
      { left: "66px", rot: "-3deg", z: 1 },
    ];
    items.slice(0, 3).forEach((item, i) => {
      const thumb = document.createElement("div");
      thumb.className = "folder-thumb";
      const pos = positions[i] || positions[positions.length - 1];
      thumb.style.left = pos.left;
      thumb.style.transform = `rotate(${pos.rot})`;
      thumb.style.zIndex = String(pos.z);
      thumb.appendChild(buildThumbNode(item));
      fan.appendChild(thumb);
    });
    // Pattern 5 — overflow count instead of silently dropping items past
    // the 3 the fan can show.
    if (overflowCount > 0) {
      const more = document.createElement("div");
      more.className = "folder-thumb folder-thumb-more";
      more.style.left = positions[positions.length - 1].left;
      more.style.zIndex = "3";
      more.textContent = `+${overflowCount}`;
      fan.appendChild(more);
    }
    if (items.length === 0) {
      // A just-created, still-empty Collection would otherwise render as a
      // bare tinted rectangle — no fan to show. A centered folder glyph
      // keeps it from reading as a broken/missing thumbnail.
      const placeholder = document.createElement("div");
      placeholder.className = "folder-cover-empty";
      placeholder.style.color = tone.ink;
      placeholder.innerHTML = Harvest.ICONS.folder;
      fan.appendChild(placeholder);
    }
    cover.appendChild(fan);

    // The exact shape the user pointed at: a raised tab on the left
    // (holding the name, like a hanging-folder tab) with a concave curve
    // where it meets the lower body (the meta line + corner badge) —
    // not a single smoothly-curved edge, a real folder-tab silhouette.
    // `.folder-flap-notch`'s radial-gradient is the standard CSS technique
    // for a concave ("inverted") rounded corner: transparent inside the
    // quarter-circle nearest the tab, filled outside it, so the notch
    // shows the tint color, not a hard seam.
    const flap = document.createElement("div");
    flap.className = "folder-flap";
    const tab = document.createElement("div");
    tab.className = "folder-flap-tab";
    const nameEl = document.createElement("div");
    nameEl.className = "folder-name";
    nameEl.textContent = name;
    tab.appendChild(nameEl);
    const notch = document.createElement("div");
    notch.className = "folder-flap-notch";
    const body = document.createElement("div");
    body.className = "folder-flap-body";
    const meta = document.createElement("div");
    meta.className = "folder-flap-meta";
    meta.innerHTML = metaHtml;
    body.appendChild(meta);
    // notch is a CHILD of tab (not a sibling) so its `left/top: 100%`
    // resolves against the tab's own box — meaning it automatically
    // tracks the tab's real fit-content width instead of needing a fixed
    // pixel value known in advance.
    tab.appendChild(notch);
    flap.appendChild(tab);
    flap.appendChild(body);

    cover.appendChild(flap);
    // The favicon/pin badge sits pinned at the card's bottom-right corner,
    // overlapping the flap — not inline next to the hostname text — this
    // is the exact placement the reference image showed and an earlier
    // version of this file drifted away from when the flap layout changed.
    badgeNode.classList.add("folder-corner-badge");
    cover.appendChild(badgeNode);
    return cover;
  }

  // mode "sites" (default): the real per-site folder — clicking opens the
  // full mixed-type view, delete removes everything captured on that host.
  // mode "notes": the Notes tab's own per-site grouping (folder.items is
  // already notes-only by the time it gets here) — clicking opens a
  // notes-only filtered view of that site instead, and there's no delete
  // button, since "delete this notes folder" would otherwise delete that
  // site's colors/fonts/images too via the same HarvestDB.deleteFolder
  // call the sites version uses — a destructive surprise this mode
  // deliberately doesn't offer. Individual notes still delete fine from
  // inside the timeline itself.
  function buildFolderCard(folder, mode) {
    const btn = document.createElement("button");
    btn.className = "folder-card";
    btn.type = "button";
    btn.title = `${folder.hostname} — ${folder.items.length} item${folder.items.length === 1 ? "" : "s"}`;

    const favicon = document.createElement("div");
    favicon.className = "folder-favicon";
    const favImg = document.createElement("img");
    favImg.src = faviconUrl(folder.hostname);
    favImg.alt = "";
    // A real site favicon failing to load (Chrome has never cached one for
    // this host, or the harness has no _favicon endpoint to hit) used to
    // just remove the badge entirely — an empty gap in the corner instead
    // of a designed failure state. A generic globe glyph keeps the corner
    // badge, and the card, looking finished either way.
    favImg.addEventListener("error", () => {
      favicon.classList.add("folder-favicon-fallback");
      favicon.innerHTML = Harvest.ICONS.globe;
    });
    favicon.appendChild(favImg);

    // Pattern 1 — label-above-value: recency first, bold count second,
    // instead of one flat sentence at even weight. Lives in the white flap
    // now, not below the card.
    const metaHtml = `${relativeTime(folder.lastUpdated)} &middot; <strong>${folder.items.length}</strong> item${folder.items.length === 1 ? "" : "s"}`;
    const cover = buildFanCover(folder.items, folder.hostname, folder.hostname, favicon, Math.max(0, folder.items.length - 3), metaHtml);
    if (mode === "notes") {
      // No select-mode, no delete — this card is a read-only grouping
      // view into notes that already live under the real per-site folder;
      // it isn't a second copy of the data with its own lifecycle, so it
      // shouldn't offer a destructive action the Sites tab doesn't also
      // need to account for.
    } else if (folderSelectMode) {
      // Selecting replaces deleting while picking folders to export — the
      // two actions don't need to coexist in this mode, same reasoning as
      // item tiles hiding their own delete button while selectable.
      const check = document.createElement("div");
      check.className = "select-check";
      const isChecked = selectedFolderHostnames.has(folder.hostname);
      check.dataset.checked = String(isChecked);
      check.innerHTML = isChecked ? "✓" : "";
      cover.appendChild(check);
    } else {
      cover.appendChild(
        buildDeleteBtn(() => {
          showConfirm({
            title: `Delete ${folder.hostname}?`,
            body: `This permanently deletes all ${folder.items.length} item${folder.items.length === 1 ? "" : "s"} from this site.`,
            confirmLabel: "Delete folder",
            onConfirm: async () => {
              // folder.items is already filtered to non-notes (see
              // showLibrarySites above) — deleting item-by-item through
              // that same list instead of calling HarvestDB.deleteFolder
              // (which deletes EVERY item for this hostname, notes
              // included) means this action can never silently take out
              // notes the confirmation dialog never mentioned and the
              // card never counted. Same per-item shape deleteFolder
              // itself uses internally, so restoreFolder still works
              // unchanged on the results.
              const results = [];
              for (const item of folder.items) {
                const r = await HarvestDB.deleteItem(item.id);
                if (r) results.push(r);
              }
              showToast(`Deleted ${folder.hostname} (${results.length} item${results.length === 1 ? "" : "s"})`, async () => {
                await HarvestDB.restoreFolder(results);
                refreshCurrentView();
              });
              refreshCurrentView();
            },
          });
        })
      );
    }
    // A single folder had no quick way to export just itself — the only
    // path was entering folder-select mode, picking exactly this one
    // folder, then using that bar's export menu, for what should be a
    // one-click action. Reuses the exact same performZipExport() every
    // other export path already goes through (folderSelectionExportContext,
    // itemSelectionExportContext) — same manifest format, same per-type
    // handling (including notes), nothing export-side is new here. Left
    // out of folderSelectMode specifically — a single-folder shortcut
    // would be redundant right next to the checkbox that's already there
    // for picking one-or-more folders to export together. Available in
    // "notes" mode too (unlike delete above) since downloading is
    // non-destructive — the "read-only grouping" reasoning that excludes
    // delete here doesn't apply to a read action.
    if (!folderSelectMode) {
      cover.appendChild(
        buildDownloadBtn(() => {
          exportContext = {
            items: folder.items,
            allItems: folder.items,
            scopeKey: sanitizeFilename(folder.hostname),
            scopeLabel: folder.hostname,
          };
          performZipExport();
        }, `Download ${folder.hostname} as a ZIP`)
      );
    }
    btn.appendChild(cover);

    btn.addEventListener("click", (e) => {
      if (mode !== "notes" && folderSelectMode) {
        toggleFolderSelected(folder, btn);
        return;
      }
      if (e.target.closest(".card-delete-btn")) return;
      if (mode === "notes") {
        // A separate view mode from the Sites tab's own "manual-site" —
        // refreshNotesOnly() re-filters to type==="note" on every refresh
        // (live capture updates included), so this never shows or risks
        // touching this site's colors/fonts/images/components. Back
        // navigation already returns to whichever Library tab was active
        // (libraryTab persists unchanged across this), so it lands back
        // on Notes, not Sites.
        viewMode = "manual-site-notes";
        currentHostname = folder.hostname;
        showSiteViewChrome();
        refreshNotesOnly();
        return;
      }
      viewMode = "manual-site";
      currentHostname = folder.hostname;
      showSiteViewChrome();
      refresh();
    });

    return btn;
  }

  function toggleFolderSelected(folder, cardEl) {
    if (selectedFolderHostnames.has(folder.hostname)) {
      selectedFolderHostnames.delete(folder.hostname);
    } else {
      selectedFolderHostnames.add(folder.hostname);
    }
    selectedFolderItemsMap.set(folder.hostname, folder.items);
    const check = cardEl.querySelector(".select-check");
    if (check) {
      const isChecked = selectedFolderHostnames.has(folder.hostname);
      check.dataset.checked = String(isChecked);
      check.innerHTML = isChecked ? "✓" : "";
    }
    updateLibrarySelectBar();
  }

  function updateLibrarySelectBar() {
    const n = selectedFolderHostnames.size;
    librarySelectBarEl.hidden = n === 0;
    if (n === 0) return;
    const hosts = Array.from(selectedFolderHostnames);
    const totalItems = hosts.reduce((sum, h) => sum + (selectedFolderItemsMap.get(h) || []).length, 0);
    librarySelectSummaryEl.textContent =
      n === 1
        ? `${hosts[0]} — ${totalItems} item${totalItems === 1 ? "" : "s"}`
        : `${n} sites selected — ${totalItems} item${totalItems === 1 ? "" : "s"}`;
  }

  function clearExportMenuPosition(menuEl) {
    menuEl.style.left = "";
    menuEl.style.top = "";
    menuEl.style.visibility = "";
  }

  function exitFolderSelectMode() {
    folderSelectMode = false;
    selectedFolderHostnames.clear();
    selectedFolderItemsMap.clear();
    libraryTabsSelectToggle.setAttribute("aria-pressed", "false");
    librarySelectBarEl.hidden = true;
    libraryExportMenu.hidden = true;
    libraryExportToggleBtn.setAttribute("aria-expanded", "false");
    clearExportMenuPosition(libraryExportMenu);
  }

  libraryTabsSelectToggle.addEventListener("click", () => {
    folderSelectMode = !folderSelectMode;
    libraryTabsSelectToggle.setAttribute("aria-pressed", String(folderSelectMode));
    if (!folderSelectMode) {
      selectedFolderHostnames.clear();
      selectedFolderItemsMap.clear();
      updateLibrarySelectBar();
    }
    refreshCurrentView();
  });

  // The choice (ZIP vs Figma) now happens right here in the bar — this
  // used to be one "Export…" button that navigated to a separate screen
  // just to show the same two options as a split button. Sets exportContext
  // directly and runs the action in place, without leaving the Sites grid.
  function folderSelectionExportContext() {
    const hosts = Array.from(selectedFolderHostnames);
    const items = hosts.flatMap((h) => selectedFolderItemsMap.get(h) || []);
    const siteCount = hosts.length;
    const itemCount = items.length;
    const itemLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
    const scopeLabel =
      siteCount === 1 ? `${hosts[0]} — ${itemLabel}` : `${siteCount} sites, ${itemLabel}`;
    const scopeKey =
      siteCount === 1
        ? sanitizeFilename(hosts[0])
        : sanitizeFilename(`harvest-export-${siteCount}-sites-${itemCount}-items`);
    return { items, allItems: items, scopeKey, scopeLabel, siteCount, hosts };
  }
  // Shared open/close wiring for the two export split-button menus (folder
  // selection + item selection) — closes on an outside click or Escape, and
  // never lets both bars' menus sit open at once. Menus use position:fixed
  // (see .export-menu) anchored to the chevron so they aren't clipped by the
  // narrow split-button flex container.
  function positionExportMenu(anchorBtn, menuEl) {
    menuEl.hidden = false;
    menuEl.style.visibility = "hidden";
    const margin = 8;
    const r = anchorBtn.getBoundingClientRect();
    const menuWidth = menuEl.offsetWidth;
    const menuHeight = menuEl.offsetHeight;
    let left = r.right - menuWidth;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    let top = r.top - menuHeight - margin;
    if (top < margin) top = r.bottom + margin;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.visibility = "";
  }
  function setupExportMenu(toggleBtn, menuEl) {
    const close = () => {
      menuEl.hidden = true;
      toggleBtn.setAttribute("aria-expanded", "false");
      clearExportMenuPosition(menuEl);
    };
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = menuEl.hidden;
      libraryExportMenu.hidden = true;
      libraryExportToggleBtn.setAttribute("aria-expanded", "false");
      clearExportMenuPosition(libraryExportMenu);
      selectExportMenu.hidden = true;
      selectExportToggleBtn.setAttribute("aria-expanded", "false");
      clearExportMenuPosition(selectExportMenu);
      if (willOpen) {
        positionExportMenu(toggleBtn, menuEl);
        toggleBtn.setAttribute("aria-expanded", "true");
      }
    });
    menuEl.addEventListener("click", (e) => e.stopPropagation());
    return close;
  }
  const closeLibraryExportMenu = setupExportMenu(libraryExportToggleBtn, libraryExportMenu);
  const closeSelectExportMenu = setupExportMenu(selectExportToggleBtn, selectExportMenu);
  document.addEventListener("click", () => {
    closeLibraryExportMenu();
    closeSelectExportMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLibraryExportMenu();
      closeSelectExportMenu();
    }
  });

  libraryExportZipBtn.addEventListener("click", () => {
    if (selectedFolderHostnames.size === 0) return;
    exportContext = folderSelectionExportContext();
    exitFolderSelectMode();
    performZipExport();
  });
  libraryExportNotionBtn.addEventListener("click", () => {
    if (selectedFolderHostnames.size === 0) return;
    exportContext = folderSelectionExportContext();
    exitFolderSelectMode();
    performNotionExport();
  });
  libraryExportFigmaBtn.addEventListener("click", () => {
    if (selectedFolderHostnames.size === 0) return;
    exportContext = folderSelectionExportContext();
    exitFolderSelectMode();
    performExportToFigma();
  });
  libraryExportPluginCopyBtn.addEventListener("click", () => {
    if (selectedFolderHostnames.size === 0) return;
    exportContext = folderSelectionExportContext();
    exitFolderSelectMode();
    performPluginJsonExport();
  });

  function buildCollectionCard(collection, resolvedItems, mode) {
    const btn = document.createElement("button");
    btn.className = "folder-card";
    btn.type = "button";
    btn.title = `${collection.name} — ${resolvedItems.length} item${resolvedItems.length === 1 ? "" : "s"}`;

    const pinBadge = document.createElement("div");
    pinBadge.className = "folder-favicon folder-pin-badge";
    pinBadge.innerHTML = Harvest.ICONS.pin;

    const metaHtml = `${relativeTime(collection.lastUpdatedAt)} &middot; <strong>${resolvedItems.length}</strong> item${resolvedItems.length === 1 ? "" : "s"}`;
    const cover = buildFanCover(resolvedItems, collection.name, collection.name, pinBadge, Math.max(0, resolvedItems.length - 3), metaHtml);
    cover.appendChild(
      buildDeleteBtn(() => {
        showConfirm({
          title: `Delete "${collection.name}"?`,
          // Section 7G/8: deleting a Collection only removes the
          // grouping — must be unmistakable in the confirmation copy
          // itself, not just in documentation.
          body: "This won't delete the items themselves, only this grouping. The items stay exactly where they are in their original site folders.",
          confirmLabel: "Delete collection",
          onConfirm: async () => {
            await HarvestDB.deleteCollection(collection.id);
            showToast(`Deleted collection "${collection.name}"`, null);
            refreshCurrentView();
          },
        });
      })
    );
    btn.appendChild(cover);

    btn.addEventListener("click", (e) => {
      if (e.target.closest(".card-delete-btn")) return;
      viewMode = "collection-detail";
      currentCollectionId = collection.id;
      currentCollectionMode = mode === "notes" ? "notes" : "default";
      showSiteViewChrome();
      // Still returns to the library, not a separate "all collections"
      // crumb — keeps navigation to one level. Label matches whichever
      // tab this card was opened from.
      backBtn.textContent = mode === "notes" ? "← Notes" : "← All sites";
      if (mode === "notes") {
        // Notes render via buildNoteTile, which never opted into the
        // checkbox-based multi-select-to-Collection mode (same reasoning
        // as refreshNotesOnly) — showing Select here would be a dead end.
        selectToggleBtn.hidden = true;
      }
      refreshCollectionDetail();
    });

    return btn;
  }

  // --- "Add to Collection" picker ------------------------------------
  function appendPickerHeader(modal, titleText, onClose) {
    const header = document.createElement("div");
    header.className = "sp-modal-picker-header";
    const title = document.createElement("div");
    title.className = "sp-modal-title";
    title.textContent = titleText;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sp-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = Harvest.ICONS.close;
    closeBtn.addEventListener("click", onClose);
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);
  }

  async function showCollectionPicker(items) {
    const collections = await HarvestDB.getAllCollections();
    modalRoot.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "sp-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sp-modal sp-modal-picker";

    const closePicker = () => { modalRoot.innerHTML = ""; };
    appendPickerHeader(
      modal,
      `Add ${items.length} item${items.length === 1 ? "" : "s"} to a Collection`,
      closePicker
    );

    const list = document.createElement("div");
    list.className = "collection-picker-list";
    if (collections.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sp-modal-body";
      empty.textContent = "No Collections yet — create one below.";
      list.appendChild(empty);
    }
    collections.forEach((col) => {
      const row = document.createElement("div");
      row.className = "collection-picker-row";
      const icon = document.createElement("div");
      icon.className = "collection-picker-icon";
      icon.innerHTML = Harvest.ICONS.folder;
      row.appendChild(icon);
      const text = document.createElement("div");
      text.className = "collection-picker-text";
      const name = document.createElement("div");
      name.className = "collection-picker-name";
      name.textContent = col.name;
      const count = document.createElement("div");
      count.className = "collection-picker-count";
      count.textContent = `${col.itemRefs.length} item${col.itemRefs.length === 1 ? "" : "s"}`;
      text.appendChild(name);
      text.appendChild(count);
      row.appendChild(text);
      const add = document.createElement("div");
      add.className = "collection-picker-add";
      add.innerHTML = Harvest.ICONS.plus;
      row.appendChild(add);
      row.addEventListener("click", async () => {
        const refs = items.map((it) => ({ folderHostname: it.hostname, itemId: it.id }));
        await HarvestDB.addItemsToCollection(col.id, refs);
        modalRoot.innerHTML = "";
        exitSelectMode();
        showToast(`Added to "${col.name}"`, null);
      });
      list.appendChild(row);
    });
    modal.appendChild(list);

    const newRow = document.createElement("div");
    newRow.className = "collection-picker-new";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "New Collection name…";
    input.maxLength = 60;
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.textContent = "Create";
    createBtn.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) return;
      // Section 8: duplicate collection names are allowed (distinguished by
      // id internally) — a hard block would break the legitimate
      // "iterate on a moodboard" use case, so this deliberately doesn't
      // check for an existing name.
      const col = await HarvestDB.createCollection(name);
      const refs = items.map((it) => ({ folderHostname: it.hostname, itemId: it.id }));
      await HarvestDB.addItemsToCollection(col.id, refs);
      modalRoot.innerHTML = "";
      exitSelectMode();
      showToast(`Created "${name}" with ${items.length} item${items.length === 1 ? "" : "s"}`, null);
    });
    newRow.appendChild(input);
    newRow.appendChild(createBtn);
    modal.appendChild(newRow);

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closePicker(); });
    modalRoot.appendChild(overlay);
  }

  // --- View chrome dispatch -------------------------------------------
  function showSiteViewChrome() {
    libraryGridEl.hidden = true;
    libraryEmptyEl.hidden = true;
    collectionsGridEl.hidden = true;
    collectionsEmptyEl.hidden = true;
    notesGridEl.hidden = true;
    notesEmptyEl.hidden = true;
    libraryTabsEl.hidden = true;
    compareViewEl.hidden = true;
    compareToggle.setAttribute("aria-pressed", "false");
    libraryTabsSelectToggle.hidden = true;
    librarySelectBarEl.hidden = true;
    exitFolderSelectMode();
    // Library hides this whole row (showLibrary) since it has nothing
    // useful to show there — coming back here means there's a real
    // hostname/Collection name to display, so the row itself needs to
    // reappear too, not just its individual children.
    siteLineEl.hidden = false;
    backBtn.hidden = false;
    backBtn.textContent = "← All sites";
    selectToggleBtn.hidden = false;
    // "All sites" isn't what's showing here anymore (a real hostname is,
    // set right after this call returns) — see showLibrary's own comment.
    siteLineTextEl.classList.remove("site-line-clickable");
  }

  function refreshCurrentView() {
    if (viewMode === "auto-site") syncActiveTab();
    else if (viewMode === "manual-site") refresh();
    else if (viewMode === "manual-site-notes") refreshNotesOnly();
    else if (viewMode === "collection-detail") refreshCollectionDetail();
    else if (viewMode === "library" && libraryTab === "sites") showLibrarySites();
    else if (viewMode === "library" && libraryTab === "collections") showLibraryCollections();
    else if (viewMode === "library" && libraryTab === "notes") showLibraryNotes();
    // 'compare' and 'export' are static once opened (not live-updating
    // views tied to captures elsewhere) — nothing to refresh there.
  }

  function exitSelectMode() {
    selectMode = false;
    selectedItems.clear();
    selectToggleBtn.setAttribute("aria-pressed", "false");
    updateSelectBar();
    refreshCurrentView();
  }

  selectToggleBtn.addEventListener("click", () => {
    if (selectMode) {
      exitSelectMode();
    } else {
      selectMode = true;
      selectedItems.clear();
      selectToggleBtn.setAttribute("aria-pressed", "true");
      updateSelectBar();
      refreshCurrentView();
    }
  });

  selectAddBtn.addEventListener("click", () => {
    if (selectedItems.size === 0) return;
    showCollectionPicker(Array.from(selectedItems.values()));
  });

  // Export/Figma used to only be reachable from the Sites-grid folder
  // picker — but selecting individual items within a site (this bar) is
  // its own, equally common way to decide what you want, and had no way
  // to export or copy-for-Figma that exact selection without first adding
  // it to a Collection as a workaround. The ZIP/Figma choice happens right
  // in the bar, same as the folder-select bar — no separate screen.
  function itemSelectionExportContext() {
    const items = Array.from(selectedItems.values());
    const scopeLabel = items.length === 1 ? "1 selected item" : `${items.length} selected items`;
    return { items, allItems: items, scopeKey: "harvest-selection", scopeLabel };
  }
  function exitSelectModeAfterExport() {
    selectMode = false;
    selectedItems.clear();
    selectToggleBtn.setAttribute("aria-pressed", "false");
    updateSelectBar();
    selectExportMenu.hidden = true;
    selectExportToggleBtn.setAttribute("aria-expanded", "false");
    clearExportMenuPosition(selectExportMenu);
  }
  selectExportZipBtn.addEventListener("click", () => {
    if (selectedItems.size === 0) return;
    exportContext = itemSelectionExportContext();
    exitSelectModeAfterExport();
    performZipExport();
  });
  selectExportNotionBtn.addEventListener("click", () => {
    if (selectedItems.size === 0) return;
    exportContext = itemSelectionExportContext();
    exitSelectModeAfterExport();
    performNotionExport();
  });
  selectExportFigmaBtn.addEventListener("click", () => {
    if (selectedItems.size === 0) return;
    exportContext = itemSelectionExportContext();
    exitSelectModeAfterExport();
    performExportToFigma();
  });
  selectExportPluginCopyBtn.addEventListener("click", () => {
    if (selectedItems.size === 0) return;
    exportContext = itemSelectionExportContext();
    exitSelectModeAfterExport();
    performPluginJsonExport();
  });

  selectRemoveBtn.addEventListener("click", () => {
    const items = Array.from(selectedItems.values());
    if (items.length === 0) return;
    const doRemove = async () => {
      for (const item of items) await HarvestDB.deleteItem(item.id);
      exitSelectMode();
      showToast(`Deleted ${items.length} item${items.length === 1 ? "" : "s"}`, null);
    };
    if (items.length > 1) {
      showConfirm({
        title: `Delete ${items.length} items?`,
        body: "This can't be undone after a few seconds.",
        confirmLabel: "Delete",
        onConfirm: doRemove,
      });
    } else {
      doRemove();
    }
  });

  // --- Sites tab (folder grid) -----------------------------------------
  async function showLibrarySites() {
    libraryTab = "sites";
    tabSitesBtn.setAttribute("aria-pressed", "true");
    tabCollectionsBtn.setAttribute("aria-pressed", "false");
    tabNotesBtn.setAttribute("aria-pressed", "false");
    collectionsGridEl.hidden = true;
    collectionsEmptyEl.hidden = true;
    notesGridEl.hidden = true;
    notesEmptyEl.hidden = true;
    libraryTabsSelectToggle.hidden = false;

    try {
      // Notes are a fully separate system from Sites — they come from a
      // different capture mode (text-selection, not hover) and live under
      // the Notes tab's own per-site grouping instead. Excluded here so a
      // host with ONLY notes doesn't get a Sites card at all, and a host
      // with both kinds only counts/shows its non-note captures here.
      const items = (await HarvestDB.getAllItems()).filter((item) => item.type !== "note");
      const byHost = new Map();
      for (const item of items) {
        if (!byHost.has(item.hostname)) byHost.set(item.hostname, []);
        byHost.get(item.hostname).push(item);
      }
      const folders = Array.from(byHost.entries())
        .map(([hostname, hostItems]) => {
          const sorted = [...hostItems].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
          return { hostname, items: sorted, lastUpdated: sorted[0].capturedAt };
        })
        .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

      // Re-sync the folder-select cache against what's actually in the DB
      // right now — selectedFolderItemsMap was only ever written at the
      // moment a checkbox was clicked, so a capture or delete landing
      // while the grid stayed open (via the ITEMS_UPDATED live-refresh)
      // left it exporting a stale item list, and a host that lost every
      // item this way vanished from `folders` entirely with no card left
      // to uncheck it from — its selection would otherwise never clear.
      if (selectedFolderHostnames.size > 0) {
        const liveHosts = new Set(folders.map((f) => f.hostname));
        for (const hostname of Array.from(selectedFolderHostnames)) {
          const folder = folders.find((f) => f.hostname === hostname);
          if (folder) {
            selectedFolderItemsMap.set(hostname, folder.items);
          } else {
            selectedFolderHostnames.delete(hostname);
            selectedFolderItemsMap.delete(hostname);
          }
        }
      }
      updateLibrarySelectBar();

      if (folders.length === 0) {
        libraryEmptyEl.hidden = false;
        libraryGridEl.hidden = true;
        libraryTabsSelectToggle.disabled = true;
        return;
      }
      libraryTabsSelectToggle.disabled = false;
      libraryEmptyEl.hidden = true;
      libraryGridEl.hidden = false;
      libraryGridEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      folders.forEach((folder) => frag.appendChild(buildFolderCard(folder)));
      libraryGridEl.appendChild(frag);
    } catch (err) {
      libraryGridEl.hidden = true;
      libraryEmptyEl.hidden = false;
      libraryEmptyEl.querySelector(".empty-title").textContent = `Couldn't load: ${String((err && err.message) || err)}`;
    }
  }

  // --- Collections tab --------------------------------------------------
  async function showLibraryCollections() {
    libraryTab = "collections";
    tabSitesBtn.setAttribute("aria-pressed", "false");
    tabCollectionsBtn.setAttribute("aria-pressed", "true");
    tabNotesBtn.setAttribute("aria-pressed", "false");
    libraryGridEl.hidden = true;
    libraryEmptyEl.hidden = true;
    notesGridEl.hidden = true;
    notesEmptyEl.hidden = true;
    // Folder multiselect/export is Sites-only — Collections cards are
    // curated groupings, not site folders, so they don't participate.
    libraryTabsSelectToggle.hidden = true;
    exitFolderSelectMode();

    try {
      const collections = await HarvestDB.getAllCollections();
      if (collections.length === 0) {
        collectionsEmptyEl.hidden = false;
        collectionsGridEl.hidden = true;
        return;
      }
      const withItems = await Promise.all(
        collections.map(async (col) => ({ col, items: await HarvestDB.resolveCollectionItems(col) }))
      );
      // A Collection built entirely from the notes flow (its own "New
      // folder" — every item it holds is type==="note") belongs under the
      // Notes tab instead, same reasoning as Sites excluding notes above:
      // two fully separate systems, not one shared list. A Collection
      // that mixes notes with other capture types still shows here too —
      // it genuinely has non-note content this tab is responsible for.
      const nonNoteOnly = withItems.filter(({ items }) => items.some((it) => it.type !== "note"));
      nonNoteOnly.sort((a, b) => new Date(b.col.lastUpdatedAt) - new Date(a.col.lastUpdatedAt));

      if (nonNoteOnly.length === 0) {
        collectionsEmptyEl.hidden = false;
        collectionsGridEl.hidden = true;
        return;
      }
      collectionsEmptyEl.hidden = true;
      collectionsGridEl.hidden = false;
      collectionsGridEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      // Card count/cover reflect only the non-note items too — a mixed
      // Collection shouldn't show "6 items" here when 2 of those are notes
      // that live under its Notes-tab counterpart instead.
      nonNoteOnly.forEach(({ col, items }) =>
        frag.appendChild(buildCollectionCard(col, items.filter((it) => it.type !== "note"), "default"))
      );
      collectionsGridEl.appendChild(frag);
    } catch (err) {
      collectionsGridEl.hidden = true;
      collectionsEmptyEl.hidden = false;
      collectionsEmptyEl.querySelector(".empty-title").textContent = `Couldn't load: ${String((err && err.message) || err)}`;
    }
  }

  // --- Notes tab ---------------------------------------------------------
  // Mirrors the Sites tab's own two-level structure exactly: a grid of
  // per-site folder cards first (grouped by hostname, same buildFolderCard
  // used there — just handed a notes-only item list and "notes" mode so
  // it never shows or touches that site's other captures), and only the
  // timeline (render() + appendGroupedNoteTiles, via refreshNotesOnly)
  // once you click into one specific site. A flat cross-site list used to
  // live here directly; collecting a note or creating a folder didn't
  // visibly change anything about "which site is this under," which read
  // as notes not really being organized by site at all.
  async function showLibraryNotes() {
    libraryTab = "notes";
    tabSitesBtn.setAttribute("aria-pressed", "false");
    tabCollectionsBtn.setAttribute("aria-pressed", "false");
    tabNotesBtn.setAttribute("aria-pressed", "true");
    libraryGridEl.hidden = true;
    libraryEmptyEl.hidden = true;
    collectionsGridEl.hidden = true;
    collectionsEmptyEl.hidden = true;
    // Folder-card grid, not the flat timeline layout — see the class swap
    // below, matching whichever shape is actually being shown right now.
    notesGridEl.className = "library-grid";
    // Same reasoning as Collections — select/export-a-folder doesn't apply
    // to this grid; it's read-only grouping, not a second data store.
    libraryTabsSelectToggle.hidden = true;
    exitFolderSelectMode();

    try {
      const [items, collections] = await Promise.all([HarvestDB.getAllItems(), HarvestDB.getAllCollections()]);
      const notesByHost = new Map();
      for (const item of items) {
        if (item.type !== "note") continue;
        if (!notesByHost.has(item.hostname)) notesByHost.set(item.hostname, []);
        notesByHost.get(item.hostname).push(item);
      }
      const folders = Array.from(notesByHost.entries())
        .map(([hostname, hostItems]) => {
          const sorted = [...hostItems].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
          return { hostname, items: sorted, lastUpdated: sorted[0].capturedAt };
        })
        .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

      // A Collection created via the capture-time "New folder" flow (or
      // any Collection that's picked up at least one note along the way)
      // lives here, not in the general Collections tab — see the matching
      // filter on showLibraryCollections. Without this, a Collection made
      // entirely of notes would be excluded from BOTH tabs and become
      // permanently unreachable in the UI, which is worse than showing it
      // in "the wrong" tab.
      const withItems = await Promise.all(
        collections.map(async (col) => ({ col, items: await HarvestDB.resolveCollectionItems(col) }))
      );
      const noteCollections = withItems.filter(({ items: colItems }) => colItems.some((it) => it.type === "note"));
      noteCollections.sort((a, b) => new Date(b.col.lastUpdatedAt) - new Date(a.col.lastUpdatedAt));

      if (folders.length === 0 && noteCollections.length === 0) {
        notesEmptyEl.hidden = false;
        notesGridEl.hidden = true;
        return;
      }
      notesEmptyEl.hidden = true;
      notesGridEl.hidden = false;
      notesGridEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      if (folders.length > 0) {
        if (noteCollections.length > 0) {
          const sitesLabel = document.createElement("div");
          sitesLabel.className = "grid-section-label notes-tab-section-label";
          sitesLabel.textContent = "Sites";
          frag.appendChild(sitesLabel);
        }
        folders.forEach((folder) => frag.appendChild(buildFolderCard(folder, "notes")));
      }
      if (noteCollections.length > 0) {
        const foldersLabel = document.createElement("div");
        foldersLabel.className = "grid-section-label notes-tab-section-label";
        foldersLabel.textContent = "My folders";
        frag.appendChild(foldersLabel);
        // Same reasoning as the Collections tab above, mirrored: this card's
        // count/cover show only this Collection's notes, not any non-note
        // items it also happens to hold (those live under Collections
        // instead).
        noteCollections.forEach(({ col, items: colItems }) =>
          frag.appendChild(buildCollectionCard(col, colItems.filter((it) => it.type === "note"), "notes"))
        );
      }
      notesGridEl.appendChild(frag);
    } catch (err) {
      notesGridEl.hidden = true;
      notesEmptyEl.hidden = false;
      notesEmptyEl.querySelector(".empty-title").textContent = `Couldn't load: ${String((err && err.message) || err)}`;
    }
  }

  async function showLibrary() {
    viewMode = "library";
    compareToggle.setAttribute("aria-pressed", "false");
    gridEl.hidden = true;
    emptyEl.hidden = true;
    compareViewEl.hidden = true;
    // The Sites/Collections/Notes tab row directly below already makes it
    // obvious you're in the Library and already IS the navigation — a
    // second "jump back to whatever site you're on" link sitting above it
    // (first as "All sites", then as "← Current site") was a confusing,
    // redundant control once real tabs existed: "if I'm already on the
    // Sites tab, why is there a separate 'current site' thing, and where
    // would it even take me." The whole row is hidden here now rather
    // than showing an empty bar with just a hairline under it — it comes
    // back with real content (a hostname, a Collection name, "← Notes")
    // the moment you actually drill into something, via
    // showSiteViewChrome below.
    siteLineEl.hidden = true;
    selectToggleBtn.hidden = true;
    selectBarEl.hidden = true;
    exitFolderSelectMode();
    libraryTabsEl.hidden = false;
    siteLineTextEl.textContent = "";
    siteLineTextEl.classList.remove("site-line-clickable");
    if (libraryTab === "collections") await showLibraryCollections();
    else if (libraryTab === "notes") await showLibraryNotes();
    else await showLibrarySites();
  }

  tabSitesBtn.addEventListener("click", () => showLibrarySites());
  tabCollectionsBtn.addEventListener("click", () => showLibraryCollections());
  tabNotesBtn.addEventListener("click", () => showLibraryNotes());

  // --- Compare / Pairing view (Section 7E) -------------------------------
  let currentPairing = null; // { heading: item, body: item } for the currently-shown sample

  function hideOtherViewsFor(target) {
    gridEl.hidden = true;
    emptyEl.hidden = true;
    libraryGridEl.hidden = true;
    libraryEmptyEl.hidden = true;
    collectionsGridEl.hidden = true;
    collectionsEmptyEl.hidden = true;
    libraryTabsEl.hidden = true;
    compareViewEl.hidden = target !== "compare";
    selectToggleBtn.hidden = true;
    selectBarEl.hidden = true;
    libraryTabsSelectToggle.hidden = true;
    exitFolderSelectMode();
    // Same as showSiteViewChrome — showLibrary() hides this whole row, so
    // leaving Library via the compare toggle needs to bring it back too.
    siteLineEl.hidden = false;
    backBtn.hidden = false;
    backBtn.textContent = "← All sites";
    compareToggle.setAttribute("aria-pressed", String(target === "compare"));
  }

  async function showCompareView() {
    viewMode = "compare";
    hideOtherViewsFor("compare");
    siteLineTextEl.textContent = "Compare fonts";

    const allItems = await HarvestDB.getAllItems();
    const headingFonts = allItems.filter((i) => i.type === "font" && i.family === "heading");
    const bodyFonts = allItems.filter((i) => i.type === "font" && i.family === "body");

    if (headingFonts.length === 0 || bodyFonts.length === 0) {
      compareEmptyEl.hidden = false;
      compareSampleEl.hidden = true;
      compareHeadingSelect.innerHTML = "";
      compareBodySelect.innerHTML = "";
      return;
    }
    compareEmptyEl.hidden = true;

    function populate(select, items) {
      select.innerHTML = "";
      items.forEach((it) => {
        const opt = document.createElement("option");
        opt.value = it.id;
        opt.textContent = `${it.data.family} — ${it.hostname}`;
        select.appendChild(opt);
      });
    }
    populate(compareHeadingSelect, headingFonts);
    populate(compareBodySelect, bodyFonts);

    function updateSample() {
      const h = headingFonts.find((i) => i.id === compareHeadingSelect.value);
      const b = bodyFonts.find((i) => i.id === compareBodySelect.value);
      if (!h || !b) return;
      compareSampleEl.hidden = false;
      compareSampleHeadingEl.style.fontFamily = h.data.fallbackStack || h.data.family || "serif";
      compareSampleHeadingEl.style.fontWeight = h.data.weight || "700";
      compareSampleHeadingEl.style.fontSize = `${h.data.sizePx || 32}px`;
      compareSampleHeadingEl.style.letterSpacing = `${h.data.letterSpacingPx || 0}px`;

      compareSampleBodyEl.style.fontFamily = b.data.fallbackStack || b.data.family || "sans-serif";
      compareSampleBodyEl.style.fontWeight = b.data.weight || "400";
      compareSampleBodyEl.style.fontSize = `${b.data.sizePx || 16}px`;
      compareSampleBodyEl.style.letterSpacing = `${b.data.letterSpacingPx || 0}px`;

      currentPairing = { heading: h, body: b };
    }
    compareHeadingSelect.onchange = updateSample;
    compareBodySelect.onchange = updateSample;
    updateSample();
  }

  compareToggle.addEventListener("click", () => {
    if (viewMode === "compare") {
      viewMode = "auto-site";
      showSiteViewChrome();
      syncActiveTab();
    } else {
      showCompareView();
    }
  });

  compareSaveBtn.addEventListener("click", async () => {
    if (!currentPairing) return;
    const { heading, body } = currentPairing;
    // Stored as a normal item (type "pairing") in its own pseudo-folder —
    // reuses the existing items store/index rather than a parallel schema,
    // and it just naturally shows up as a "Pairings" folder in the Sites
    // grid, no special-casing needed anywhere else in the UI.
    await HarvestDB.addItem({
      id: Harvest.uuid(),
      type: "pairing",
      family: "other",
      hostname: "Pairings",
      capturedAt: new Date().toISOString(),
      sourceUrl: "",
      sourcePageTitle: "",
      selector: `${heading.data.family} + ${body.data.family}`,
      note: "",
      data: {
        headingItemId: heading.id,
        bodyItemId: body.id,
        headingFamily: heading.data.family,
        bodyFamily: body.data.family,
      },
    });
    showPairingSavedConfirm(heading, body);
  });

  // Pattern 12 — a nested card-in-card with a gradient hero band showing
  // what was just created, above the plain confirmation text + CTA,
  // instead of the plain-text confirmation every other action uses. This
  // is the one moment in the product that gets this treatment (saving a
  // pairing is a deliberate, considered choice — unlike a routine
  // collect/delete — so it earns a beat of its own, same restraint logic
  // as the tooltip's collect-moment).
  function showPairingSavedConfirm(heading, body) {
    modalRoot.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "sp-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "sp-modal sp-modal-hero";

    const hero = document.createElement("div");
    hero.className = "sp-modal-hero-band";
    const preview = document.createElement("div");
    preview.className = "sp-modal-hero-preview";
    const h = document.createElement("div");
    h.className = "sp-modal-hero-heading";
    h.textContent = heading.data.sampleText || heading.data.family;
    h.style.fontFamily = heading.data.fallbackStack || "sans-serif";
    const b = document.createElement("div");
    b.className = "sp-modal-hero-body";
    b.textContent = body.data.sampleText || body.data.family;
    b.style.fontFamily = body.data.fallbackStack || "sans-serif";
    preview.appendChild(h);
    preview.appendChild(b);
    hero.appendChild(preview);
    modal.appendChild(hero);

    const content = document.createElement("div");
    content.className = "sp-modal-hero-content";
    const title = document.createElement("div");
    title.className = "sp-modal-title";
    title.textContent = "Pairing saved";
    const bodyText = document.createElement("div");
    bodyText.className = "sp-modal-body";
    bodyText.textContent = `${heading.data.family} + ${body.data.family} — browsable in your library like any other capture.`;
    const actions = document.createElement("div");
    actions.className = "sp-modal-actions";
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "sp-modal-confirm sp-modal-confirm-accent";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => { modalRoot.innerHTML = ""; });
    actions.appendChild(doneBtn);
    content.appendChild(title);
    content.appendChild(bodyText);
    content.appendChild(actions);
    modal.appendChild(content);

    overlay.appendChild(modal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) modalRoot.innerHTML = ""; });
    modalRoot.appendChild(overlay);
  }

  // --- Export / copy (src/sidepanel/export/, src/sidepanel/copy/) ---------
  function showNotionPagePicker(pages) {
    return new Promise((resolve) => {
      modalRoot.innerHTML = "";
      const overlay = document.createElement("div");
      overlay.className = "sp-modal-overlay";
      const modal = document.createElement("div");
      modal.className = "sp-modal sp-modal-picker";
      const closePicker = () => { modalRoot.innerHTML = ""; resolve(null); };
      appendPickerHeader(modal, "Export to which Notion page?", closePicker);
      const list = document.createElement("div");
      list.className = "collection-picker-list";
      if (pages.length === 0) {
        const empty = document.createElement("div");
        empty.className = "sp-modal-body";
        empty.textContent = 'No pages are shared with Harvest yet — open Notion, share a page with the "Harvest" integration, then try again.';
        list.appendChild(empty);
      }
      pages.forEach((p) => {
        const row = document.createElement("div");
        row.className = "collection-picker-row";
        const icon = document.createElement("div");
        icon.className = "collection-picker-icon";
        icon.innerHTML = Harvest.ICONS.folder;
        row.appendChild(icon);
        const text = document.createElement("div");
        text.className = "collection-picker-text";
        const name = document.createElement("div");
        name.className = "collection-picker-name";
        name.textContent = p.title;
        text.appendChild(name);
        row.appendChild(text);
        row.addEventListener("click", () => { modalRoot.innerHTML = ""; resolve(p.id); });
        list.appendChild(row);
      });
      modal.appendChild(list);
      overlay.appendChild(modal);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closePicker(); });
      modalRoot.appendChild(overlay);
    });
  }

  function performZipExport() {
    return HarvestZipExport.performZipExport(exportContext, {
      showFeedback: showExportFeedback,
      noteFilenameFor,
      noteTextBlockFor,
    });
  }

  function performNotionExport() {
    return HarvestNotionExport.performNotionExport(exportContext, {
      showFeedback: showExportFeedback,
      showNotionPagePicker,
    });
  }

  function performExportToFigma() {
    return HarvestFigmaExport.performExportToFigma(exportContext, {
      showFeedback: showExportFeedback,
    });
  }

  function performPluginJsonExport() {
    return HarvestFigmaExport.performPluginJsonExport(exportContext, {
      showFeedback: showExportFeedback,
    });
  }

  function performPluginClipboardExport() {
    return HarvestFigmaExport.performPluginClipboardExport(exportContext, {
      showFeedback: showExportFeedback,
    });
  }

  function copyAllInSection(items, btn) {
    HarvestClipboardCopy.copyAllInSection(items, btn, copyDeps);
  }

  const TYPE_SECTION_LABEL = { color: "Colors", font: "Fonts", image: "Images", component: "Components", note: "Notes" };
  // "note" appended at the end, not interleaved — keeps the 4 types users
  // already know in the exact order they've always been in.
  const TYPE_SECTION_ORDER = ["color", "font", "image", "component", "note"];
  function render(items, scopeName) {
    gridEl.innerHTML = "";
    gridEl.className = expanded ? "grid expanded" : "grid";
    // Nothing to select ⇒ disable the control that selects it, here and at
    // every other "Select" affordance in the Library (libraryTabsSelectToggle
    // below) — a clickable-looking button over an empty grid invites a click
    // that can only ever do nothing.
    if (items.length === 0) {
      emptyEl.hidden = false;
      gridEl.hidden = true;
      selectToggleBtn.disabled = true;
      return;
    }
    selectToggleBtn.disabled = false;
    emptyEl.hidden = true;
    gridEl.hidden = false;

    const byType = new Map();
    for (const item of items) {
      if (!byType.has(item.type)) byType.set(item.type, []);
      byType.get(item.type).push(item);
    }
    const frag = document.createDocumentFragment();
    TYPE_SECTION_ORDER.forEach((type) => {
      const group = byType.get(type);
      if (!group || group.length === 0) return;
      const sorted = [...group].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));

      const section = document.createElement("div");
      section.className = "grid-section";

      const header = document.createElement("div");
      header.className = "grid-section-header";
      const label = document.createElement("span");
      label.className = "grid-section-label";
      label.textContent = `${TYPE_SECTION_LABEL[type]} — ${sorted.length}`;
      header.appendChild(label);

      const actionsWrap = document.createElement("div");
      actionsWrap.className = "grid-section-actions";
      const copyAllBtn = document.createElement("button");
      copyAllBtn.type = "button";
      copyAllBtn.className = "grid-section-copy-btn";
      copyAllBtn.innerHTML = Harvest.ICONS.copy;
      copyAllBtn.title = `Copy all ${TYPE_SECTION_LABEL[type].toLowerCase()} — paste into Figma, Claude, or docs`;
      copyAllBtn.setAttribute("aria-label", `Copy all ${TYPE_SECTION_LABEL[type].toLowerCase()} in this section`);
      copyAllBtn.addEventListener("click", () => copyAllInSection(sorted, copyAllBtn));
      actionsWrap.appendChild(copyAllBtn);
      if (type === "image") {
        const dlAll = document.createElement("button");
        dlAll.type = "button";
        dlAll.className = "grid-section-action";
        dlAll.textContent = "Download all";
        dlAll.addEventListener("click", () => downloadAllImages(sorted, scopeName));
        actionsWrap.appendChild(dlAll);
      }
      if (type === "note") {
        // Text-native equivalent of "Download all" for images — one
        // combined .md file rather than a ZIP of many tiny files, since
        // that's the more useful shape for a stack of plain-text notes.
        // render() is only ever called already scoped to one site or one
        // Collection (never a true flat cross-site list — see
        // showLibraryNotes' own folder-card grid for that view instead),
        // so scopeName is always a real name here — naming it beats the
        // generic "Download all" every other section-type button uses,
        // since notes are the one type where the site truly organizes
        // the whole 2nd-level view you're looking at.
        const dlAllNotes = document.createElement("button");
        dlAllNotes.type = "button";
        dlAllNotes.className = "grid-section-action";
        const dlLabel = scopeName || "";
        const dlLabelShort = dlLabel.length > 22 ? `${dlLabel.slice(0, 21)}…` : dlLabel;
        dlAllNotes.textContent = dlLabel ? `Download ${dlLabelShort}` : "Download all";
        if (dlLabel) dlAllNotes.title = `Download all notes from "${dlLabel}"`;
        dlAllNotes.addEventListener("click", () => downloadAllNotes(sorted, scopeName));
        actionsWrap.appendChild(dlAllNotes);
      }
      header.appendChild(actionsWrap);
      section.appendChild(header);

      const sectionItems = document.createElement("div");
      // Notes get a single full-width column instead of the fixed 3-col
      // grid every other type uses — a text excerpt needs real width to
      // stay legible; squeezing it into a 1/3-width tile like a color
      // swatch would truncate almost everything.
      sectionItems.className = type === "note" ? "grid-section-items grid-section-items-notes" : "grid-section-items";
      // The compact grid is always a fixed 3-column layout (.grid-
      // section-items), so which row a tile lands in is exactly
      // index/3 — no DOM measurement needed. Reserve a note's height
      // for a note-less tile only when an actual sibling in ITS OWN row
      // has one; a fully note-free row stays fully compact instead of
      // every tile everywhere carrying dead space for a note that
      // doesn't exist anywhere nearby.
      if (type === "note") {
        // Text doesn't fit the swatch/thumbnail-hero shape buildTile/
        // buildCard both assume — its own excerpt-row renderer, grouped by
        // day like the Notes tab, instead of forcing a text capture into
        // an image-shaped tile.
        appendGroupedNoteTiles(sectionItems, sorted);
      } else {
        const COLS = 3;
        sorted.forEach((item, i) => {
          if (expanded) {
            sectionItems.appendChild(buildCard(item));
            return;
          }
          const rowStart = Math.floor(i / COLS) * COLS;
          const rowHasNote = sorted.slice(rowStart, rowStart + COLS).some((rowItem) => rowItem.note);
          sectionItems.appendChild(buildTile(item, rowHasNote));
        });
      }
      section.appendChild(sectionItems);
      frag.appendChild(section);
    });
    gridEl.appendChild(frag);
  }

  async function refresh() {
    if (!currentHostname) return;
    showSiteViewChrome();
    try {
      // Same exclusion as showLibrarySites' own folder grid — a Sites
      // folder card never counts or shows this host's notes, so drilling
      // into it has to stay consistent instead of revealing them anyway
      // once you're one click deeper. Notes for this host are still
      // exactly where they've always been — under the Notes tab's own
      // per-site folder for this same hostname.
      const items = (await HarvestDB.getItemsByHostname(currentHostname)).filter((item) => item.type !== "note");
      siteLineTextEl.innerHTML = "";
      const hostSpan = document.createElement("span");
      hostSpan.className = "hostname";
      hostSpan.textContent = currentHostname;
      siteLineTextEl.appendChild(document.createTextNode("On "));
      siteLineTextEl.appendChild(hostSpan);
      siteLineTextEl.appendChild(document.createTextNode(` — ${items.length} item${items.length === 1 ? "" : "s"}`));
      render(items, currentHostname);
    } catch (err) {
      siteLineTextEl.textContent = `Couldn't load items: ${String((err && err.message) || err)}`;
    }
  }

  // The Notes tab's drill-in view — same host, same render() renderer as
  // refresh() above, but filtered to type==="note" before it ever reaches
  // render(), so this can never show (or let you delete) that site's
  // other captures. A fully separate function from refresh() rather than
  // a flag on it, so the two data paths can't accidentally cross.
  async function refreshNotesOnly() {
    if (!currentHostname) return;
    showSiteViewChrome();
    // One correction on top of the generic chrome showSiteViewChrome()
    // just applied (it's shared with the Sites tab's own drill-in, which
    // this doesn't apply to): "← All sites" is wrong here — this view is
    // reached from the Notes tab, not Sites, and going back lands back on
    // the Notes tab's own folder grid (showLibrary() dispatches on
    // libraryTab, which stays "notes" the whole time this view is open).
    // "Select" used to be force-hidden here too — buildNoteTile now opts
    // into select mode the same way buildTile/buildRichCard already did
    // (checkbox + bulk "Add to Collection"/export/delete via the shared
    // select bar), so the button is left at showSiteViewChrome()'s own
    // default (visible, disabled only when there's nothing to select —
    // render() already handles that) instead of being overridden here.
    backBtn.textContent = "← Notes";
    try {
      const items = await HarvestDB.getItemsByHostname(currentHostname);
      const notes = items.filter((item) => item.type === "note");
      siteLineTextEl.innerHTML = "";
      // Just the hostname — "← Notes" already says what section this is,
      // and the count already shows again right below in the "NOTES — N"
      // section label (render()'s own header), so "Notes on X — N notes"
      // here was saying both of those a second time.
      const hostSpan = document.createElement("span");
      hostSpan.className = "hostname";
      hostSpan.textContent = currentHostname;
      siteLineTextEl.appendChild(hostSpan);
      render(notes, currentHostname);
    } catch (err) {
      siteLineTextEl.textContent = `Couldn't load notes: ${String((err && err.message) || err)}`;
    }
  }

  async function refreshCollectionDetail() {
    if (!currentCollectionId) return;
    showSiteViewChrome();
    try {
      const col = await HarvestDB.getCollection(currentCollectionId);
      if (!col) {
        // Deleted from elsewhere (e.g. undone/re-deleted) while viewing it.
        showLibrary();
        return;
      }
      const resolved = await HarvestDB.resolveCollectionItems(col);
      // Filter to match whichever tab this Collection was opened from — a
      // mixed Collection can appear in both, but each side must only ever
      // show its own half (see currentCollectionMode).
      const items =
        currentCollectionMode === "notes"
          ? resolved.filter((it) => it.type === "note")
          : resolved.filter((it) => it.type !== "note");
      siteLineTextEl.innerHTML = "";
      const nameSpan = document.createElement("span");
      nameSpan.className = "hostname";
      nameSpan.textContent = col.name;
      siteLineTextEl.appendChild(nameSpan);
      const noun = currentCollectionMode === "notes" ? "note" : "item";
      siteLineTextEl.appendChild(document.createTextNode(` — ${items.length} ${noun}${items.length === 1 ? "" : "s"}`));
      render(items, col.name);
    } catch (err) {
      siteLineTextEl.textContent = `Couldn't load collection: ${String((err && err.message) || err)}`;
    }
  }

  async function syncActiveTab() {
    // Manually browsing a picked folder/collection or the library grid
    // must not get silently swapped out from under the user just because
    // they switched browser tabs elsewhere — only auto-follow when
    // nothing else is deliberately being viewed.
    if (viewMode !== "auto-site") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:\/\//.test(tab.url)) {
      currentHostname = null;
      siteLineTextEl.textContent = "Harvest can't run on this page.";
      backBtn.hidden = false;
      selectToggleBtn.hidden = true;
      gridEl.hidden = true;
      emptyEl.hidden = true;
      return;
    }
    try {
      currentHostname = new URL(tab.url).hostname;
    } catch (_) {
      currentHostname = null;
    }
    await refresh();
  }

  // Always opens Library — this whole button is hidden while
  // viewMode === "library" (see showLibrary), so there's nothing else for
  // a real click on it to context-switch on anymore.
  backBtn.addEventListener("click", () => {
    showLibrary();
  });

  // The docked side panel can't reposition itself into a floating window —
  // it's a native Chrome surface, not a page element — so "collapse" means:
  // make sure the on-page floating toolbar (toolbar.js) is visible, then
  // close this panel to give the page its full width back. This is also
  // the only way back to the floating toolbar once its own close button
  // has dismissed it — there's no dedicated "restore" control anymore, so
  // collapsing the panel is the recovery path.
  // Expanding back is the floating toolbar's existing "open panel" button
  // (same Harvest.ICONS.panel glyph, toolbar.js) — collapse and expand are
  // literally the same icon from opposite ends, not two different affordances.
  //
  // window.close() DOES close a side panel document — verified against the
  // sibling Design System Extractor project's own collapseBtn, which has
  // used exactly this for its own docked panel all along. An earlier
  // version of this file assumed it was a silent no-op and routed collapse
  // through disabling the panel for this tab instead
  // (chrome.sidePanel.setOptions({enabled:false})) — real, but Chrome's own
  // behavior around re-enabling a disabled panel turned out to be exactly
  // the source of "collapse works once, then the icon won't reopen it" and
  // "both panel and floating toolbar end up open at once." Never disabling
  // the panel in the first place sidesteps all of that.
  collapseBtn.addEventListener("click", () => {
    // chrome.storage.local.set() is async — closing the panel on the very
    // next line (before its own callback fires) raced window.close() against
    // the write actually committing. Closing an extension UI surface before
    // an in-flight storage call's callback runs can silently drop that call
    // — which is exactly what "the floating toolbar only reappears after a
    // refresh" was: the write eventually landed (a fresh page's synchronous
    // read picked it up), but the live broadcast to the already-open
    // content script's chrome.storage.onChanged listener never went out in
    // time. Waiting for the callback guarantees the write is committed
    // before the panel (and this document's ability to keep the call alive)
    // goes away.
    chrome.storage.local.set({ harvestToolbarDismissed: false }, () => {
      window.close();
    });
  });

  function applyActiveState(active) {
    activeToggle.setAttribute("aria-pressed", String(active));
    activeToggle.title = active ? "Hover-capture is on — click to pause" : "Hover-capture is paused — click to resume";
  }

  // Turning ONE capture mode on now turns the other off — two tooltips
  // live on the same page at once read as broken/conflicting, confirmed
  // confusing in practice, so "switch to this mode" means exactly that,
  // not "also enable this on top of whatever else is running." Writing
  // both keys in one chrome.storage.local.set call (rather than a second,
  // separate write) means every listener — this panel, the floating
  // toolbar, both content scripts — sees one atomic state change instead
  // of two, so nothing can observe an impossible "both on" moment in between.
  function setHarvestActive(next) {
    chrome.storage.local.set(next ? { harvestActive: true, harvestNotesActive: false } : { harvestActive: false });
    applyActiveState(next); // instant feedback, don't wait for the storage round-trip
  }

  chrome.storage.local.get(["harvestActive"], (res) => {
    applyActiveState(res.harvestActive === true);
  });
  activeToggle.addEventListener("click", () => {
    setHarvestActive(activeToggle.getAttribute("aria-pressed") !== "true");
  });

  // Independent second toggle — text-selection notes capture
  // (src/content/notes.js). Own storage key, mirrors the hover-capture
  // toggle above exactly, deliberately not combined with it.
  function applyNotesActiveState(active) {
    notesToggle.setAttribute("aria-pressed", String(active));
    notesToggle.title = active
      ? "Notes capture is on — select text on the page to collect it"
      : "Notes capture is off — click to turn on";
  }

  function setNotesActive(next) {
    chrome.storage.local.set(next ? { harvestNotesActive: true, harvestActive: false } : { harvestNotesActive: false });
    applyNotesActiveState(next);
  }

  chrome.storage.local.get(["harvestNotesActive"], (res) => {
    applyNotesActiveState(res.harvestNotesActive === true);
  });
  notesToggle.addEventListener("click", () => {
    setNotesActive(notesToggle.getAttribute("aria-pressed") !== "true");
  });

  // This script running at all means the panel is now visible, regardless
  // of what opened it — the real browser toolbar icon (Chrome's own
  // built-in behavior, background.js doesn't see that click at all), the
  // floating pill's own panel button, or anything else in the future. If
  // the floating pill happened to still be showing from a previous visit,
  // it would otherwise sit there alongside the panel until something else
  // dismissed it. One unconditional write here, right at load, is a
  // simpler guarantee than trying to intercept every possible path that
  // can open a side panel.
  chrome.storage.local.set({ harvestToolbarDismissed: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.harvestNotesActive) {
      applyNotesActiveState(changes.harvestNotesActive.newValue === true);
    }
    if (changes.harvestActive) {
      applyActiveState(changes.harvestActive.newValue === true);
    }
  });

  chrome.tabs.onActivated.addListener(syncActiveTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) syncActiveTab();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ITEMS_UPDATED") return;
    // Refresh whatever is actually on screen, not just the auto-tab view —
    // otherwise a capture while manually browsing a different folder (or
    // the library grid) either silently fails to show up, or worse, would
    // yank the view back to the active tab if this just called
    // syncActiveTab() unconditionally.
    refreshCurrentView();
  });

  syncActiveTab();
})();
