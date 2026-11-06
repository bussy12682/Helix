import { randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";

import { normalizeWorkspacePath } from "./workspace-paths.js";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function safeTokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function rewritePreviewHtml(html, basePath) {
  const base = JSON.stringify(`${basePath}/`);
  const bootstrap = `<script>(() => {\n  const base = ${base};\n  const origin = location.origin;\n  const rewrite = (value) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith(base) ? base + value.slice(1) : value;\n  const originalFetch = window.fetch;\n  if (originalFetch) window.fetch = function(input, init) {\n    if (typeof input === "string") input = rewrite(input);\n    else if (input instanceof Request) {\n      const url = new URL(input.url);\n      if (url.origin === origin && !url.pathname.startsWith(base)) input = new Request(base + url.pathname.slice(1) + url.search, input);\n    }\n    return originalFetch.call(this, input, init);\n  };\n  const open = XMLHttpRequest.prototype.open;\n  XMLHttpRequest.prototype.open = function(method, url, ...rest) { return open.call(this, method, rewrite(url), ...rest); };\n})();</script>`;
  const injection = `<base href="${basePath}/">${bootstrap}`;
  const withAssets = html.replace(
    /(\s(?:src|href|poster)=)(["'])\/(?!\/)([^"']*)\2/gi,
    (_match, attribute, quote, value) => `${attribute}${quote}${basePath}/${value}${quote}`,
  );
  return /<head(?:\s[^>]*)?>/i.test(withAssets)
    ? withAssets.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${injection}`)
    : `${injection}${withAssets}`;
}

export class ApplicationService extends EventEmitter {
  constructor({ workspaceService, executionService, frameAncestors = "'self'" }) {
    super();
    this.setMaxListeners(0);
    this.workspaceService = workspaceService;
    this.executionService = executionService;
    this.frameAncestors = frameAncestors;
    this.previews = new Map();
    this.executionService.on("event", (event) => {
      if (event.type !== "execution_completed") return;
      const job = event.payload?.job;
      if (job?.kind === "install" && job.status === "completed") {
        this.captureInstallArtifacts(event.projectId).catch((error) => {
          console.error(`[workspace] Could not capture install metadata for ${event.projectId}:`, error.message);
        });
      }
      const preview = this.previews.get(event.projectId);
      if (!preview || preview.jobId !== job?.id || preview.status === "stopped") return;
      preview.status = job.status === "stopped" ? "stopped" : "failed";
      preview.error = job.status === "stopped" ? null : job.result?.error || `Preview process exited with code ${job.result?.exitCode}`;
      preview.url = null;
      preview.updatedAt = new Date().toISOString();
      this.emitPreview(preview.status === "stopped" ? "preview_stopped" : "preview_failed", preview);
    });
  }

  applyPreviewHeaders(headers) {
    headers.set("cache-control", "no-store");
    headers.set("referrer-policy", "no-referrer");
    // X-Frame-Options cannot express an allowed cross-origin development frontend.
    // CSP frame-ancestors protects the preview with the configured HELIX origin list.
    headers.delete("x-frame-options");
    const existing = headers.get("content-security-policy");
    if (!existing || !/(?:^|;)\s*frame-ancestors\s/i.test(existing)) {
      headers.set(
        "content-security-policy",
        `${existing ? `${existing}; ` : ""}frame-ancestors ${this.frameAncestors}`,
      );
    }
    return headers;
  }

  emitPreview(type, preview) {
    this.emit("event", {
      id: randomBytes(16).toString("hex"),
      type,
      timestamp: new Date().toISOString(),
      projectId: preview.projectId,
      payload: { preview: this.toPublicPreview(preview) },
    });
  }

  toPublicPreview(preview) {
    return {
      id: preview.id,
      projectId: preview.projectId,
      status: preview.status,
      mode: preview.mode,
      jobId: preview.jobId ?? null,
      url: preview.status === "ready" ? preview.url : null,
      error: preview.error ?? null,
      createdAt: preview.createdAt,
      updatedAt: preview.updatedAt,
    };
  }

  async captureInstallArtifacts(projectId) {
    const lock = await this.workspaceService.readDiskFile(projectId, "package-lock.json").catch(() => null);
    if (lock) await this.workspaceService.write(projectId, "package-lock.json", lock, { createdBy: "npm-install" });
  }

  async readPackage(projectId) {
    const root = await this.workspaceService.materialize(projectId);
    const packageJson = await this.workspaceService.readDiskFile(projectId, "package.json").catch(() => null);
    if (!packageJson) return { root, packageJson: null };
    try {
      return { root, packageJson: JSON.parse(packageJson) };
    } catch (error) {
      throw new Error(`package.json is invalid: ${error.message}`);
    }
  }

  async install(projectId) {
    const { packageJson } = await this.readPackage(projectId);
    if (!packageJson) throw new Error("A package.json file is required for dependency installation");
    const lock = await this.workspaceService.readDiskFile(projectId, "package-lock.json").catch(() => null);
    const command = lock
      ? ["npm", "ci", "--no-audit", "--no-fund"]
      : ["npm", "install", "--no-audit", "--no-fund"];
    return this.executionService.start(projectId, {
      command,
      kind: "install",
      timeoutMs: 600000,
      allowNetwork: true,
    });
  }

  async build(projectId, { command } = {}) {
    let resolved = command;
    if (!resolved) {
      const { packageJson } = await this.readPackage(projectId);
      if (!packageJson?.scripts?.build) throw new Error("package.json does not define a build script");
      resolved = ["npm", "run", "build"];
    }
    return this.executionService.start(projectId, {
      command: resolved,
      kind: "build",
      timeoutMs: 300000,
    });
  }

  getPreview(projectId) {
    const preview = this.previews.get(projectId);
    return preview ? this.toPublicPreview(preview) : null;
  }

  async startPreview(projectId, { command = null, directory = null } = {}) {
    const existing = this.previews.get(projectId);
    if (existing && ["starting", "ready"].includes(existing.status)) return existing;
    const preview = {
      id: `preview_${randomBytes(12).toString("hex")}`,
      projectId,
      status: "starting",
      token: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.previews.set(projectId, preview);
    try {
      const { packageJson } = await this.readPackage(projectId);
      if (!command && !packageJson?.scripts?.dev && !packageJson?.scripts?.start) {
        const staticDirectory = directory || (packageJson ? "dist" : "");
        const indexPath = staticDirectory ? `${staticDirectory}/index.html` : "index.html";
        await this.workspaceService.readDiskFile(projectId, indexPath);
        preview.mode = "static";
        preview.directory = staticDirectory;
        preview.status = "ready";
        preview.url = this.previewUrl(projectId, preview.token);
        preview.updatedAt = new Date().toISOString();
        this.emitPreview("preview_ready", preview);
        return preview;
      }

      preview.mode = "server";
      // Always allocate a previously free loopback port. Caller-selected ports would turn the
      // authenticated preview proxy into an SSRF primitive against unrelated local services.
      preview.port = await availablePort();
      let resolvedCommand = command;
      if (!resolvedCommand && packageJson.scripts.dev) {
        resolvedCommand = ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(preview.port)];
      } else if (!resolvedCommand) {
        resolvedCommand = ["npm", "start"];
      }
      const job = this.executionService.start(projectId, {
        command: resolvedCommand,
        kind: "preview",
        timeoutMs: 24 * 60 * 60 * 1000,
        allowNetwork: true,
        bypassQueue: true,
        env: { HOST: "127.0.0.1", PORT: preview.port },
      });
      preview.jobId = job.id;
      preview.command = job.command;
      preview.url = this.previewUrl(projectId, preview.token);
      this.emitPreview("preview_starting", preview);
      await this.waitUntilReady(preview, job);
      if (job.completedAt) throw new Error(job.result?.error || `Preview process exited with code ${job.result?.exitCode}`);
      preview.status = "ready";
      preview.updatedAt = new Date().toISOString();
      this.emitPreview("preview_ready", preview);
      return preview;
    } catch (error) {
      preview.status = "failed";
      preview.error = error.message;
      preview.updatedAt = new Date().toISOString();
      if (preview.jobId) this.executionService.stop(projectId, preview.jobId);
      this.emitPreview("preview_failed", preview);
      return preview;
    }
  }

  previewUrl(projectId, token) {
    // Keeping the capability in the path lets relative module imports and assets retain it.
    // The HTML bootstrap additionally maps root-relative fetch/XHR URLs into this namespace.
    return `/api/v1/projects/${projectId}/preview/${encodeURIComponent(token)}/`;
  }

  async waitUntilReady(preview, job) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !job.completedAt && !job.stopRequested) {
      try {
        const response = await fetch(`http://127.0.0.1:${preview.port}/`, {
          signal: AbortSignal.timeout(500),
          redirect: "manual",
        });
        response.body?.cancel().catch(() => {});
        if (response.status < 500) return;
      } catch {
        // The process has not opened its socket yet.
      }
      await delay(250);
    }
    if (!job.completedAt && !job.stopRequested) throw new Error("Preview did not open the expected port within 30 seconds");
  }

  stopPreview(projectId) {
    const preview = this.previews.get(projectId);
    if (!preview) return null;
    if (preview.jobId) this.executionService.stop(projectId, preview.jobId);
    preview.status = "stopped";
    preview.updatedAt = new Date().toISOString();
    preview.url = null;
    this.emitPreview("preview_stopped", preview);
    return preview;
  }

  authorize(projectId, token) {
    const preview = this.previews.get(projectId);
    if (!preview || preview.status !== "ready" || !safeTokenEqual(preview.token, token)) return null;
    return preview;
  }

  async proxy(preview, request) {
    const url = new URL(request.url);
    const prefix = `/api/v1/projects/${preview.projectId}/preview`;
    const basePath = `${prefix}/${preview.token}`;
    const requestedPath = url.pathname === basePath
      ? ""
      : url.pathname.startsWith(`${basePath}/`)
        ? url.pathname.slice(basePath.length + 1)
        : url.pathname.startsWith(`${prefix}/`)
          ? url.pathname.slice(prefix.length + 1)
          : "";
    url.searchParams.delete("token");
    if (preview.mode === "static") return this.proxyStatic(preview, requestedPath, basePath);

    const target = `http://127.0.0.1:${preview.port}/${requestedPath}${url.search}`;
    const headers = new Headers(request.headers);
    for (const header of ["host", "connection", "content-length", "authorization", "cookie", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) {
      headers.delete(header);
    }
    headers.set("host", `127.0.0.1:${preview.port}`);
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
    let response;
    try {
      response = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: { code: "PREVIEW_UNAVAILABLE", message: error.message } }), {
        status: 502,
        headers: this.applyPreviewHeaders(new Headers({ "content-type": "application/json" })),
      });
    }
    const responseHeaders = new Headers(response.headers);
    for (const header of ["connection", "content-length", "content-encoding", "transfer-encoding", "set-cookie"]) {
      responseHeaders.delete(header);
    }
    this.applyPreviewHeaders(responseHeaders);
    const location = responseHeaders.get("location");
    if (location?.startsWith("/") && !location.startsWith("//")) {
      responseHeaders.set("location", `${basePath}${location}`);
    }
    const isHtml = responseHeaders.get("content-type")?.toLowerCase().startsWith("text/html");
    const bodyContent = isHtml ? rewritePreviewHtml(await response.text(), basePath) : response.body;
    return new Response(bodyContent, { status: response.status, headers: responseHeaders });
  }

  async proxyStatic(preview, requestedPath, basePath) {
    try {
      const clean = requestedPath.replace(/^\/+/, "") || "index.html";
      const relative = normalizeWorkspacePath(clean.split("?")[0]);
      const diskPath = preview.directory ? path.posix.join(preview.directory, relative) : relative;
      let content;
      try {
        content = await this.workspaceService.readDiskBuffer(preview.projectId, diskPath);
      } catch (error) {
        if (error.code !== "ENOENT" || path.posix.extname(relative)) throw error;
        const fallback = preview.directory ? `${preview.directory}/index.html` : "index.html";
        content = await this.workspaceService.readDiskBuffer(preview.projectId, fallback);
      }
      const type = MIME_TYPES[path.posix.extname(relative).toLowerCase()] || "application/octet-stream";
      const headers = this.applyPreviewHeaders(new Headers({ "content-type": type }));
      const body = type.startsWith("text/html")
        ? rewritePreviewHtml(content.toString("utf8"), basePath)
        : content;
      return new Response(body, { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: { code: "PREVIEW_FILE_NOT_FOUND", message: error.message } }), {
        status: 404,
        headers: this.applyPreviewHeaders(new Headers({ "content-type": "application/json" })),
      });
    }
  }

  close() {
    for (const preview of this.previews.values()) {
      if (preview.jobId) this.executionService.stop(preview.projectId, preview.jobId);
    }
  }
}
