import path from "node:path";

export function normalizeWorkspacePath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath.trim() ||
    filePath.includes("\0") ||
    filePath.length > 4096
  ) {
    throw new Error("A valid relative workspace path is required.");
  }
  const portable = filePath.replaceAll("\\", "/");
  const normalized = path.posix.normalize(portable);
  if (
    path.posix.isAbsolute(portable) ||
    /^[a-z]:\//i.test(portable) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === "."
  ) {
    throw new Error(`Workspace path escapes the project root: ${filePath}`);
  }
  return normalized;
}
