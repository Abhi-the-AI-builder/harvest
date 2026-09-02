// Notion export — OAuth gates, block builders, per-type handlers.
(function () {
  if (window.HarvestNotionExport) return;

  const H = window.HarvestExportHelpers;

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

  async function uploadItemImageToNotion(item, filename) {
    const bytes = await H.resolveExportImageBytes(item);
    if (!bytes || !bytes.length) return null;
    const pngBytes = (await H.ensurePngBytes(bytes)) || bytes;
    const result = await chrome.runtime.sendMessage({
      type: "NOTION_UPLOAD_FILE",
      payload: { base64: H.bytesToBase64(pngBytes), filename, mime: "image/png" },
    });
    if (!result || !result.ok || !result.fileUploadId) return null;
    return result.fileUploadId;
  }

  async function blocksForColor(item, blocks) {
    blocks.push(notionHeadingBlock(`Color — ${item.data.hex || "?"}`));
    const uploadId = await uploadItemImageToNotion(item, `color-${item.id.slice(0, 6)}.png`);
    if (uploadId) blocks.push(notionImageUploadBlock(uploadId));
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForPairing(item, blocks) {
    blocks.push(notionHeadingBlock("Font pairing"));
    blocks.push(notionParagraphBlock(`Heading: ${item.data.headingFamily || "?"} · Body: ${item.data.bodyFamily || "?"}${item.note ? " · " + item.note : ""}`));
  }

  async function blocksForFont(item, blocks) {
    blocks.push(notionHeadingBlock(`Font — ${item.data.family || "?"}`));
    const uploadId = await uploadItemImageToNotion(item, `font-${item.id.slice(0, 6)}.png`);
    if (uploadId) blocks.push(notionImageUploadBlock(uploadId));
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForImage(item, blocks, counters) {
    counters.imageIdx += 1;
    blocks.push(notionHeadingBlock(`Image ${counters.imageIdx}`));
    const uploadId = await uploadItemImageToNotion(item, `image-${counters.imageIdx}.png`);
    if (uploadId) blocks.push(notionImageUploadBlock(uploadId));
    if (item.note) blocks.push(notionParagraphBlock(item.note));
  }

  async function blocksForComponent(item, blocks, counters) {
    counters.componentIdx += 1;
    blocks.push(notionHeadingBlock(`Component ${counters.componentIdx}`));
    const uploadId = await uploadItemImageToNotion(item, `component-${counters.componentIdx}.png`);
    if (uploadId) blocks.push(notionImageUploadBlock(uploadId));
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
          await builder(item, blocks, counters);
        } else {
          await builder(item, blocks);
        }
      }
      blocks.push({ object: "block", type: "divider", divider: {} });
    }
    return blocks;
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
    const blocks = await buildNotionBlocksForItems(exportContext.items);
    const title = `Harvest — ${exportContext.scopeLabel || exportContext.scopeKey}`;
    const result = await chrome.runtime.sendMessage({ type: "NOTION_CREATE_PAGE", payload: { parentPageId, title, blocks } });
    if (!result || !result.ok) {
      showFeedback(`Notion export failed: ${(result && result.error) || "unknown error"}`, "error");
      return;
    }
    const siteCount = exportContext.siteCount || new Set(exportContext.items.map((item) => item.hostname)).size;
    const itemCount = exportContext.items.length;
    const siteNote =
      siteCount > 1 ? ` from ${siteCount} sites` : "";
    showFeedback(
      `Exported ${itemCount} item${itemCount === 1 ? "" : "s"}${siteNote} to Notion.`,
      "success"
    );
    if (result.url) chrome.tabs.create({ url: result.url });
  }

  window.HarvestNotionExport = {
    performNotionExport,
    buildNotionBlocksForItems,
    NOTION_BLOCK_BUILDERS,
    ensureGoogleSignedIn,
    ensureNotionConnected,
  };
})();
