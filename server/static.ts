import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = path.resolve(__dirname, "../../dist");

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function applySecurityHeaders(res: ServerResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
}

function resolveSafePath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const filePath = path.resolve(DIST_DIR, "." + decoded);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
    return null;
  }
  return filePath;
}

export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): void {
  applySecurityHeaders(res);

  if (pathname.startsWith("/api/")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }

  const requestPath =
    pathname === "/" || pathname === "" ? "/index.html" : pathname;

  if (requestPath === "/service-worker.js" || requestPath === "/manifest.webmanifest") {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  } else if (requestPath.startsWith("/assets/") || requestPath.startsWith("/fonts/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }

  const safePath = resolveSafePath(requestPath);
  const candidate =
    safePath && existsSync(safePath) && statSync(safePath).isFile()
      ? safePath
      : null;

  const filePath = candidate ?? path.join(DIST_DIR, "index.html");
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    res.statusCode = 404;
    res.end("Not Found");
  });
  stream.pipe(res);
}
