export class GitHubExportError extends Error {
  constructor(message, code = "GITHUB_EXPORT_FAILED") {
    super(message);
    this.name = "GitHubExportError";
    this.code = code;
  }
}

export class GitHubService {
  constructor({ token = "", apiBaseUrl = "https://api.github.com", fetchImpl = fetch }) {
    this.token = token;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  getStatus() {
    return { configured: Boolean(this.token), mode: "git-data-api" };
  }

  async request(path, { method = "GET", body } = {}) {
    if (!this.token) throw new GitHubExportError("GitHub export is not configured on this server", "GITHUB_NOT_CONFIGURED");
    let response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "user-agent": "HELIX-Workspace",
          "x-github-api-version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new GitHubExportError(`GitHub request failed: ${error.message}`, "GITHUB_UNAVAILABLE");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message ? String(payload.message).slice(0, 300) : `HTTP ${response.status}`;
      throw new GitHubExportError(`GitHub API: ${message}`);
    }
    return payload;
  }

  async exportProject({ repoName, description = "", private: isPrivate = true, branch = null, artifacts }) {
    if (!/^[\w.-]{1,100}$/.test(repoName ?? "")) {
      throw new GitHubExportError("Repository name must contain only letters, numbers, dots, underscores, or hyphens", "INVALID_REPOSITORY");
    }
    if (!Array.isArray(artifacts) || !artifacts.length) {
      throw new GitHubExportError("There are no workspace files to export", "EMPTY_WORKSPACE");
    }
    if (artifacts.length > 500) throw new GitHubExportError("A maximum of 500 files can be exported at once", "WORKSPACE_TOO_LARGE");
    const repository = await this.request("/user/repos", {
      method: "POST",
      body: { name: repoName, description: String(description).slice(0, 350), private: Boolean(isPrivate), auto_init: true },
    });
    const owner = repository.owner.login;
    const defaultBranch = branch || repository.default_branch || "main";
    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository.name)}`;
    const reference = await this.request(`${repoPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
    const parentSha = reference.object.sha;
    const parentCommit = await this.request(`${repoPath}/git/commits/${parentSha}`);
    const tree = [];
    for (const artifact of artifacts) {
      const blob = await this.request(`${repoPath}/git/blobs`, {
        method: "POST",
        body: { content: Buffer.from(artifact.content, "utf8").toString("base64"), encoding: "base64" },
      });
      tree.push({ path: artifact.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const createdTree = await this.request(`${repoPath}/git/trees`, {
      method: "POST",
      body: { base_tree: parentCommit.tree.sha, tree },
    });
    const commit = await this.request(`${repoPath}/git/commits`, {
      method: "POST",
      body: { message: "Export workspace from HELIX", tree: createdTree.sha, parents: [parentSha] },
    });
    await this.request(`${repoPath}/git/refs/heads/${encodeURIComponent(defaultBranch)}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
    return {
      repository: repository.full_name,
      repositoryUrl: repository.html_url,
      branch: defaultBranch,
      commitSha: commit.sha,
      filesExported: tree.length,
    };
  }
}
