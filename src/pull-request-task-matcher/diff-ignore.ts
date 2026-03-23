export type DiffIgnoreConfig = {
  gitattributesContent?: string;
};

export const ALWAYS_IGNORED_GLOBS = ["**/*.lock", "**/*.lockb", "dist/**", "**/dist/**"] as const;
const LINGUIST_ATTRS = new Set(["linguist-generated", "linguist-vendored", "linguist-documentation"]);

export function createDiffIgnoreMatcher(config: DiffIgnoreConfig): (path: string) => boolean {
  const fromGitattributes = parseLinguistIgnoreGlobsFromGitattributes(config.gitattributesContent);
  const globs = [...ALWAYS_IGNORED_GLOBS, ...fromGitattributes];
  const regexes = globs.map(globToRegExp);
  return (path: string) => regexes.some((r) => r.test(path));
}

export function parseLinguistIgnoreGlobsFromGitattributes(content?: string): string[] {
  if (!content?.trim()) return [];

  const lines = content.split(/\r?\n/);
  const globs: string[] = [];

  for (const rawLine of lines) {
    const line = stripTrailingComment(rawLine).trim();
    if (!line) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    const pattern = tokens[0];
    const attrs = tokens.slice(1).join(" ");

    if (!hasLinguistGeneratedOrVendored(attrs)) continue;
    globs.push(normalizeGitAttributesPattern(pattern));
  }

  return globs;
}

function hasLinguistGeneratedOrVendored(attrs: string): boolean {
  return attrs
    .split(/\s+/)
    .filter(Boolean)
    .some((rawToken) => {
      const token = rawToken.toLowerCase();
      if (token.startsWith("-") || token.startsWith("!")) return false;

      const [name, value] = token.split("=", 2);
      if (!name || !LINGUIST_ATTRS.has(name)) return false;
      if (value && ["0", "false", "no", "off"].includes(value)) return false;
      return true;
    });
}

function stripTrailingComment(line: string): string {
  const hashIndex = line.indexOf("#");
  if (hashIndex === -1) return line;
  return line.slice(0, hashIndex);
}

export function normalizeGitAttributesPattern(pattern: string): string {
  let p = pattern.trim();
  if (!p) return p;
  if (p.startsWith("!")) p = p.slice(1);

  const isRootAnchored = p.startsWith("/");
  if (isRootAnchored) p = p.slice(1);

  if (p.endsWith("/")) p = `${p}**`;

  const hasSlash = p.includes("/");
  if (!hasSlash) return `**/${p}`;
  return p;
}

export function globToRegExp(glob: string): RegExp {
  let out = "^";

  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];

    if (ch === "*") {
      const isDoubleStar = glob[i + 1] === "*";
      if (isDoubleStar) {
        out += ".*";
        // eslint-disable-next-line sonarjs/updated-loop-counter
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      continue;
    }

    out += escapeRegexChar(ch);
  }

  out += "$";
  return new RegExp(out);
}

function escapeRegexChar(ch: string): string {
  return /[|\\{}()[\]^$+?.]/.test(ch) ? `\\${ch}` : ch;
}
