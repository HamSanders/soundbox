/**
 * `virtual:developer-facts`: the facts the /developers page and the agent
 * files (llms.txt, llms-full.txt, the Markdown mirrors) are built from, read
 * from the source at build time rather than typed out a second time.
 *
 * - **MCP tools** come from `server/src/mcp/server.ts`: names, titles and
 *   descriptions from its exported `MCP_TOOLS` table, and the arguments from
 *   the zod `inputSchema` on each `mcp.registerTool` call. The file is parsed
 *   with the TypeScript compiler, not imported, because importing it would
 *   pull the whole server (SQLite, the job queue, audio.cpp) into the site
 *   build. A tool added to the server shows up here on the next build; a tool
 *   in the table with no `registerTool` call, or the reverse, fails the build.
 * - **Environment variables** come from the table under
 *   `## Environment variables` in `docs/INSTALL.md`, the one place they are
 *   documented.
 * - **Version** comes from the root `package.json`.
 *
 * `app/src/content/mcp/tools.ts` is the hand-written, grouped view of the same
 * tools that /mcp and /docs/mcp use. This module is the mechanical one: every
 * tool, every argument, exactly as the server declares them.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import type { Plugin } from "vite";

export interface McpArgFact {
  name: string;
  /** "string", "integer", "number", "boolean", "string[]", `"a" | "b"`, "object", ... */
  type: string;
  required: boolean;
  /** Source text of a `.default(...)`, e.g. "5". */
  default?: string;
  /** "0.5–300" from `.min()`/`.max()` on a number. */
  range?: string;
  description?: string;
}

export interface McpToolFact {
  name: string;
  title: string;
  description: string;
  args: McpArgFact[];
}

export interface EnvVarFact {
  /** One or more names, e.g. ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]. */
  names: string[];
  readBy: string;
  /** Markdown, as written in docs/INSTALL.md. */
  description: string;
}

export interface DeveloperFacts {
  version: string;
  tools: McpToolFact[];
  envVars: EnvVarFact[];
}

/* ------------------------------------------------------------- MCP tools */

/** `[...] as const` and `x satisfies T` are the value underneath. */
function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))
    node = node.expression;
  return node;
}

/** Evaluate a string literal or a `+` chain of them. */
function stringValue(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

function prop(obj: ts.ObjectLiteralExpression, name: string) {
  for (const p of obj.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
    )
      return p.initializer;
  }
  return undefined;
}

interface Chain {
  base?: string;
  required: boolean;
  default?: string;
  description?: string;
  min?: string;
  max?: string;
  int: boolean;
}

/**
 * Walk a zod chain such as `z.number().int().min(0).default(5).describe("…")`
 * from the outside in. The outermost `.describe()` wins, as it does in zod.
 */
