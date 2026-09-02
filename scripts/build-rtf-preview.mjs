#!/usr/bin/env node
// Builds test/notes-with-images-preview.rtf — dummy export doc for layout review.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function escapeRtf(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\\par\n")
    .replace(/[^\x00-\x7F]/g, (ch) => `\\u${ch.charCodeAt(0)}?`);
}

function bytesToRtfPicture(bytes) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const blip = isPng ? "\\pngblip" : "\\jpegblip";
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `{\\pict${blip}\\picwgoal5000\\pichgoal3500\n${hex}\n}\\par`;
}

const entries = [
  {
    type: "image",
    selector: "img.hero__background",
    dims: "1440x900",
    imageFile: "image-hero__background-1440x900-a1b2c3.jpg",
    note: "Soft gradient hero - reference for our onboarding splash. Pay attention to the corner radius on the inner card.",
    imagePath: "reference-images/05-insurance-summary-card.png",
  },
  {
    type: "image",
    selector: "header nav img.logo",
    dims: "320x80",
    imageFile: "image-nav-logo-320x80-d4e5f6.png",
    note: "Logo lockup spacing - 24px gap to nav links.",
    imagePath: "reference-images/04-dashboard-bento-cards.png",
  },
  {
    type: "component",
    selector: "div.pricing-card.pricing-card--featured",
    dims: "380x520",
    imageFile: "component-pricing-card-380x520-g7h8i9.jpg",
    htmlFile: "component-pricing-card-380x520-g7h8i9.html",
    note: "Stacked card pattern for the comparison view.\nShadow is subtle - not Material default.\nCheck the offset between layers (~8px).",
    imagePath: "reference-images/03-stacked-account-cards.png",
  },
  {
    type: "image",
    selector: "section.testimonials img.avatar",
    dims: "96x96",
    imageFile: "image-avatar-96x96-m3n4o5.jpg",
    note: "Circular avatar crop - 48px displayed, 2x asset.",
    imagePath: "reference-images/09-email-compose-modal.png",
  },
  {
    type: "component",
    selector: "button.cta-primary",
    dims: "160x48",
    imageFile: "component-cta-primary-160x48-j0k1l2.jpg",
    htmlFile: "component-cta-primary-160x48-j0k1l2.html",
    note: "Primary CTA - navy fill, 8px radius, no icon.",
    imagePath: "reference-images/06-invite-confirmation-modal.png",
  },
  {
    type: "image",
    selector: "img.product-shot",
    dims: "800x600",
    imageFile: "image-product-shot-800x600-p6q7r8.jpg",
    note: "Product screenshot for deck slide 4.",
    imagePath: "reference-images/07-portfolio-scrapbook-site.png",
  },
];

let rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Helvetica;}}\\f0\\fs22\n";
rtf += "\\b ACOPIO - Images and components with notes (PREVIEW)\\b0\\par\n";
rtf += `${entries.length} annotated items\\par\\par\n`;
rtf += "DUMMY EXPORT - This is what notes-with-images.rtf looks like inside a ZIP.\\par\n";
rtf += "Each image below is embedded with its note. The same image files also exist individually in the folder.\\par\\par\n";
rtf += "\\line\\par\\par\n";

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  const num = String(i + 1).padStart(2, "0");
  const typeLabel = e.type === "image" ? "IMAGE" : "COMPONENT";
  rtf += `\\b ${num}  ${typeLabel}\\b0\\par\n`;
  if (e.selector) rtf += `${escapeRtf(e.selector)}\\par\n`;
  const meta = [e.dims, e.imageFile, e.htmlFile].filter(Boolean).join(" | ");
  if (meta) rtf += `${escapeRtf(meta)}\\par\n`;
  rtf += "\\par\n";

  const imgPath = path.join(root, e.imagePath);
  if (fs.existsSync(imgPath)) {
    const bytes = fs.readFileSync(imgPath);
    rtf += `${bytesToRtfPicture(bytes)}\\par\n`;
  }

  rtf += "\\par\\b YOUR NOTE\\b0\\par\n";
  rtf += `${escapeRtf(e.note)}\\par\\par\n`;
  rtf += "\\line\\par\\par\n";
}

rtf += "\\par\\fs18 Dummy preview - Acopio — Gather. Connect. Simplify\\par\n";
rtf += "}";

const out = path.join(root, "test", "notes-with-images-preview.rtf");
fs.writeFileSync(out, rtf);
console.log("Wrote", out);
