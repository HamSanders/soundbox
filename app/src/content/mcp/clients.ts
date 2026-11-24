/**
 * How to connect each MCP client to Mirli, one entry per vendor.
 *
 * Shared by the site's `/mcp` page and the MCP reference (`/docs/mcp` and the
 * in-app Developers page), so a client's instructions are written once.
 *
 * Every entry was checked against that vendor's own docs on 2026-11-23; the
 * `docs` URL on each entry is the page it was checked against. Where a vendor
 * documents only the stdio form of a command or link and the HTTP form is
 * built by analogy, the entry says so in `caveats` instead of presenting it as
 * documented. Things that moved recently and are easy to get wrong:
 *
 *  - Claude Desktop's `claude_desktop_config.json` takes stdio servers only
 *    (`command`/`args`). A `url` entry is not documented, and its Connectors
 *    screen connects from Anthropic's cloud, which cannot reach 127.0.0.1. So
 *    Desktop goes through a stdio bridge.
 *  - Windsurf is now Devin Desktop (docs.devin.ai), with a new config file.
 *  - Gemini CLI was replaced by Antigravity CLI on 2026-06-18, which reads
 *    `serverUrl`/`url` and rejects Gemini's `httpUrl`.
 *  - VS Code marks `.vscode/mcp.json` with a `servers` key as the older
 *    format, but it is still the one `MCP: Add Server` and `--add-mcp` write.
 *
 * Text fields may wrap inline code in backticks; `InlineCode` in
 * `@/components/mcp-clients` renders those as `<code>`.
 */

export type McpClientKind = "cli" | "editor" | "desktop";

export interface McpClientSnippet {
  /** What the copy button says it copies. */
  label: string;
  code: string;
  language: "bash" | "json" | "toml" | "yaml" | "text";
}

export interface McpClient {
  id: string;
  name: string;
  /** Previous name, shown so people searching for it find the entry. */
  formerly?: string;
  vendor: string;
  kind: McpClientKind;
  /** `http`: talks to the URL directly. `bridge`: needs a stdio proxy. */
  transport: "http" | "bridge";
  /** The single thing to copy in the quick-connect card. */
  quick: McpClientSnippet;
  /** A link that installs the server in one click, where the client has one. */
  install?: { label: string; href: string };
  /** Numbered setup steps for the full guide. Backticks mark inline code. */
  steps: string[];
  /** Further snippets for the full guide, after the steps. */
  extra?: McpClientSnippet[];
  /** Where the config lives, per OS or scope. */
  configPaths?: { label: string; path: string }[];
  /** How to tell it worked. */
  verify: string;
  caveats?: string[];
  /** The vendor page this entry was checked against. */
  docs: string;
}

const SERVER_NAME = "soundbox";

/* `btoa` exists in browsers and in Node 16+, which covers both the SSG build
   and the app. The payloads are ASCII, so no UTF-8 dance is needed. */
