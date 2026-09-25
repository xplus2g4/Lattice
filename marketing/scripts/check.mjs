import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import vm from "node:vm";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const html = await readFile(path.join(root, "index.html"), "utf8");
assert(!html.includes("{{"), "Unresolved build variables");
assert.equal(
  (html.match(/<h1[ >]/g) || []).length,
  1,
  "Exactly one primary heading",
);
const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
assert(
  canonical.startsWith("https://") && canonical.endsWith("/"),
  "Absolute HTTPS canonical URL",
);
const ogImage = html.match(/property="og:image" content="([^"]+)"/)[1];
assert.equal(
  ogImage,
  `${canonical}assets/social-preview.png`,
  "OG image follows deployment base path",
);
assert(html.includes(`property="og:url" content="${canonical}"`));
for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
  const value = match[1];
  if (/^(https?:|data:)/.test(value)) continue;
  assert(
    !value.startsWith("/"),
    `Asset ${value} would break project-path hosting`,
  );
  await access(path.join(root, value));
}
for (const match of html.matchAll(/href="#([^"]+)"/g))
  assert(html.includes(`id="${match[1]}"`), `Missing anchor ${match[1]}`);
const jsonld = JSON.parse(
  html.match(/type="application\/ld\+json">(.*?)<\/script>/s)[1],
);
assert.equal(jsonld.url, canonical);
assert.equal(jsonld["@type"], "WebSite");
const og = await sharp(path.join(root, "assets/social-preview.png")).metadata();
const story = await sharp(
  path.join(root, "assets/instagram-story.png"),
).metadata();
assert.deepEqual([og.width, og.height], [1200, 630]);
assert.deepEqual([story.width, story.height], [1080, 1920]);
new vm.Script(await readFile(path.join(root, "site.js"), "utf8"));
const css = await readFile(path.join(root, "styles.css"), "utf8");
const fontPaths = [...css.matchAll(/url\(["']([^"']+)["']\)/g)];
assert.equal(
  fontPaths.length,
  3,
  "All three self-hosted font faces are checked",
);
for (const match of fontPaths) await access(path.join(root, match[1]));
assert(
  (await readFile(path.join(root, "sitemap.xml"), "utf8")).includes(canonical),
);
assert(
  (await readFile(path.join(root, "robots.txt"), "utf8")).includes(
    `${canonical}sitemap.xml`,
  ),
);
console.log(
  "Passed: deployment paths, linked assets, anchors, metadata, structured data, image dimensions, font assets, and JavaScript syntax.",
);
