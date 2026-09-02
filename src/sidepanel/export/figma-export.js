// Figma export — true "Export to Figma" via clipboard + companion plugin.
// Figma's REST API cannot create design nodes; the Harvest Figma plugin
// imports JSON via the Plugin API. OAuth (cloud-oauth.js) is only for a
// future file-picker feature and is not required here.
(function () {
  if (window.HarvestFigmaExport) return;

  const H = window.HarvestExportHelpers;

  const FIGMA_OPEN_URL = "https://www.figma.com/files/recent";
  const FIGMA_IMPORT_STEPS =
    "In Figma, run Harvest Import once (Plugins → Development → Harvest Import, or ⌘⌥P). It auto-imports from clipboard — or click Import from Harvest.";

  async function inlineComponentItem(out) {
    if (out.data.previewImage) {
      try {
        const previewBlob = await H.urlToPngBlob(out.data.previewImage);
        out.data.previewImage = await H.blobToDataUrl(previewBlob);
      } catch (_) {
        // keep original previewImage if conversion fails
      }
    }
    if (out.data.layoutTree) {
      await H.inlineTreeAssets(out.data.layoutTree);
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
          data: { ...item.data },
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
      items,
    };
  }

  async function performExportToFigma(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    showFeedback("Building export…");
    try {
      const payload = await buildPluginJsonPayload(exportContext, {
        renderMode: "simple",
        autoImport: true,
      });
      const json = JSON.stringify(payload);
      await navigator.clipboard.writeText(json);
      try {
        await chrome.storage.local.set({
          harvestPendingFigmaExport: {
            itemCount: payload.items.length,
            scopeLabel: payload.scopeLabel,
            exportedAt: payload.exportedAt,
          },
        });
      } catch (_) {
        // non-fatal — clipboard is the real handoff
      }
      chrome.tabs.create({ url: FIGMA_OPEN_URL });
      const siteCount = exportContext.siteCount || new Set(exportContext.items.map((item) => item.hostname)).size;
      const itemCount = payload.items.length;
      const siteNote =
        siteCount > 1 ? ` from ${siteCount} sites (grouped by site in Figma)` : "";
      showFeedback(
        `Copied ${itemCount} item${itemCount === 1 ? "" : "s"}${siteNote} to clipboard and opened Figma. ${FIGMA_IMPORT_STEPS} Install the plugin once from harvest-figma-plugin/manifest.json if you haven't yet.`,
        "success"
      );
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
        `Downloaded ${payload.items.length} item${payload.items.length === 1 ? "" : "s"}. Import the file in Figma via Harvest Import → Drop file.`,
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
        `Copied ${payload.items.length} item${payload.items.length === 1 ? "" : "s"}. In Figma, run Harvest Import and choose Paste from clipboard.`,
        "success"
      );
    } catch (err) {
      showFeedback(`Couldn't copy to clipboard: ${String((err && err.message) || err)}`, "error");
    }
  }

  window.HarvestFigmaExport = {
    performExportToFigma,
    performPluginJsonExport,
    performPluginClipboardExport,
    buildPluginJsonPayload,
    FIGMA_ITEM_INLINERS,
  };
})();
