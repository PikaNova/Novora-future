import { createServer } from "node:http";
import { handleApiRequest } from "./routes.js";
import { serveStatic } from "./static.js";

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

const requestStats = { windowStart: Date.now(), total: 0, failed: 0 };
(globalThis as Record<string, unknown>).__NOVORA_LOCAL_REQ_STATS__ = requestStats;

const server = createServer(async (req, res) => {
  if (Date.now() - requestStats.windowStart > 5 * 60_000) {
    requestStats.windowStart = Date.now();
    requestStats.total = 0;
    requestStats.failed = 0;
  }
  requestStats.total += 1;
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  try {
    if (pathname.startsWith("/api/")) {
      const handled = await handleApiRequest(req, res, pathname);
      if (!handled) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "not_found" }));
      }
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "internal_error",
        }),
      );
    } else {
      res.end();
    }
    requestStats.failed += 1;
    return;
  }
  if (res.statusCode >= 400) requestStats.failed += 1;
});

server.listen(port, host, () => {
  console.log(`Novora local server listening on http://${host}:${port}`);
});
