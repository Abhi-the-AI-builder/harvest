// Figma export — true "Export to Figma" via clipboard + companion plugin.
// Figma's REST API cannot create design nodes; the Acopio Figma plugin
// imports JSON via the Plugin API. OAuth (cloud-oauth.js) is only for a
// future file-picker feature and is not required here.
(function () {
  if (window.AcopioFigmaExport) return;

  const H = window.AcopioExportHelpers;

  // Development plugins (Acopio Import) only run in Figma Desktop — never
  // open figma.com in the browser; that leaves designers without the plugin.
  const FIGMA_DESKTOP_SCHEME = "figma://";

  function openFigmaDesktop() {
    try {
      // Custom protocol focuses/opens the Desktop app without a useless web tab.
      const a = document.createElement("a");
      a.href = FIGMA_DESKTOP_SCHEME;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {
      // Modal still tells the user to switch to Desktop manually.
    }
  }

  async function writeExportClipboard(json) {
    try {
      await navigator.clipboard.writeText(json);
      return true;
    } catch (_) {
      // fall through
    }
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": new Blob([json], { type: "text/plain" }) }),
        ]);
        return true;
      }
    } catch (_) {
      // fall through
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = json;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return Boolean(ok);
    } catch (_) {
      return false;
    }
  }

  // System clipboard + Figma UI iframe both choke on multi‑MB JSON. Above this,
  // download the file and tell the user to paste from it — never silent fail.
  const CLIPBOARD_SOFT_LIMIT_CHARS = 1800000;

  async function downloadPluginJson(payload, scopeKey) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scopeKey || "acopio"}-figma-plugin.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function inlineComponentItem(out) {
    // Dual path on the stored item (local Library / IndexedDB — not a remote
    // “backend”): layoutTree is for Figma editable rebuild; previewImage is
    // for Copy/ZIP. Export to Figma always inlines tree assets and keeps the
    // editable path. Screenshot is only forced when the tree is empty.
    let mediaHealth = { needed: 0, ready: 0 };
    if (out.data.layoutTree) {
      await H.inlineTreeAssets(out.data.layoutTree);
      mediaHealth = H.countTreeMediaHealth(out.data.layoutTree);
    }
    out.data._figmaMediaNeeded = mediaHealth.needed;
    out.data._figmaMediaReady = mediaHealth.ready;
    // Clear stale preferScreenshot from older collects when we now have a
    // usable tree — Figma must get editable layers, not a flat image.
    if (out.data.layoutTree && !out.data.layoutTree.preferScreenshot) {
      out.data.preferScreenshot = false;
    }
    if (out.data.previewImage) {
      try {
        const previewBlob = await H.urlToPngBlob(out.data.previewImage);
        out.data.previewImage = await H.blobToDataUrl(previewBlob);
      } catch (_) {
        // keep original previewImage if conversion fails
      }
    }
  }

  async function inlineImageItem(out) {
    if (out.data.url && !out.data.isVideo) {
      await H.inlineImageUrl(out.data);
    }
  }

  async function inlineNoteItem(out) {
    if (!Array.isArray(out.data.images)) return;
    for (const img of out.data.images) {
      if (img && img.url) {
        try {
          await H.inlineImageUrl(img);
        } catch (_) {
          // skip images that fail to inline
        }
      }
    }
  }

  const FIGMA_ITEM_INLINERS = {
    image: inlineImageItem,
    component: inlineComponentItem,
    note: inlineNoteItem,
  };

  // Deep-clone item.data before inlining. A shallow `{ ...data }` still
  // shares layoutTree / images with the live Library item — inlineTreeAssets
  // would then mutate memory used by ZIP, Notion, copy, and the grid.
  function cloneItemData(data) {
    if (!data || typeof data !== "object") return {};
    try {
      if (typeof structuredClone === "function") return structuredClone(data);
    } catch (_) {
      // fall through
    }
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (_) {
      return { ...data };
    }
  }

  async function buildPluginJsonPayload(exportContext, options) {
    const opts = options || {};
    const items = await Promise.all(
      exportContext.items.map(async (item) => {
        const out = {
          id: item.id,
          type: item.type,
          family: item.family,
          hostname: item.hostname,
          sourceUrl: item.sourceUrl,
          note: item.note || "",
          data: cloneItemData(item.data),
        };
        delete out.data.__sanitizeResult;
        const inliner = FIGMA_ITEM_INLINERS[item.type];
        if (inliner) await inliner(out);
        return out;
      })
    );
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      scopeLabel: exportContext.scopeLabel,
      renderMode: opts.renderMode || "simple",
      autoImport: Boolean(opts.autoImport),
      openedFromExtension: Boolean(opts.openedFromExtension),
      items,
    };
  }

  async function getOrCreatePairKey() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["acopioFigmaPairKey"], (res) => {
        if (res.acopioFigmaPairKey) {
          resolve(String(res.acopioFigmaPairKey));
          return;
        }
        const key =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
            : `acopio${Date.now().toString(36)}`;
        chrome.storage.local.set({ acopioFigmaPairKey: key }, () => resolve(key));
      });
    });
  }

  async function uploadFigmaHandoff(pairKey, payload) {
    const base = self.ACOPIO_SUPABASE_URL;
    const anon = self.ACOPIO_SUPABASE_ANON_KEY;
    if (!base || !anon) {
      throw new Error("Supabase isn't configured — set ACOPIO_SUPABASE_URL / ANON_KEY.");
    }
    const url = `${String(base).replace(/\/$/, "")}/functions/v1/figma-handoff`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify({ pairKey, payload }),
    });
    let body = {};
    try {
      body = await resp.json();
    } catch (_) {
      body = {};
    }
    if (!resp.ok) {
      throw new Error((body && body.error) || `Handoff upload failed (${resp.status})`);
    }
    return body;
  }

  async function performExportToFigma(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    const showHandoff = deps.showHandoff;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    showFeedback("Preparing Figma export…");
    try {
      const payload = await buildPluginJsonPayload(exportContext, {
        renderMode: "full",
        autoImport: true,
        openedFromExtension: true,
      });

      const components = payload.items.filter((item) => item.type === "component");
      const flatCount = components.filter((item) => !(item.data && item.data.layoutTree)).length;
      const truncatedCount = components.filter((item) => item.data && item.data.layersTruncated).length;
      const screenshotPreferred = components.filter(
        (item) => item.data && (item.data.preferScreenshot || (item.data.layoutTree && item.data.layoutTree.preferScreenshot))
      ).length;
      const mediaGap = components.reduce((sum, item) => {
        const needed = (item.data && item.data._figmaMediaNeeded) || 0;
        const ready = (item.data && item.data._figmaMediaReady) || 0;
        return sum + Math.max(0, needed - ready);
      }, 0);
      for (const item of payload.items) {
        if (!item.data) continue;
        delete item.data._figmaMediaNeeded;
        delete item.data._figmaMediaReady;
      }

      // Primary path: upload to handoff service so Import can fetch (no clipboard).
      const pairKey = await getOrCreatePairKey();
      payload.pairKey = pairKey;
      let handoffOk = false;
      let handoffError = "";
      try {
        showFeedback("Uploading export for Figma Import…");
        await uploadFigmaHandoff(pairKey, payload);
        handoffOk = true;
      } catch (err) {
        handoffError = String((err && err.message) || err);
        handoffOk = false;
      }

      // Tertiary: clipboard / download — only if handoff failed or as paste backup.
      const json = JSON.stringify(payload);
      const tooLargeForClipboard = json.length > CLIPBOARD_SOFT_LIMIT_CHARS;
      let clipboardOk = false;
      if (!tooLargeForClipboard) {
        // Prefer short pair token first (survives better); also keep full JSON for paste fallback.
        clipboardOk = await writeExportClipboard(`ACOPIO_FIGMA_PAIR:${pairKey}\n${json}`);
        if (!clipboardOk) clipboardOk = await writeExportClipboard(json);
      }
      if (!handoffOk && (tooLargeForClipboard || !clipboardOk)) {
        await downloadPluginJson(payload, exportContext.scopeKey);
      }

      try {
        await chrome.storage.local.set({
          acopioPendingFigmaExport: {
            itemCount: payload.items.length,
            scopeLabel: payload.scopeLabel,
            exportedAt: payload.exportedAt,
            pairKey,
            delivery: handoffOk ? "handoff" : clipboardOk ? "clipboard" : "download",
          },
        });
      } catch (_) {
        // non-fatal
      }

      setTimeout(() => openFigmaDesktop(), handoffOk ? 80 : 120);

      const siteCount = exportContext.siteCount || new Set(exportContext.items.map((item) => item.hostname)).size;
      const itemCount = payload.items.length;
      const siteNote = siteCount > 1 ? ` from ${siteCount} sites` : "";
      const fidelityNotes = [];
      if (flatCount > 0) {
        fidelityNotes.push(
          `${flatCount} component${flatCount === 1 ? "" : "s"} need re-collect for editable layers`
        );
      }
      if (screenshotPreferred > 0) {
        fidelityNotes.push(
          `${screenshotPreferred} will import as screenshot for fidelity`
        );
      }
      if (truncatedCount > 0) {
        fidelityNotes.push(`${truncatedCount} large component${truncatedCount === 1 ? "" : "s"} simplified`);
      }
      if (mediaGap > 0) {
        fidelityNotes.push(`${mediaGap} image${mediaGap === 1 ? "" : "s"} may show placeholders`);
      }
      if (!handoffOk) {
        fidelityNotes.push(
          handoffError
            ? `Cloud handoff unavailable (${handoffError}) — use Paste in the plugin`
            : "Cloud handoff unavailable — use Paste in the plugin"
        );
      }

      const toast = handoffOk
        ? `Ready for Figma (${itemCount} item${itemCount === 1 ? "" : "s"}${siteNote}). Run Acopio Import → Import.`
        : clipboardOk
          ? `Clipboard backup ready (${itemCount}). Run Acopio Import — Paste if Import can't fetch.`
          : `JSON downloaded (${itemCount}). Run Acopio Import → Paste export.`;
      showFeedback(toast, handoffOk || clipboardOk ? "success" : "error");
      if (typeof showHandoff === "function") {
        showHandoff({
          itemCount,
          siteNote,
          fidelityNotes,
          delivery: handoffOk ? "handoff" : clipboardOk ? "clipboard" : "download",
          pairKey,
        });
      }
    } catch (err) {
      showFeedback(`Export failed: ${String((err && err.message) || err)}. Try again?`, "error");
    }
  }

  async function performPluginJsonExport(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    showFeedback("Building export…");
    try {
      const payload = await buildPluginJsonPayload(exportContext, { renderMode: "full" });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportContext.scopeKey}-figma-plugin.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showFeedback(
        `Downloaded ${payload.items.length} item${payload.items.length === 1 ? "" : "s"}. Run Acopio Import → Paste export instead with the file contents.`,
        "success"
      );
    } catch (err) {
      showFeedback(`Export failed: ${String((err && err.message) || err)}. Try again?`, "error");
    }
  }

  async function performPluginClipboardExport(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    showFeedback("Building export…");
    try {
      const payload = await buildPluginJsonPayload(exportContext, { renderMode: "full" });
      await navigator.clipboard.writeText(JSON.stringify(payload));
      showFeedback(
        `Copied ${payload.items.length} item${payload.items.length === 1 ? "" : "s"}. Open Acopio Import in Figma to paste.`,
        "success"
      );
    } catch (err) {
      showFeedback(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`, "error");
    }
  }

  window.AcopioFigmaExport = {
    performExportToFigma,
    performPluginJsonExport,
    performPluginClipboardExport,
    buildPluginJsonPayload,
    FIGMA_ITEM_INLINERS,
  };
})();
