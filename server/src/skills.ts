/**
 * Agent skills that ship with Konchi.
 *
 * A skill is a directory with a `SKILL.md` (YAML front matter: `name`,
 * `description`; then instructions) that agent harnesses such as Claude Code
 * load on demand. Konchi bundles a few so an agent connected over MCP already
 * knows *how* to use the tools well — check licences, search before generating,
 * prompt by material/action/space, hand back file paths — instead of
 * rediscovering that in every session.
 *
 * Installing is a plain copy; re-installing overwrites, so upgrading Konchi
 * and re-running keeps them current.
 */

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillInfo, SkillInstallResult, SkillTarget } from "./schemas.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `HERE` is `server/src` in dev and `server/dist` when built — both one
 *  level under `server/`, so `server/skills` resolves the same from either. */
export const ROOT = resolve(HERE, "..", "skills");

const FRONT_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

interface Target {
  id: string;
  label: string;
  /** Under the home dir. */
  relative: string;
}

/** Where each harness looks for user-level skills. Extend as clients add
 *  support; `install("dir", path)` covers anything not listed. */
const TARGETS: Target[] = [
  { id: "claude", label: "Claude Code", relative: ".claude/skills" },
  { id: "cursor", label: "Cursor", relative: ".cursor/skills" },
  { id: "codex", label: "Codex", relative: ".codex/skills" },
];

function frontMatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = FRONT_RE.exec(text);
  if (!m) return out;
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^'|'$/g, "");
  }
  return out;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function skillDirs(): string[] {
  if (!isDir(ROOT)) return [];
  return readdirSync(ROOT)
    .map((name) => join(ROOT, name))
    .filter((p) => isDir(p) && isFile(join(p, "SKILL.md")))
    .sort();
}

function skillName(dir: string): string {
  const meta = frontMatter(readFileSync(join(dir, "SKILL.md"), "utf-8"));
  return meta.name || dir.split(/[\\/]/).pop()!;
}

/** Every file under `dir`, as forward-slashed relative paths, sorted. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(relative(dir, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

export function targets(home?: string): SkillTarget[] {
  const base = home ?? homedir();
  return TARGETS.map((t) => {
    const path = join(base, ...t.relative.split("/"));
    return { id: t.id, label: t.label, path, exists: isDir(dirname(path)) };
  });
}

export function listSkills(home?: string): SkillInfo[] {
  const base = home ?? homedir();
  const out: SkillInfo[] = [];
  for (const dir of skillDirs()) {
    const meta = frontMatter(readFileSync(join(dir, "SKILL.md"), "utf-8"));
    const name = meta.name || dir.split(/[\\/]/).pop()!;
    const installed: Record<string, string> = {};
    for (const t of TARGETS) {
      const dest = join(base, ...t.relative.split("/"), name);
      if (isFile(join(dest, "SKILL.md"))) installed[t.id] = dest;
    }
    out.push({
      name,
      description: meta.description ?? "",
      path: dir,
      files: walkFiles(dir),
      installed_at: installed,
    });
  }
  return out;
}

export function resolveTarget(target: string, path?: string | null, home?: string): string {
  const base = home ?? homedir();
  if (target === "dir") {
    if (!path) throw new Error("target 'dir' needs a path");
    return path.startsWith("~") ? join(base, path.slice(1)) : resolve(path);
  }
  for (const t of TARGETS) {
    if (t.id === target) return join(base, ...t.relative.split("/"));
  }
  throw new Error(
    `unknown skills target '${target}'; one of ${TARGETS.map((t) => t.id).join(", ")}, dir`,
  );
}

/** Copy bundled skills into `target`. Returns the destination and the names
 *  installed. */
export function install(
  target = "claude",
  path?: string | null,
  names?: string[] | null,
  home?: string,
): SkillInstallResult {
  const destRoot = resolveTarget(target, path, home);
  mkdirSync(destRoot, { recursive: true });
  const wanted = names && names.length ? new Set(names) : null;
  const installed: string[] = [];
  for (const dir of skillDirs()) {
    const name = skillName(dir);
    const dirName = dir.split(/[\\/]/).pop()!;
    if (wanted && !wanted.has(name) && !wanted.has(dirName)) continue;
    const dest = join(destRoot, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(dir, dest, {
      recursive: true,
      filter: (src) => !/__pycache__|\.pyc$/.test(src),
    });
    installed.push(name);
  }
  if (wanted && !installed.length) {
    throw new Error(`no bundled skill matches ${JSON.stringify([...wanted].sort())}`);
  }
  return { target, dest: destRoot, installed };
}
