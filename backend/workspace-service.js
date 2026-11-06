import { mkdir, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeWorkspacePath } from "./workspace-paths.js";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "dist"]);

export class WorkspaceService {
  constructor({ root, contextManager }) {
    this.root = path.resolve(root);
    this.contextManager = contextManager;
  }

  projectRoot(projectId) {
    if (!/^[\w-]+$/.test(String(projectId))) throw new Error("Invalid project id");
    return path.join(this.root, projectId);
  }

  async resolve(projectId, filePath, { forWrite = false } = {}) {
    const relative = normalizeWorkspacePath(filePath);
    const root = this.projectRoot(projectId);
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error("Path escapes the project workspace");
    }
    if (forWrite) await mkdir(root, { recursive: true, mode: 0o700 });
    const parts = relative.split("/");
    let current = root;
    for (let index = 0; index < parts.length - (forWrite ? 1 : 0); index += 1) {
      current = path.join(current, parts[index]);
      if (forWrite && index < parts.length - 1) await mkdir(current, { recursive: true, mode: 0o700 });
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error("Symbolic links are not allowed in workspace paths");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return { absolute, relative, root };
  }

  list(projectId) {
    return this.contextManager.getArtifacts(projectId).map((artifact) => ({
      path: artifact.path,
      name: artifact.name,
      type: artifact.type,
      version: artifact.version,
      updatedAt: artifact.updatedAt,
      bytes: Buffer.byteLength(artifact.content),
    }));
  }

  read(projectId, filePath) {
    const relative = normalizeWorkspacePath(filePath);
    const artifact = this.contextManager.getArtifacts(projectId).find((file) => file.path === relative);
    if (!artifact) return null;
    return artifact;
  }

  async write(projectId, filePath, content, { createdBy = "user", taskId = null } = {}) {
    const { relative } = await this.resolve(projectId, filePath, { forWrite: true });
    if (typeof content !== "string" || Buffer.byteLength(content) > 2 * 1024 * 1024) {
      throw new Error("Files must be UTF-8 strings no larger than 2 MiB");
    }
    return this.contextManager.saveArtifact(projectId, {
      name: path.posix.basename(relative),
      type: path.posix.extname(relative).slice(1) || "file",
      path: relative,
      content,
      createdBy,
      taskId,
    });
  }

  async delete(projectId, filePath) {
    const relative = normalizeWorkspacePath(filePath);
    const workspace = this.contextManager.getOrCreateWorkspace(projectId);
    const deleted = workspace.artifacts.delete(relative);
    if (deleted) this.contextManager.notifyChange(projectId);
    const { absolute } = await this.resolve(projectId, relative);
    await rm(absolute, { force: true });
    return deleted;
  }

  async materialize(projectId) {
    const root = this.projectRoot(projectId);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const artifacts = this.contextManager.getArtifacts(projectId);
    if (artifacts.length > 2000) throw new Error("A maximum of 2,000 workspace files can be executed");
    let totalBytes = 0;
    for (const artifact of artifacts) {
      totalBytes += Buffer.byteLength(artifact.content);
      if (totalBytes > 50 * 1024 * 1024) throw new Error("Executable workspace exceeds 50 MiB");
      if (artifact.path.split("/").some((part) => IGNORED_DIRECTORIES.has(part))) continue;
      const { absolute } = await this.resolve(projectId, artifact.path, { forWrite: true });
      const temporary = `${absolute}.${process.pid}.tmp`;
      await writeFile(temporary, artifact.content, { mode: 0o600 });
      await rename(temporary, absolute);
    }
    return root;
  }

  async readDiskBuffer(projectId, filePath) {
    const { absolute } = await this.resolve(projectId, filePath);
    return readFile(absolute);
  }

  async readDiskFile(projectId, filePath) {
    const { absolute } = await this.resolve(projectId, filePath);
    return readFile(absolute, "utf8");
  }

  async remove(projectId) {
    await rm(this.projectRoot(projectId), { recursive: true, force: true });
  }
}
