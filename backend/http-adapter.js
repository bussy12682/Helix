import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

/**
 * Adapts the fetch-style app (Request -> Response) to Node's http server, streaming response bodies.
 */
export function createNodeHandler(appInstance) {
  return async (req, res) => {
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const hasBody = req.method !== "GET" && req.method !== "HEAD";

      const request = new Request(url, {
        method: req.method ?? "GET",
        headers: req.headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? "half" : undefined,
        signal: abort.signal,
      });

      const response = await appInstance.request(request);

      res.statusCode = response.status;
      for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
      }

      if (!response.body) {
        res.end();
        return;
      }

      // Stream the body chunk-by-chunk so Server-Sent Events reach the client immediately.
      res.flushHeaders();
      const reader = response.body.getReader();
      res.on("close", () => reader.cancel().catch(() => {}));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise((resolve) => res.once("drain", resolve));
      }
      res.end();
    } catch (error) {
      if (abort.signal.aborted) return;
      console.error("Helix backend error:", error);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Unexpected server error",
            requestId: randomUUID(),
          },
        }),
      );
    }
  };
}
