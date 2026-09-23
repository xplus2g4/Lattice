import { readFile, writeFile, mkdir, cp, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import * as fontkit from "fontkit";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const configuredUrl =
  process.env.SITE_URL || "https://xplus2g4.github.io/Lattice/";
const url = new URL(configuredUrl);
if (
  url.protocol !== "https:" ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
) {
  throw new Error(
    "SITE_URL must be an HTTPS website URL without credentials, a query, or a fragment.",
  );
}
url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
const siteUrl = url.href;
const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
await mkdir(path.join(output, "assets"), { recursive: true });
await cp(path.join(root, "src"), output, { recursive: true });
const template = await readFile(path.join(root, "src/index.html"), "utf8");
await writeFile(
  path.join(output, "index.html"),
  template
    .replaceAll("{{SITE_URL}}", escapeXml(siteUrl))
    .replaceAll("{{ENCODED_SITE_URL}}", encodeURIComponent(siteUrl))
    .replaceAll("{{YEAR}}", String(new Date().getUTCFullYear())),
);

const fontRoot = path.join(root, "node_modules/@fontsource/figtree");
for (const weight of [400, 600, 700]) {
  const filename = `figtree-latin-${weight}-normal.woff2`;
  await copyFile(
    path.join(fontRoot, "files", filename),
    path.join(output, "assets", filename),
  );
}
await copyFile(
  path.join(fontRoot, "LICENSE"),
  path.join(output, "assets", "figtree-LICENSE.txt"),
);
const font = fontkit.openSync(
  path.join(fontRoot, "files/figtree-latin-600-normal.woff"),
);
const regular = fontkit.openSync(
  path.join(fontRoot, "files/figtree-latin-400-normal.woff"),
);
// Outline glyphs so social cards render identically on Windows and GitHub's Linux runner.
function text(value, x, y, size, color = "#032823", weight = 600) {
  const face = weight === 400 ? regular : font;
  const scale = size / face.unitsPerEm;
  const run = face.layout(value);
  let cursor = 0;
  let result = "";
  run.glyphs.forEach((glyph, i) => {
    const position = run.positions[i];
    result += `<path d="${glyph.path.toSVG()}" transform="translate(${x + (cursor + position.xOffset) * scale} ${y - position.yOffset * scale}) scale(${scale} ${-scale})" fill="${color}"/>`;
    cursor += position.xAdvance;
  });
  return result;
}
const wordmark = (
  await readFile(path.join(root, "src/assets/wordmark.png"))
).toString("base64");
function mapNode(x, y, label, state, fill = "#fff") {
  return `<rect x="${x}" y="${y}" width="282" height="98" rx="12" fill="${fill}" stroke="#b2cec0" stroke-width="2"/>
    <circle cx="${x + 28}" cy="${y + 32}" r="7" fill="#008b77"/>
    ${text(label, x + 48, y + 39, 21)}${text(state, x + 23, y + 72, 15, "#586e6a", 400)}`;
}
const grid =
  '<defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="#c1d7cb"/></pattern></defs>';
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${grid}
  <rect width="1200" height="630" fill="#fff"/><rect x="650" width="550" height="630" fill="#eaf2ee"/><rect x="650" width="550" height="630" fill="url(#dots)"/>
  <image href="data:image/png;base64,${wordmark}" x="63" y="47" width="190" height="49"/>
  ${text("See how", 64, 230, 77)}${text("it all connects.", 64, 319, 77, "#087c6b")}
  ${text("Course-grounded AI learning.", 68, 393, 25, "#586e6a", 400)}
  ${text("Designed for NUS students.", 68, 431, 25, "#586e6a", 400)}
  <rect x="67" y="507" width="234" height="45" rx="23" fill="#00d5be"/>${text("Explore the idea", 96, 537, 21)}
  <path d="M879 188 C879 250 982 230 982 302 S886 380 886 449" fill="none" stroke="#5c9e86" stroke-width="3"/>
  ${mapNode(743, 100, "Make connections", "Course materials, mapped")}
  ${mapNode(837, 270, "Find your next step", "Prerequisites, made clearer", "#f3fffb")}
  ${mapNode(740, 441, "Keep learning", "Revision, with direction")}
  ${text("PRODUCT VISION", 983, 599, 12, "#586e6a")}
</svg>`;
const story = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${grid}
  <rect width="1080" height="1920" fill="#f8faf9"/><rect y="840" width="1080" height="740" fill="#eaf2ee"/><rect y="840" width="1080" height="740" fill="url(#dots)"/>
  <image href="data:image/png;base64,${wordmark}" x="80" y="175" width="270" height="69"/>
  ${text("YOUR COURSE. CONNECTED.", 82, 342, 23, "#586e6a")}
  ${text("See how", 75, 478, 115)}${text("it all", 75, 609, 115)}${text("connects.", 75, 740, 115, "#087c6b")}
  <path d="M340 980 C340 1100 752 1080 752 1180 S450 1370 450 1450" fill="none" stroke="#4d937c" stroke-width="4"/>
  <g transform="translate(-100 -420) scale(1.4)">${mapNode(135, 966, "Connect concepts", "See the bigger picture")}${mapNode(415, 1120, "Build understanding", "Find the missing link", "#f3fffb")}${mapNode(205, 1260, "Keep moving forward", "A personal revision path")}</g>
  ${text("Course-grounded AI learning.", 80, 1650, 34)}
  ${text("Designed for NUS students. In development.", 80, 1710, 24, "#586e6a", 400)}
  ${text(url.host + url.pathname, 80, 1780, 24, "#087c6b")}
</svg>`;
await Promise.all([
  sharp(Buffer.from(og))
    .png()
    .toFile(path.join(output, "assets/social-preview.png")),
  sharp(Buffer.from(story))
    .png()
    .toFile(path.join(output, "assets/instagram-story.png")),
]);
await writeFile(
  path.join(output, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`,
);
await writeFile(
  path.join(output, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeXml(siteUrl)}</loc></url></urlset>\n`,
);
await writeFile(path.join(output, ".nojekyll"), "");
await writeFile(
  path.join(output, "404.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — Lattice</title><style>body{font:18px system-ui;color:#032823;margin:15vh auto;padding:30px;max-width:600px}a{color:#006b5b}</style><h1>This connection is missing.</h1><p>The page you are looking for is not here.</p><a href="${escapeXml(url.pathname)}">Return to Lattice →</a></html>`,
);
console.log(
  `Built marketing/dist for ${siteUrl} with 1200×630 OG and 1080×1920 Story images.`,
);