function b64(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Every client's setup for the server at `url` (e.g. `http://127.0.0.1:17494/mcp`).
 * A function rather than a constant because the app passes its own origin,
 * which differs when the port has been moved.
 */
export function mcpClients(url: string): McpClient[] {
  const name = SERVER_NAME;
  const mcpServers = (entry: Record<string, unknown>) => json({ mcpServers: { [name]: entry } });
  const vscodeEntry = { name, type: "http", url };

  return [
    {
      id: "claude-code",
      name: "Claude Code",
      vendor: "Anthropic",
      kind: "cli",
      transport: "http",
      quick: {
        label: "Copy the claude mcp add command",
        code: `claude mcp add --transport http ${name} ${url}`,
        language: "bash",
      },
      steps: [
        "Leave Mirli running. The MCP server lives inside the app, so a client can only reach it while the app is up.",
        "In a terminal, in any directory, run the command below. Add `--scope user` to make it available in every project rather than only the current one.",
        "Start or restart `claude` and type `/mcp`.",
      ],
      extra: [
        {
          label: "Copy the .mcp.json entry",
          code: mcpServers({ type: "http", url }),
          language: "json",
        },
      ],
      configPaths: [
        { label: "Local and user scope", path: "~/.claude.json" },
        { label: "Project scope (shared with the repo)", path: ".mcp.json" },
      ],
      verify: "`/mcp` lists `soundbox` as connected. `claude mcp list` shows the same from a shell, and `claude mcp remove soundbox` undoes it.",
      caveats: [
        "In a hand-written `.mcp.json`, `type` is required. An entry with a `url` and no `type` is read as a stdio server and skipped.",
      ],
      docs: "https://code.claude.com/docs/en/mcp",
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      vendor: "Anthropic",
      kind: "desktop",
      transport: "bridge",
      quick: {
        label: "Copy the Claude Desktop config",
        code: mcpServers({ command: "npx", args: ["-y", "mcp-remote", url] }),
        language: "json",
      },
      steps: [
        "Leave Mirli running, and install Node.js if you do not have it. The config below runs `mcp-remote`, a small open-source bridge that turns Desktop's stdio connection into HTTP calls to Mirli.",
        "In Claude Desktop, open Settings → Developer → Edit Config. That opens `claude_desktop_config.json`.",
        "Merge the config below into the file. If `mcpServers` already exists, add the `soundbox` key to it; do not replace the object.",
        "Quit Claude Desktop completely and reopen it. Config is read at startup, and closing the window does not quit the app.",
      ],
      configPaths: [
        { label: "Windows", path: "%APPDATA%\\Claude\\claude_desktop_config.json" },
        { label: "macOS", path: "~/Library/Application Support/Claude/claude_desktop_config.json" },
        { label: "Linux", path: "~/.config/Claude/claude_desktop_config.json" },
      ],
      verify: "Open a new chat and check the tools menu in the composer: the Mirli tools are listed under `soundbox`.",
      caveats: [
        "Do not put a `url` or `\"type\": \"http\"` entry in this file. Claude Desktop documents stdio servers only here, and an unparseable or unsupported entry can make every server in the file disappear.",
        "Settings → Connectors does not work for Mirli. Custom connectors are reached from Anthropic's cloud over the public internet, and Mirli listens on 127.0.0.1.",
        "Without Node, use Mirli's own stdio bridge instead. The Agents page in the app prints its config with the path filled in. It covers the six sound tools, not speech, stories or arrangement.",
      ],
      docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
    },
    {
      id: "cursor",
      name: "Cursor",
      vendor: "Anysphere",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the Cursor mcp.json entry",
        code: mcpServers({ url }),
        language: "json",
      },
      install: {
        label: "Add to Cursor",
        href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${encodeURIComponent(b64({ url }))}`,
      },
      steps: [
        "Leave Mirli running.",
        "Click Add to Cursor and confirm in Cursor, or paste the entry below into `mcp.json` yourself.",
        "Open Cursor Settings → MCP and make sure `soundbox` is switched on.",
      ],
      configPaths: [
        { label: "Every project", path: "~/.cursor/mcp.json" },
        { label: "This project", path: ".cursor/mcp.json" },
      ],
      verify: "Cursor Settings → MCP lists `soundbox` and its tools.",
      caveats: [
        "Cursor documents the install link with a stdio example. The link here carries the same `{\"url\": …}` object as the config file.",
      ],
      docs: "https://cursor.com/docs/context/mcp",
    },
    {
      id: "vscode",
      name: "VS Code",
      vendor: "Microsoft · GitHub Copilot",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the code --add-mcp command",
        code: `code --add-mcp '${JSON.stringify(vscodeEntry)}'`,
        language: "bash",
      },
      install: {
        label: "Add to VS Code",
        href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeEntry))}`,
      },
      steps: [
        "Leave Mirli running.",
        "Click Add to VS Code and review the server in the screen that opens, or run the command below, or use the Command Palette: MCP: Add Server → HTTP, then paste the URL.",
        "Open Copilot Chat in Agent mode and open the tools picker.",
      ],
      extra: [
        {
          label: "Copy the .vscode/mcp.json entry",
          code: json({ servers: { [name]: { type: "http", url } } }),
          language: "json",
        },
      ],
      configPaths: [
        { label: "This workspace", path: ".vscode/mcp.json (key: servers)" },
        { label: "Copilot, every project", path: "~/.copilot/mcp-config.json (key: mcpServers)" },
      ],
      verify: "The tools picker in Copilot Chat lists the `soundbox` tools.",
      caveats: [
        "`.vscode/mcp.json` uses `servers`, not `mcpServers`. Copilot's newer files use `mcpServers` with the same `type` and `url`.",
        "VS Code Insiders uses `vscode-insiders:` in place of `vscode:` and `code-insiders` in place of `code`.",
      ],
      docs: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    },
    {
      id: "codex",
      name: "Codex",
      vendor: "OpenAI",
      kind: "cli",
      transport: "http",
      quick: {
        label: "Copy the codex mcp add command",
        code: `codex mcp add ${name} --url ${url}`,
        language: "bash",
      },
      steps: [
        "Leave Mirli running.",
        "Run the command below, or add the TOML table to `config.toml` by hand. The Codex CLI, IDE extension and ChatGPT desktop app share this file.",
        "Start a new Codex session and run `/mcp`.",
      ],
      extra: [
        {
          label: "Copy the config.toml entry",
          code: `[mcp_servers.${name}]\nurl = "${url}"`,
          language: "toml",
        },
      ],
      configPaths: [
        { label: "Every project", path: "~/.codex/config.toml" },
        { label: "This project (trusted projects only)", path: ".codex/config.toml" },
      ],
      verify: "`/mcp` in a Codex session lists `soundbox` and its tools. `codex mcp list` shows it from a shell.",
      docs: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
    },
    {
      id: "antigravity",
      name: "Antigravity",
      formerly: "Gemini CLI",
      vendor: "Google",
      kind: "cli",
      transport: "http",
      quick: {
        label: "Copy the Antigravity mcp_config.json entry",
        code: mcpServers({ serverUrl: url }),
        language: "json",
      },
      steps: [
        "Leave Mirli running.",
        "Add the entry below to `mcp_config.json`, or open the MCP manager with `/mcp` and add it there.",
        "Restart the session and run `/mcp`.",
      ],
      extra: [
        {
          label: "Copy the legacy Gemini CLI command",
          code: `gemini mcp add --transport http ${name} ${url}`,
          language: "bash",
        },
      ],
      configPaths: [
        { label: "Every project", path: "~/.gemini/config/mcp_config.json" },
        { label: "This workspace", path: ".agents/mcp_config.json" },
        { label: "Legacy Gemini CLI", path: "~/.gemini/settings.json (key: httpUrl)" },
      ],
      verify: "`/mcp` lists `soundbox` as connected with its tools.",
      caveats: [
        "Antigravity reads `serverUrl` (or `url`) and rejects `httpUrl`. The legacy Gemini CLI is the other way round: `httpUrl` is Streamable HTTP and `url` means SSE.",
      ],
      docs: "https://antigravity.google/docs/mcp?tab=cli",
    },
    {
      id: "devin",
      name: "Devin Desktop",
      formerly: "Windsurf",
      vendor: "Cognition",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the devin mcp add command",
        code: `devin mcp add ${name} ${url}`,
        language: "bash",
      },
      steps: [
        "Leave Mirli running.",
        "Run the command below (add `-s user` for every project), or add the entry to `mcp_config.json` yourself.",
        "Start a new Devin Local session.",
      ],
      extra: [
        {
          label: "Copy the mcp_config.json entry",
          code: mcpServers({ url, transport: "http" }),
          language: "json",
        },
      ],
      configPaths: [
        { label: "This project", path: ".devin/mcp_config.json" },
        { label: "Every project (macOS, Linux)", path: "~/.config/devin/mcp_config.json" },
        { label: "Every project (Windows)", path: "%APPDATA%\\devin\\mcp_config.json" },
      ],
      verify: "The MCP server list shows `soundbox` and its tools.",
      caveats: [
        "Windsurf's Cascade used `~/.codeium/windsurf/mcp_config.json` with a `serverUrl` key. Devin's docs do not say whether that file is still read.",
      ],
      docs: "https://docs.devin.ai/cli/extensibility/mcp/configuration",
    },
    {
      id: "zed",
      name: "Zed",
      vendor: "Zed Industries",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the Zed context_servers entry",
        code: json({ context_servers: { [name]: { url } } }),
        language: "json",
      },
      steps: [
        "Leave Mirli running.",
        "Open Settings → AI → MCP Servers → Add Remote Server and paste the URL, or run `zed: open settings file` and merge the entry below.",
        "Open the Agent panel.",
      ],
      verify: "The Agent panel's MCP server list shows `soundbox` as running.",
      docs: "https://zed.dev/docs/ai/mcp",
    },
    {
      id: "cline",
      name: "Cline",
      vendor: "Cline",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the Cline MCP settings entry",
        code: mcpServers({ type: "streamableHttp", url, disabled: false, autoApprove: [] }),
        language: "json",
      },
      steps: [
        "Leave Mirli running.",
        "In Cline, open MCP Servers → Configure, which opens `cline_mcp_settings.json`, and merge the entry below.",
        "Save the file.",
      ],
      configPaths: [{ label: "Cline CLI", path: "~/.cline/data/settings/cline_mcp_settings.json" }],
      verify: "The MCP Servers panel lists `soundbox` with its tools.",
      caveats: ["Keep `\"type\": \"streamableHttp\"`. Without it Cline assumes the older SSE transport and cannot connect."],
      docs: "https://docs.cline.bot/mcp/configuring-mcp-servers",
    },
    {
      id: "goose",
      name: "Goose",
      vendor: "Block",
      kind: "desktop",
      transport: "http",
      quick: {
        label: "Copy the Goose config.yaml entry",
        code: `extensions:\n  ${name}:\n    name: ${name}\n    type: streamable_http\n    uri: ${url}\n    enabled: true\n    timeout: 300`,
        language: "yaml",
      },
      install: {
        label: "Add to Goose",
        href: `goose://extension?url=${encodeURIComponent(url)}&type=streamable_http&id=${name}&name=${name}&description=${encodeURIComponent("Local sound, music and speech generation")}`,
      },
      steps: [
        "Leave Mirli running.",
        "Click Add to Goose, or run `goose configure` → Add Extension → Remote Extension (Streamable HTTP) and paste the URL, or merge the YAML below.",
      ],
      configPaths: [{ label: "Config file", path: "~/.config/goose/config.yaml" }],
      verify: "The extension list shows `soundbox` enabled.",
      caveats: ["The key is `uri`, not `url`."],
      docs: "https://goose-docs.ai/docs/getting-started/using-extensions",
    },
    {
      id: "lm-studio",
      name: "LM Studio",
      vendor: "Element Labs",
      kind: "desktop",
      transport: "http",
      quick: {
        label: "Copy the LM Studio mcp.json entry",
        code: mcpServers({ url }),
        language: "json",
      },
      install: {
        label: "Add to LM Studio",
        href: `https://lmstudio.ai/install-mcp?name=${name}&config=${encodeURIComponent(b64({ url }))}`,
      },
      steps: [
        "Leave Mirli running.",
        "Click Add to LM Studio, or open the Program tab → Install → Edit mcp.json and merge the entry below.",
      ],
      verify: "The Program tab lists `soundbox`, and its tools can be switched on in a chat.",
      docs: "https://lmstudio.ai/docs/app/mcp",
    },
    {
      id: "opencode",
      name: "opencode",
      vendor: "SST",
      kind: "cli",
      transport: "http",
      quick: {
        label: "Copy the opencode mcp add command",
        code: `opencode mcp add ${name} --url ${url}`,
        language: "bash",
      },
      steps: [
        "Leave Mirli running.",
        "Run the command below (add `--global` for every project), or merge the entry into `opencode.json`.",
      ],
      extra: [
        {
          label: "Copy the opencode.json entry",
          code: json({
            $schema: "https://opencode.ai/config.json",
            mcp: { servers: { [name]: { type: "remote", url, oauth: false } } },
          }),
          language: "json",
        },
      ],
      configPaths: [{ label: "This project", path: "opencode.json" }],
      verify: "`opencode mcp list` shows `soundbox` as connected.",
      caveats: [
        "Remote servers default to OAuth in opencode. Mirli has no auth, so the entry sets `oauth: false`.",
      ],
      docs: "https://opencode.ai/docs/mcp-servers/",
    },
    {
      id: "continue",
      name: "Continue",
      vendor: "Continue",
      kind: "editor",
      transport: "http",
      quick: {
        label: "Copy the Continue mcpServers entry",
        code: `mcpServers:\n  - name: ${name}\n    type: streamable-http\n    url: ${url}`,
        language: "yaml",
      },
      steps: [
        "Leave Mirli running.",
        "Add the block below to your Continue config, or save it as a file in `.continue/mcpServers/`.",
        "Switch the chat to Agent mode.",
      ],
      configPaths: [{ label: "This workspace", path: ".continue/mcpServers/soundbox.yaml" }],
      verify: "The tools list in Agent mode includes the `soundbox` tools.",
      caveats: [
        "A standalone file in `.continue/mcpServers/` also needs top-level `name`, `version` and `schema` keys.",
      ],
      docs: "https://docs.continue.dev/customize/deep-dives/mcp",
    },
    {
      id: "other",
      name: "Any other client",
      vendor: "MCP",
      kind: "editor",
      transport: "http",
      quick: { label: "Copy the server URL", code: url, language: "text" },
      steps: [
        "Leave Mirli running.",
        "Add a remote server with the URL above and the Streamable HTTP transport (sometimes called `http` or `streamable-http`). There is no auth to configure.",
        "If the client only speaks stdio, wrap the URL with `npx -y mcp-remote <url>` as in the Claude Desktop entry.",
      ],
      extra: [
        { label: "Copy the generic mcpServers entry", code: mcpServers({ type: "http", url }), language: "json" },
      ],
      verify: "The client lists `soundbox` with its tools.",
      caveats: [
        "No trailing slash on the URL. Mirli rewrites `/mcp` internally and does not answer a POST with a redirect, so the URL works as pasted.",
      ],
      docs: "https://modelcontextprotocol.io/clients",
    },
  ];
}