function readChain(
  node: ts.Expression,
  consts: Map<string, ts.Expression>,
  sf: ts.SourceFile,
  chain: Chain = { required: true, int: false },
): Chain {
  if (ts.isIdentifier(node)) {
    const init = consts.get(node.text);
    return init ? readChain(init, consts, sf, chain) : chain;
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return chain;
  const method = node.expression.name.text;
  const target = node.expression.expression;
  const args = node.arguments;

  if (ts.isIdentifier(target) && target.text === "z") {
    chain.base = baseType(method, args, consts, sf);
    return chain;
  }
  switch (method) {
    case "optional":
    case "nullish":
      chain.required = false;
      break;
    case "default":
      chain.required = false;
      chain.default ??= args[0]?.getText(sf);
      break;
    case "describe":
      chain.description ??= stringValue(args[0]);
      break;
    case "min":
      chain.min ??= args[0]?.getText(sf);
      break;
    case "max":
      chain.max ??= args[0]?.getText(sf);
      break;
    case "int":
      chain.int = true;
      break;
  }
  return readChain(target, consts, sf, chain);
}

function baseType(
  method: string,
  args: ts.NodeArray<ts.Expression>,
  consts: Map<string, ts.Expression>,
  sf: ts.SourceFile,
): string {
  switch (method) {
    case "enum": {
      let list = args[0] ? unwrap(args[0]) : undefined;
      if (list && ts.isIdentifier(list)) list = consts.get(list.text);
      if (list && ts.isArrayLiteralExpression(list))
        return list.elements.map((e) => JSON.stringify(stringValue(e))).join(" | ");
      return "enum";
    }
    case "array": {
      const inner = args[0] ? readChain(args[0], consts, sf) : undefined;
      const t = inner?.int && inner.base === "number" ? "integer" : inner?.base;
      return t && /^[a-z]+$/.test(t) ? `${t}[]` : "array";
    }
    case "record":
      return "object";
    case "literal":
      return args[0]?.getText(sf) ?? "literal";
    default:
      return method;
  }
}

function readArgs(
  schema: ts.Expression | undefined,
  consts: Map<string, ts.Expression>,
  sf: ts.SourceFile,
): McpArgFact[] {
  if (!schema) return [];
  if (ts.isIdentifier(schema)) return readArgs(consts.get(schema.text), consts, sf);
  if (!ts.isObjectLiteralExpression(schema))
    throw new Error(`[developer-facts] unreadable inputSchema: ${schema.getText(sf)}`);
  const out: McpArgFact[] = [];
  for (const p of schema.properties) {
    if (ts.isSpreadAssignment(p)) {
      out.push(...readArgs(p.expression, consts, sf));
      continue;
    }
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    const c = readChain(p.initializer, consts, sf);
    const type = c.base === "number" && c.int ? "integer" : (c.base ?? "unknown");
    const numeric = type === "number" || type === "integer";
    const range =
      numeric && (c.min !== undefined || c.max !== undefined)
        ? `${c.min ?? ""}–${c.max ?? ""}`
        : undefined;
    out.push({
      name: p.name.text,
      type,
      required: c.required,
      ...(c.default !== undefined ? { default: c.default } : {}),
      ...(range ? { range } : {}),
      ...(c.description ? { description: c.description } : {}),
    });
  }
  return out;
}

export function readMcpTools(file: string): McpToolFact[] {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  // Every `const NAME = …` in the file, top-level or not (DEVICE_PARAMS lives
  // inside the function that registers the tools), plus the top-level consts
  // of the files it imports from (DEVICE_KINDS is in ../devices.ts), so
  // `inputSchema: GENERATE_INPUT` and `z.enum(DEVICE_KINDS)` can be followed.
  const consts = new Map<string, ts.Expression>();
  let table: ts.ArrayLiteralExpression | undefined;
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, unwrap(node.initializer));
      if (node.name.text === "MCP_TOOLS" && ts.isArrayLiteralExpression(node.initializer))
        table = node.initializer;
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!spec.startsWith(".")) continue;
    const dep = path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts"));
    if (!existsSync(dep)) continue;
    const depSf = ts.createSourceFile(dep, readFileSync(dep, "utf8"), ts.ScriptTarget.Latest, true);
    for (const s of depSf.statements) {
      if (!ts.isVariableStatement(s)) continue;
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && !consts.has(d.name.text))
          consts.set(d.name.text, unwrap(d.initializer));
    }
  }
  if (!table) throw new Error(`[developer-facts] no MCP_TOOLS table in ${file}`);

  const schemas = new Map<string, ts.Expression | undefined>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "registerTool"
    ) {
      const name = stringValue(node.arguments[0]);
      const config = node.arguments[1];
      if (name && config && ts.isObjectLiteralExpression(config))
        schemas.set(name, prop(config, "inputSchema"));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const tools: McpToolFact[] = [];
  for (const el of table.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const name = stringValue(prop(el, "name"));
    if (!name) continue;
    if (!schemas.has(name))
      throw new Error(`[developer-facts] ${name} is in MCP_TOOLS but never registered`);
    tools.push({
      name,
      title: stringValue(prop(el, "title")) ?? name,
      description: stringValue(prop(el, "description")) ?? "",
      args: readArgs(schemas.get(name), consts, sf),
    });
  }
  for (const name of schemas.keys()) {
    if (!tools.some((t) => t.name === name))
      throw new Error(`[developer-facts] ${name} is registered but not in MCP_TOOLS`);
  }
  return tools;
}

/* ---------------------------------------------------------- env variables */

export function readEnvVars(installMd: string): EnvVarFact[] {
  const text = readFileSync(installMd, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("\n## Environment variables");
  if (start < 0) throw new Error("[developer-facts] no env table in INSTALL.md");
  const section = text.slice(start + 1).split(/\n## /)[0];
  const rows = section
    .split("\n")
    .filter((l) => l.startsWith("| `"))
    .map((l) => l.slice(1, -1).split(" | ").map((c) => c.trim()));
  return rows.map(([names, readBy, ...rest]) => ({
    names: [...names.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
    readBy,
    description: rest.join(" | "),
  }));
}

/* -------------------------------------------------------------- the module */

export function readDeveloperFacts(repoRoot: string): DeveloperFacts {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return {
    version: pkg.version,
    tools: readMcpTools(path.join(repoRoot, "server/src/mcp/server.ts")),
    envVars: readEnvVars(path.join(repoRoot, "docs/INSTALL.md")),
  };
}

const ID = "virtual:developer-facts";
const RESOLVED = `\0${ID}`;

export function developerFacts(repoRoot: string): Plugin {
  return {
    name: "soundbox:developer-facts",
    resolveId(source) {
      return source === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      for (const f of ["package.json", "server/src/mcp/server.ts", "docs/INSTALL.md"])
        this.addWatchFile(path.join(repoRoot, f));
      return `export default ${JSON.stringify(readDeveloperFacts(repoRoot))};`;
    },
  };
}
