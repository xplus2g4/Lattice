import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const base =
  new URL(
    process.env.SITE_URL || "https://xplus2g4.github.io/Lattice/",
  ).pathname.replace(/\/+$/, "") + "/";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};
createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname === base.slice(0, -1)) {
      response.writeHead(302, { Location: base });
      response.end();
      return;
    }
    if (pathname.startsWith(base)) pathname = pathname.slice(base.length);
    const target = path.resolve(root, "." + "/" + pathname.replace(/^\/+/, ""));
    if (
      target !== path.resolve(root) &&
      !target.startsWith(path.resolve(root) + path.sep)
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    const file = (await stat(target)).isDirectory()
      ? path.join(target, "index.html")
      : target;
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await readFile(path.join(root, "404.html")));
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Preview: http://127.0.0.1:${port}${base}`),
);
