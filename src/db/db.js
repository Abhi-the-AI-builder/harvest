// Shared IndexedDB module — Section 5 data model, Section 8 schema
// migration requirement. Runs in extension-origin contexts only
// (background service worker, side panel) so every context that imports
// this file sees the SAME database — see PLAN.md assumption #2 for why
// content scripts never touch this directly.
//
// Plain script (importScripts-compatible from the service worker, and
// loadable via a normal <script> tag from the side panel) — no bundler.
(function (global) {
  const DB_NAME = "harvest-db";
  const CURRENT_SCHEMA_VERSION = 1;
  const ITEMS_STORE = "items";
  const COLLECTIONS_STORE = "collections";
  const META_STORE = "meta";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, CURRENT_SCHEMA_VERSION);

      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;

        if (oldVersion < 1) {
          const items = db.createObjectStore(ITEMS_STORE, { keyPath: "id" });
          items.createIndex("hostname", "hostname", { unique: false });
          items.createIndex("type", "type", { unique: false });
          items.createIndex("family", "family", { unique: false });
          items.createIndex("capturedAt", "capturedAt", { unique: false });

          db.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }

        // Future migrations: `if (oldVersion < 2) { ... }` — never assume
        // old records match the new shape; each block here is responsible
        // for bringing existing rows forward, not just changing new writes.
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then((db) => db.transaction(storeNames, mode));
  }

  function promisifyRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function refKey(ref) {
    return `${ref.folderHostname}|${ref.itemId}`;
  }

  function stamp(record) {
    if (record && typeof record === "object") {
      record.updatedAt = new Date().toISOString();
    }
  }

  function notifyCloud() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "CLOUD_NOTIFY" }).catch(() => {});
      }
    } catch (_) {
      /* tests / plain pages — no extension runtime */
    }
  }

  async function readTombstones(store) {
    const row = await promisifyRequest(store.get("cloudTombstones"));
    return row && Array.isArray(row.entries) ? row.entries : [];
  }

  async function writeTombstones(store, entries) {
    await promisifyRequest(store.put({ key: "cloudTombstones", entries }));
  }

  function hexDistance(hexA, hexB) {
    if (!hexA || !hexB) return Infinity;
    const clean = (h) => h.replace("#", "").padStart(6, "0");
    const a = parseInt(clean(hexA), 16);
    const b = parseInt(clean(hexB), 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
  }

  const HarvestDB = {
    /**
     * Adds one item. `item` must already be capture-time sanitized; this
     * function performs the second sanitization pass (Section 9 layer 2)
     * before the write, using the same sanitize.js rules re-applied to the
     * plain-object html field (belt-and-suspenders: even if the content
     * script's sanitization had a bug, this is an independent re-check).
     */
    async addItem(item) {
      if (!item.id) throw new Error("item.id is required");
      if (!item.hostname) throw new Error("item.hostname is required");
      if (!item.updatedAt) stamp(item);
      const t = await tx([ITEMS_STORE], "readwrite");
      const store = t.objectStore(ITEMS_STORE);
      await promisifyRequest(store.add(item));
      notifyCloud();
      return item;
    },

    async getItemsByHostname(hostname) {
      const t = await tx([ITEMS_STORE], "readonly");
      const idx = t.objectStore(ITEMS_STORE).index("hostname");
      return promisifyRequest(idx.getAll(hostname));
    },

    async getAllItems() {
      const t = await tx([ITEMS_STORE], "readonly");
      return promisifyRequest(t.objectStore(ITEMS_STORE).getAll());
    },

    async getItem(id) {
      const t = await tx([ITEMS_STORE], "readonly");
      return promisifyRequest(t.objectStore(ITEMS_STORE).get(id));
    },

    async updateItemNote(id, note) {
      const t = await tx([ITEMS_STORE], "readwrite");
      const store = t.objectStore(ITEMS_STORE);
      const item = await promisifyRequest(store.get(id));
      if (!item) return null;
      item.note = note;
      stamp(item);
      await promisifyRequest(store.put(item));
      notifyCloud();
      return item;
    },

    // Predefined-tag toggles on a note (sidepanel.js's NOTE_TAGS picker) —
    // same read/mutate/put shape as updateItemNote above, just a different
    // field. Lives on item.data (not a top-level field) since tags are
    // note-specific, the same place color/text/links already live.
    async updateItemTags(id, tags) {
      const t = await tx([ITEMS_STORE], "readwrite");
      const store = t.objectStore(ITEMS_STORE);
      const item = await promisifyRequest(store.get(id));
      if (!item) return null;
      item.data = item.data || {};
      item.data.tags = tags;
      stamp(item);
      await promisifyRequest(store.put(item));
      notifyCloud();
      return item;
    },

    // In-note marker highlights (sidepanel.js's select-text-in-a-note-tile
    // flow) — stored as [{start, end}] character offsets into
    // item.data.text, same read/mutate/put shape as the two above.
    // Offsets, not a copy of the highlighted substring, so the highlight
    // stays correct even if it's re-rendered against edited text later.
    async updateItemHighlights(id, highlights) {
      const t = await tx([ITEMS_STORE], "readwrite");
      const store = t.objectStore(ITEMS_STORE);
      const item = await promisifyRequest(store.get(id));
      if (!item) return null;
      item.data = item.data || {};
      item.data.highlights = highlights;
      stamp(item);
      await promisifyRequest(store.put(item));
      notifyCloud();
      return item;
    },

    // Best-effort correction for image items: at capture time, width/height
    // come from whatever <img> the page currently has rendered — often a
    // downsized grid thumbnail, even when data.url itself was already
    // upgraded (upgradeImageUrl, shared.js) to the full-resolution file.
    // Called once the tooltip's own preview image finishes loading and
    // reports its real naturalWidth/Height, so a Library card doesn't keep
    // showing a smaller number than the file it's actually pointing at.
    async updateItemDimensions(id, width, height) {
      const t = await tx([ITEMS_STORE], "readwrite");
      const store = t.objectStore(ITEMS_STORE);
      const item = await promisifyRequest(store.get(id));
      if (!item || item.type !== "image" || !item.data) return null;
      item.data.width = width;
      item.data.height = height;
      stamp(item);
      await promisifyRequest(store.put(item));
      notifyCloud();
      return item;
    },

    // Only caller today is background.js's post-capture response for the
    // hover-capture tooltip's session-capture stack — a separate system
    // from notes (src/content/notes.js), so a note saved on this same
    // hostname must never inflate this count.
    async countByHostname(hostname) {
      const items = await this.getItemsByHostname(hostname);
      return items.filter((item) => item.type !== "note").length;
    },

    /**
     * Deletes one item and scrubs it from every Collection referencing it
     * (Section 8: "deleting an item must also remove it from every
     * Collection referencing it"). Returns `{ item, affectedCollections }`
     * — the full removed item plus which collections it was pulled from —
     * specifically so the undo toast can (a) say how many collections are
     * affected and (b) actually restore both the item and its membership
     * if the user clicks undo. Returns null if the item didn't exist.
     */
    async deleteItem(id) {
      const t = await tx([ITEMS_STORE, COLLECTIONS_STORE, META_STORE], "readwrite");
      const itemsStore = t.objectStore(ITEMS_STORE);
      const collectionsStore = t.objectStore(COLLECTIONS_STORE);

      const item = await promisifyRequest(itemsStore.get(id));
      if (!item) return null;
      await promisifyRequest(itemsStore.delete(id));

      const metaStore = t.objectStore(META_STORE);
      const tombstones = await readTombstones(metaStore);
      const next = tombstones.filter((e) => !(e.kind === "item" && e.id === id));
      next.push({ kind: "item", id, deletedAt: new Date().toISOString() });
      await writeTombstones(metaStore, next);

      const allCollections = await promisifyRequest(collectionsStore.getAll());
      const affectedCollections = [];
      for (const col of allCollections) {
        const before = col.itemRefs.length;
        col.itemRefs = col.itemRefs.filter(
          (ref) => !(ref.folderHostname === item.hostname && ref.itemId === id)
        );
        if (col.itemRefs.length !== before) {
          affectedCollections.push({ id: col.id, name: col.name });
          col.lastUpdatedAt = new Date().toISOString();
          await promisifyRequest(collectionsStore.put(col));
        }
      }
      notifyCloud();
      return { item, affectedCollections };
    },

    /** Undo for deleteItem — puts the item back AND restores its membership in every collection it was removed from. */
    async restoreItem(item, affectedCollectionIds) {
      const t = await tx([ITEMS_STORE, COLLECTIONS_STORE, META_STORE], "readwrite");
      const itemsStore = t.objectStore(ITEMS_STORE);
      stamp(item);
      await promisifyRequest(itemsStore.put(item));

      const metaStore = t.objectStore(META_STORE);
      const tombstones = await readTombstones(metaStore);
      await writeTombstones(
        metaStore,
        tombstones.filter((e) => !(e.kind === "item" && e.id === item.id))
      );

      const collectionsStore = t.objectStore(COLLECTIONS_STORE);
      for (const colId of affectedCollectionIds || []) {
        const col = await promisifyRequest(collectionsStore.get(colId));
        if (!col) continue; // the collection itself may have since been deleted — nothing to restore into
        col.itemRefs.push({ folderHostname: item.hostname, itemId: item.id });
        col.lastUpdatedAt = new Date().toISOString();
        await promisifyRequest(collectionsStore.put(col));
      }
    },

    /**
     * Deletes every item for a hostname (folder delete). Underlying items
     * are gone, not just unlinked — this is the destructive one Section 8
     * says needs confirmation + undo support. Returns the per-item delete
     * results (same shape as deleteItem) so the whole folder can be
     * restored via restoreFolder if the user clicks undo.
     */
    async deleteFolder(hostname) {
      const items = await this.getItemsByHostname(hostname);
      const results = [];
      for (const item of items) {
        const r = await this.deleteItem(item.id);
        if (r) results.push(r);
      }
      return results;
    },

    async restoreFolder(deleteResults) {
      for (const r of deleteResults) {
        await this.restoreItem(r.item, r.affectedCollections.map((c) => c.id));
      }
    },

    /**
     * Near-duplicate check (Section 8): "two near-identical colors or
     * fonts captured from the same site" — plus component/image, extended
     * on request so the same "you've already got this" signal shows while
     * just hovering, not only after you click Collect, open the panel, and
     * go looking. Color/font use a real similarity metric (hex distance,
     * family+weight+size); component/image don't have an equivalent cheap
     * structural-similarity metric, so they use an exact selector match
     * instead — "you already captured this exact element" is a narrower
     * but still genuinely useful signal, not a false-positive-prone guess
     * at "structurally similar."
     */
    async findSimilarItem(hostname, type, data, selector) {
      const items = await this.getItemsByHostname(hostname);
      if (type === "color") {
        return items.find((it) => it.type === "color" && hexDistance(it.data.hex, data.hex) < 20) || null;
      }
      if (type === "font") {
        return (
          items.find(
            (it) =>
              it.type === "font" &&
              it.data.family === data.family &&
              it.data.weight === data.weight &&
              Math.abs((it.data.sizePx || 0) - (data.sizePx || 0)) < 1
          ) || null
        );
      }
      if (type === "component" && selector) {
        return items.find((it) => it.type === "component" && it.selector === selector) || null;
      }
      if (type === "image" && data && data.url) {
        return items.find((it) => it.type === "image" && it.data && it.data.url === data.url) || null;
      }
      if (type === "note" && data && data.text) {
        // Exact-text match within the same hostname — the same "you
        // already captured this exact thing" signal component/image use,
        // not a fuzzy similarity metric (selected text has no cheap
        // structural comparison the way color/font do).
        return items.find((it) => it.type === "note" && it.data && it.data.text === data.text) || null;
      }
      return null;
    },

    // --- Collections (Section 5/7G) ---------------------------------
    // Collections store itemRefs only, never a copy of the item — always
    // resolved live against the origin item at render time (see
    // resolveCollectionItems) so an edited note/data stays accurate
    // automatically without any cache-invalidation bookkeeping.

    async createCollection(name) {
      const now = new Date().toISOString();
      const collection = { id: newId(), name, createdAt: now, lastUpdatedAt: now, itemRefs: [] };
      const t = await tx([COLLECTIONS_STORE], "readwrite");
      await promisifyRequest(t.objectStore(COLLECTIONS_STORE).add(collection));
      return collection;
    },

    async getAllCollections() {
      const t = await tx([COLLECTIONS_STORE], "readonly");
      return promisifyRequest(t.objectStore(COLLECTIONS_STORE).getAll());
    },

    async getCollection(id) {
      const t = await tx([COLLECTIONS_STORE], "readonly");
      return promisifyRequest(t.objectStore(COLLECTIONS_STORE).get(id));
    },

    async renameCollection(id, name) {
      const t = await tx([COLLECTIONS_STORE], "readwrite");
      const store = t.objectStore(COLLECTIONS_STORE);
      const col = await promisifyRequest(store.get(id));
      if (!col) return null;
      col.name = name;
      col.lastUpdatedAt = new Date().toISOString();
      await promisifyRequest(store.put(col));
      return col;
    },

    /** Grouping-only delete — the underlying items are never touched (Section 7G/8). */
    async deleteCollection(id) {
      const t = await tx([COLLECTIONS_STORE], "readwrite");
      await promisifyRequest(t.objectStore(COLLECTIONS_STORE).delete(id));
    },

    async addItemsToCollection(collectionId, itemRefs) {
      const t = await tx([COLLECTIONS_STORE], "readwrite");
      const store = t.objectStore(COLLECTIONS_STORE);
      const col = await promisifyRequest(store.get(collectionId));
      if (!col) return null;
      const existing = new Set(col.itemRefs.map(refKey));
      for (const ref of itemRefs) {
        if (!existing.has(refKey(ref))) {
          col.itemRefs.push(ref);
          existing.add(refKey(ref));
        }
      }
      col.lastUpdatedAt = new Date().toISOString();
      await promisifyRequest(store.put(col));
      return col;
    },

    async removeItemsFromCollection(collectionId, itemRefs) {
      const t = await tx([COLLECTIONS_STORE], "readwrite");
      const store = t.objectStore(COLLECTIONS_STORE);
      const col = await promisifyRequest(store.get(collectionId));
      if (!col) return null;
      const toRemove = new Set(itemRefs.map(refKey));
      col.itemRefs = col.itemRefs.filter((ref) => !toRemove.has(refKey(ref)));
      col.lastUpdatedAt = new Date().toISOString();
      await promisifyRequest(store.put(col));
      return col;
    },

    /** Resolves each itemRef against the live item — never a stale cached copy (Section 5). */
    async resolveCollectionItems(collection) {
      const t = await tx([ITEMS_STORE], "readonly");
      const store = t.objectStore(ITEMS_STORE);
      const items = [];
      for (const ref of collection.itemRefs) {
        const item = await promisifyRequest(store.get(ref.itemId));
        if (item) items.push(item); // silently skip refs whose item was deleted through some other path
      }
      return items;
    },

    /** Which collections (id + name) currently reference this item — used for the delete-confirmation "also removes it from N collections" messaging. */
    async collectionsContainingItem(hostname, itemId) {
      const all = await this.getAllCollections();
      return all.filter((col) => col.itemRefs.some((ref) => ref.folderHostname === hostname && ref.itemId === itemId));
    },

    STORE_NAMES: { ITEMS_STORE, COLLECTIONS_STORE, META_STORE },
    SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
  };

  global.HarvestDB = HarvestDB;
})(typeof self !== "undefined" ? self : window);
