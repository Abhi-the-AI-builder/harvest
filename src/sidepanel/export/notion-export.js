// Notion export — OAuth gates, block builders, per-type handlers.
(function () {
  if (window.AcopioNotionExport) return;

  const H = window.AcopioExportHelpers;

  async function ensureGoogleSignedIn(showFeedback) {
    const status = await chrome.runtime.sendMessage({ type: "GET_SUPABASE_STATUS" });
    if (status && status.signedIn) return true;
    showFeedback("Sign in with Google to continue…");
    const result = await chrome.runtime.sendMessage({ type: "SIGN_IN_WITH_GOOGLE" });
    if (!result || !result.ok) {
      showFeedback(`Google sign-in failed: ${(result && result.error) || "unknown error"}`, "error");
      return false;
    }
    return true;
  }

  async function ensureNotionConnected(showFeedback) {
    const status = await chrome.runtime.sendMessage({ type: "GET_NOTION_STATUS" });
    if (status && status.connected) return true;
    showFeedback("Connecting to Notion…");
    const result = await chrome.runtime.sendMessage({ type: "CONNECT_NOTION" });
    if (!result || !result.ok) {
      showFeedback(`Couldn't connect Notion: ${(result && result.error) || "unknown error"}`, "error");
      return false;
    }
    return true;
  }

  function notionHeadingBlock(text) {
    return { object: "block", type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: String(text).slice(0, 2000) } }] } };
  }

  function notionHeading2Block(text) {
    return { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: String(text).slice(0, 2000) } }] } };
  }

  function notionParagraphBlock(text) {
    return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: String(text).slice(0, 2000) } }] } };
  }

  function notionImageUploadBlock(fileUploadId) {
    return {
      object: "block",
      type: "image",
      image: {
        type: "file_upload",
        file_upload: { id: fileUploadId },
        caption: [],
      },
    };
  }

  function notionExternalImageBlock(url) {
    return {
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: String(url).slice(0, 2000) },
        caption: [],
      },
    };
  }

  function notionImageFallbackParagraph(item) {
    const data = item.data || {};
    const parts = ["Image couldn't be uploaded — hover and Collect again to refresh it."];
    if (data.url && !String(data.url).startsWith("blob:")) parts.push(data.url);
    return notionParagraphBlock(parts.join("\n"));
  }

  function bestExternalImageUrl(item) {
    const data = item.data || {};
    if (!data.url || String(data.url).startsWith("blob:")) return null;
    const upgraded = typeof Acopio !== "undefined" && Acopio.upgradeImageUrl ? Acopio.upgradeImageUrl(data.url) : data.url;
    return upgraded || data.url;
  }

  async function uploadItemImageToNotion(item, filename) {
    const data = item.data || {};
    const dataUrl =
      (data.inlineDataUrl && String(data.inlineDataUrl).startsWith("data:") && data.inlineDataUrl) ||
      (data.previewImage && String(data.previewImage).startsWith("data:") && data.previewImage) ||
      null;

    let payload;
    if (dataUrl) {
      payload = { dataUrl, filename };
    } else {
      const bytes = await H.resolveExportImageBytes(item);
      if (!bytes || !bytes.length) return { ok: false, externalUrl: bestExternalImageUrl(item) };
      const pngBytes = (await H.ensurePngBytes(bytes)) || bytes;
      payload = { base64: H.bytesToBase64(pngBytes), filename, mime: "image/png" };
    }

    const result = await chrome.runtime.sendMessage({
      type: "NOTION_UPLOAD_FILE",
      payload,
    });
    if (result && result.ok && result.fileUploadId) {
      return { ok: true, fileUploadId: result.fileUploadId };
    }
    return { ok: false, externalUrl: bestExternalImageUrl(item), error: result && result.error };
  }

  async function appendNotionImageBlock(item, blocks, filename) {
    const upload = await uploadItemImageToNotion(item, filename);
    if (upload.ok && upload.fileUploadId) {
      blocks.push(notionImageUploadBlock(upload.fileUploadId));
      return true;
    }
    if (upload.externalUrl) {
      blocks.push(notionExternalImageBlock(upload.externalUrl));
      return true;
    }
    blocks.push(notionImageFallbackParagraph(item));
    return false;
  }

  async function blocksForColor(item, blocks) {
    blocks.push(notionHeadingBlock(`Color — ${item.data.hex || "?"}`));
    await appendNotionImageBlock(item, blocks, `color-${item.id.slice(0, 6)}.png`);
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForPairing(item, blocks) {
    blocks.push(notionHeadingBlock("Font pairing"));
    blocks.push(notionParagraphBlock(`Heading: ${item.data.headingFamily || "?"} · Body: ${item.data.bodyFamily || "?"}${item.note ? " · " + item.note : ""}`));
  }

  async function blocksForFont(item, blocks) {
    blocks.push(notionHeadingBlock(`Font — ${item.data.family || "?"}`));
    await appendNotionImageBlock(item, blocks, `font-${item.id.slice(0, 6)}.png`);
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForImage(item, blocks, counters, stats) {
    counters.imageIdx += 1;
    blocks.push(notionHeadingBlock(`Image ${counters.imageIdx}`));
    const ok = await appendNotionImageBlock(item, blocks, `image-${counters.imageIdx}.png`);
    if (!ok) stats.missingImages += 1;
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForComponent(item, blocks, counters, stats) {
    counters.componentIdx += 1;
    blocks.push(notionHeadingBlock(`Component ${counters.componentIdx}`));
    const ok = await appendNotionImageBlock(item, blocks, `component-${counters.componentIdx}.png`);
    if (!ok) stats.missingImages += 1;
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  function blocksForNote(item, blocks) {
    blocks.push(notionHeadingBlock(item.sourcePageTitle || item.hostname || "Note"));
    blocks.push({ object: "block", type: "quote", quote: { rich_text: [{ type: "text", text: { content: (item.data.text || "").slice(0, 2000) } }] } });
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  const NOTION_BLOCK_BUILDERS = {
    color: blocksForColor,
    pairing: blocksForPairing,
    font: blocksForFont,
    image: blocksForImage,
    component: blocksForComponent,
    note: blocksForNote,
  };

  async function buildNotionBlocksForItems(items) {
    const blocks = [];
    const counters = { componentIdx: 0, imageIdx: 0 };
    const stats = { missingImages: 0 };
    const hostnames = new Set(items.map((item) => item.hostname || "unknown"));
    const multiSite = hostnames.size > 1;
    let currentHost = null;

    for (const item of items) {
      const host = item.hostname || "unknown";
      if (multiSite && host !== currentHost) {
        if (currentHost !== null) {
          blocks.push({ object: "block", type: "divider", divider: {} });
        }
        blocks.push(notionHeading2Block(host));
        currentHost = host;
      }

      const builder = NOTION_BLOCK_BUILDERS[item.type];
      if (builder) {
        if (item.type === "image" || item.type === "component") {
          await builder(item, blocks, counters, stats);
        } else {
          await builder(item, blocks);
        }
      }
      blocks.push({ object: "block", type: "divider", divider: {} });
    }
    return { blocks, stats };
  }

  async function performNotionExport(exportContext, deps) {
    const showFeedback = deps.showFeedback;
    if (!exportContext || exportContext.items.length === 0) {
      showFeedback("Nothing to export in this scope.", "error");
      return;
    }
    if (!(await ensureGoogleSignedIn(showFeedback))) return;
    if (!(await ensureNotionConnected(showFeedback))) return;
    showFeedback("Loading your Notion pages…");
    const searchResult = await chrome.runtime.sendMessage({ type: "NOTION_SEARCH_PAGES" });
    if (!searchResult || !searchResult.ok) {
      showFeedback(`Couldn't load Notion pages: ${(searchResult && searchResult.error) || "unknown error"}`, "error");
      return;
    }
    const parentPageId = await deps.showNotionPagePicker(searchResult.pages);
    if (!parentPageId) return;
    showFeedback("Creating the Notion page…");
    const { blocks, stats } = await buildNotionBlocksForItems(exportContext.items);
    const title = `Acopio — ${exportContext.scopeLabel || exportContext.scopeKey}`;
    const result = await chrome.runtime.sendMessage({ type: "NOTION_CREATE_PAGE", payload: { parentPageId, title, blocks } });
    if (!result || !result.ok) {
      showFeedback(`Notion export failed: ${(result && result.error) || "unknown error"}`, "error");
      return;
    }
    const siteCount = exportContext.siteCount || new Set(exportContext.items.map((item) => item.hostname)).size;
    const itemCount = exportContext.items.length;
    const siteNote =
      siteCount > 1 ? ` from ${siteCount} sites` : "";
    let successMsg = `Exported ${itemCount} item${itemCount === 1 ? "" : "s"}${siteNote} to Notion.`;
    if (stats.missingImages > 0) {
      successMsg += ` ${stats.missingImages} image${stats.missingImages === 1 ? "" : "s"} need re-collecting — hover and Collect again on those pins.`;
    }
    showFeedback(successMsg, stats.missingImages > 0 ? "error" : "success");
    if (result.url) chrome.tabs.create({ url: result.url });
  }

  window.AcopioNotionExport = {
    performNotionExport,
    buildNotionBlocksForItems,
    NOTION_BLOCK_BUILDERS,
    ensureGoogleSignedIn,
    ensureNotionConnected,
  };
})();
