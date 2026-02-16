/**
 * GitHub public repository content fetcher.
 *
 * Uses the unauthenticated GitHub REST API + raw.githubusercontent.com
 * to pull file trees and contents from public repos.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  ref?: string;    // branch / tag / sha
  subpath?: string; // subdirectory filter
};

type TreeEntry = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
};

type TreeApiResponse = {
  sha: string;
  url: string;
  tree: TreeEntry[];
  truncated: boolean;
};

type RepoApiResponse = {
  default_branch: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".cs", ".rb", ".swift",
  ".kt", ".vue", ".svelte",
]);

const EXCLUDED_DIRS = [
  "node_modules/", "vendor/", "dist/", "build/",
  ".git/", "__pycache__/", ".next/",
];

/** Skip individual files larger than 100 KB */
const MAX_FILE_SIZE = 100 * 1024;

/** Cap total files fetched per repo */
const MAX_FILES = 80;

// Reason: Map file extensions to a human-readable language label stored in
// document metadata, so downstream consumers know the code language.
const EXTENSION_LANGUAGE: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
  ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust",
  ".java": "java", ".c": "c", ".cpp": "cpp", ".h": "c", ".cs": "csharp",
  ".rb": "ruby", ".swift": "swift", ".kt": "kotlin", ".vue": "vue",
  ".svelte": "svelte", ".md": "markdown", ".mdx": "markdown",
  ".txt": "text", ".rst": "restructuredtext", ".adoc": "asciidoc",
};

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub URL into owner, repo, optional ref and subpath.
 *
 * Supported formats:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/tree/branch/path/to/dir
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.hostname !== "github.com") {
    throw new Error(`Not a github.com URL: ${url}`);
  }

  // Pathname like "/owner/repo/tree/main/src/lib"
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Cannot extract owner/repo from URL: ${url}`);
  }

  const result: ParsedGitHubUrl = {
    owner: parts[0],
    repo: parts[1],
  };

  // Format: /owner/repo/tree/<ref>[/subpath...]
  if (parts.length >= 4 && parts[2] === "tree") {
    result.ref = parts[3];
    if (parts.length > 4) {
      result.subpath = parts.slice(4).join("/");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function githubApiFetch<T>(path: string): Promise<T> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "exametest-worker",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Fetch repository tree
// ---------------------------------------------------------------------------

/**
 * Fetch the full recursive file tree for a repo.
 * If `ref` is not provided, the default branch is resolved first.
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  ref?: string,
): Promise<{ ref: string; files: TreeEntry[] }> {
  let resolvedRef = ref;

  if (!resolvedRef) {
    const repoInfo = await githubApiFetch<RepoApiResponse>(
      `/repos/${owner}/${repo}`,
    );
    resolvedRef = repoInfo.default_branch;
  }

  const tree = await githubApiFetch<TreeApiResponse>(
    `/repos/${owner}/${repo}/git/trees/${resolvedRef}?recursive=true`,
  );

  // Only keep blobs (files)
  const files = tree.tree.filter((e) => e.type === "blob");
  return { ref: resolvedRef, files };
}

// ---------------------------------------------------------------------------
// Fetch single file content
// ---------------------------------------------------------------------------

/**
 * Fetch raw file content via raw.githubusercontent.com (no API quota).
 */
export async function fetchFileContent(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "exametest-worker" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
  }

  return res.text();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function getExtension(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".");
  if (dotIdx === -1) return "";
  return filePath.slice(dotIdx).toLowerCase();
}

function isExcludedDir(filePath: string): boolean {
  return EXCLUDED_DIRS.some((dir) => filePath.startsWith(dir) || filePath.includes(`/${dir}`));
}

/**
 * Filter tree entries to only supported doc/code files, respecting
 * size limit, excluded directories, and optional subpath prefix.
 */
export function filterFiles(
  files: TreeEntry[],
  subpath?: string,
): TreeEntry[] {
  const allowed = new Set([...DOC_EXTENSIONS, ...CODE_EXTENSIONS]);

  let filtered = files.filter((f) => {
    if (isExcludedDir(f.path)) return false;
    if (f.size != null && f.size > MAX_FILE_SIZE) return false;
    const ext = getExtension(f.path);
    return allowed.has(ext);
  });

  if (subpath) {
    const prefix = subpath.endsWith("/") ? subpath : `${subpath}/`;
    filtered = filtered.filter((f) => f.path.startsWith(prefix) || f.path === subpath);
  }

  // Cap at MAX_FILES — prefer docs first, then code, sorted by path
  if (filtered.length > MAX_FILES) {
    const docs = filtered.filter((f) => DOC_EXTENSIONS.has(getExtension(f.path)));
    const code = filtered.filter((f) => CODE_EXTENSIONS.has(getExtension(f.path)));
    docs.sort((a, b) => a.path.localeCompare(b.path));
    code.sort((a, b) => a.path.localeCompare(b.path));
    filtered = [...docs, ...code].slice(0, MAX_FILES);
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

export function isDocExtension(filePath: string): boolean {
  return DOC_EXTENSIONS.has(getExtension(filePath));
}

export function detectLanguage(filePath: string): string | null {
  const ext = getExtension(filePath);
  return EXTENSION_LANGUAGE[ext] ?? null;
}

/**
 * Build the GitHub web URL for a specific file at a given ref.
 */
export function buildFileUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://github.com/${owner}/${repo}/blob/${ref}/${path}`;
}
