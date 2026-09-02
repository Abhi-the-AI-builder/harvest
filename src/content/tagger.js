// Section 6 — deterministic auto-tagging. No AI/heuristic ML, just DOM +
// computed-style rules, evaluated in the documented priority order.
(function () {
  const Acopio = window.Acopio;

  function hasMeaningfulText(el) {
    const text = (el.textContent || "").trim();
    return text.length > 0;
  }

  // Text carried directly by this element (its own text nodes), not text
  // that merely exists somewhere in its subtree — a hero banner div with a
  // background-image AND an overlaid heading as a CHILD element has plenty
  // of textContent, but none of it is the banner's own; it's still
  // fundamentally an image container with something layered on top of it.
  function hasDirectText(el) {
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    );
  }

  function hasUrlBackgroundImage(style) {
    const bgImage = style.backgroundImage;
    return Boolean(bgImage && bgImage !== "none" && /url\(/i.test(bgImage));
  }

  function isVisuallyDominantBackground(el, style) {
    // A real background-image (an actual photo) is the meaningful content
    // here, not the element's `background-color` — which is very often
    // just a fallback/placeholder color sitting behind the photo while it
    // loads, and reporting THAT as "the color" when a photo is clearly the
    // visible thing is wrong. So a url()-based background-image always
    // routes to the image rule (below) instead, even if a solid
    // background-color is technically also set. Pure color fills and
    // gradients (no photo) still count as "color" here.
    if (hasUrlBackgroundImage(style)) return false;
    const bg = style.backgroundColor;
    const bgImage = style.backgroundImage;
    const isGradient = Boolean(bgImage && bgImage.includes("gradient"));
    const hasSolidOrGradientBg =
      (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || isGradient;
    if (!hasSolidOrGradientBg) return false;
    // A gradient specifically (a flat solid color has no such ambiguity)
    // wrapping a real photo is almost always a decorative tint or loading
    // placeholder over that photo, not genuine flat-color content of its
    // own — see Acopio.findRealMediaChild.
    if (isGradient && Acopio.findRealMediaChild(el)) return false;
    return true;
  }

  function looksLikeButton(el, style) {
    // "Button" is a type:"font" capture — it exists for a text label
    // ("Sign up", "Learn more"), not for the element structurally. A real
    // <button>/<a> with no visible text of its own is usually a "make this
    // whole card clickable" wrapper around photos (a bento-grid tile, a
    // product card) — unconditionally winning here meant hovering one of
    // those showed meaningless inherited font CSS (sohne-var, 16px, no
    // actual text) instead of ever reaching the Image/Component checks
    // below to describe what's actually inside it.
    if (!hasMeaningfulText(el)) return false;
    // A <button>/role=button wrapping a large embedded widget (an entire
    // interactive demo, a bento-grid card with its own nested form/copy) is
    // still a "make this whole thing clickable" wrapper, not a text
    // control — it just isn't EMPTY the way a bare photo-wrapper is, so
    // the check above alone doesn't catch it. Its "text" is dozens of
    // unrelated nested strings deep inside the widget, not a label. A real
    // button/link almost never has more than a handful of descendants
    // (an icon + a span, maybe a small badge) even when its label is long.
    if (el.querySelectorAll("*").length > 20) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return true;
    if (el.getAttribute("role") === "button") return true;
    if (tag === "a") {
      const paddingSum =
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      const hasBg = style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)";
      const hasRadius = parseFloat(style.borderRadius) > 0;
      return paddingSum > 12 && hasBg && hasRadius;
    }
    return false;
  }

  function isImageish(el) {
    const tag = el.tagName.toLowerCase();
    // <video> included specifically for GIF capture — many sites now
    // serve "animated GIFs" as an autoplay/muted/loop <video> instead of a
    // real .gif file (much smaller payload), so a hover-capture tool that
    // only recognized <img> would silently miss the most common real-world
    // shape of exactly the content a user asking for "collect GIFs" means.
    // "image" (lowercase, no relation to HTML's <img>) is SVG's own leaf
    // element for embedding a picture inside an <svg> — common in
    // illustration-style vector graphics (isometric diagrams, icon sets
    // built as one <svg> with several <image> children). It's a genuine
    // leaf with zero children by design (its content comes from an href
    // attribute, not child nodes), so hovering it directly used to fall
    // through every check here and land on "Component... Empty — no
    // elements inside" despite very much containing a real picture.
    if (tag === "img" || tag === "picture" || tag === "svg" || tag === "video" || tag === "image") return true;
    const style = window.getComputedStyle(el);
    const bgImage = style.backgroundImage;
    // Requires an actual url() — bgImage !== "none" alone is also true for
    // a pure linear-gradient() with no photo at all, which used to get
    // misclassified as "image" (a gradient-only decorative banner div
    // wrapping a heading in a child, no direct text of its own): the
    // tooltip would then show "Image NxNpx" with no thumbnail, since
    // there's no url() for the preview to extract. A gradient with no
    // photo genuinely isn't image content.
    if (bgImage && bgImage !== "none" && /url\(/i.test(bgImage) && !hasDirectText(el)) {
      // Meaningful-content background image (hero banner, product photo),
      // as opposed to a flat color swatch already handled by rule 1.
      return true;
    }
    // No background photo of its own, but wraps exactly one real photo —
    // a decorated/tinted wrapper around the actual content, not something
    // that should lose to a more generic classification.
    if (Acopio.findRealMediaChild(el)) return true;
    return false;
  }

  /**
   * Returns { type, family } per the Section 6 priority order. `type` is
   * one of color|font|image|component. `family` is one of
   * heading|body|button|color|image|other.
   */
  Acopio.detectTag = function detectTag(el) {
    const style = window.getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    // 1. Dominant background, no meaningful text -> color
    if (!hasMeaningfulText(el) && isVisuallyDominantBackground(el, style)) {
      return { type: "color", family: "color" };
    }

    // 2. Heading
    if (/^h[1-6]$/.test(tag)) {
      return { type: "font", family: "heading" };
    }

    // 4. Button (checked before generic text so a short-text button wins)
    if (looksLikeButton(el, style)) {
      return { type: "font", family: "button" };
    }

    // 3. Body text
    if (
      ["p", "span", "li"].includes(tag) ||
      (hasMeaningfulText(el) && !/^h[1-6]$/.test(tag))
    ) {
      // Only treat as body text if this element itself carries the text
      // directly (not just because a huge subtree happens to contain some) —
      // a reasonable proxy: it has some direct text node children, or it's
      // one of the classic inline/text tags.
      const hasDirectText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (hasDirectText || ["p", "span", "li"].includes(tag)) {
        return { type: "font", family: "body" };
      }
    }

    // 5. Image
    if (isImageish(el)) {
      return { type: "image", family: "image" };
    }

    // 6. Fallback: container with children -> component
    if (el.children.length > 0) {
      return { type: "component", family: "other" };
    }

    // Nothing matched (e.g. an empty leaf with no bg, no text) — still
    // capturable as a component so the user's click never silently no-ops.
    return { type: "component", family: "other" };
  };

  Acopio.FAMILY_OPTIONS = ["heading", "body", "button", "color", "image", "other"];
})();
