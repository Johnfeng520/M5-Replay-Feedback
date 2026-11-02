import type { FastifyInstance } from "fastify";
import { readFile, realpath } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

// Only compiled frontend files are public. Runtime databases, source and .env are never served.
export function registerStatic(
  app: FastifyInstance,
  root = resolve(import.meta.dirname, "../../../web/dist"),
) {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  app.setNotFoundHandler(async (req, reply) => {
    if (
      ["GET", "HEAD"].includes(req.method) &&
      !req.url.split("?")[0].startsWith("/api/")
    ) {
      let pathname: string;
      try {
        pathname = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        pathname = "";
      }
      if (
        pathname &&
        !pathname.includes("\\") &&
        !pathname.split("/").some((p) => p === ".." || p.startsWith("."))
      ) {
        const file = resolve(
          root,
          pathname === "/" ? "index.html" : "." + pathname,
        );
        const actual = await realpath(file).catch(() => null),
          actualRoot = await realpath(root).catch(() => null);
        if (actual && actualRoot && actual.startsWith(actualRoot + sep)) {
          const data = await readFile(actual).catch(() => null);
          if (data)
            return reply
              .header("X-Content-Type-Options", "nosniff")
              .header(
                "Cache-Control",
                extname(actual) === ".html"
                  ? "no-cache"
                  : "public, max-age=3600",
              )
              .type(mime[extname(actual)] ?? "application/octet-stream")
              .send(data);
        }
      }
    }
    return reply
      .code(404)
      .send({
        error: {
          code: "NOT_IMPLEMENTED_OR_NOT_FOUND",
          message: "页面或接口不存在",
          requestId: req.id,
        },
      });
  });
}
