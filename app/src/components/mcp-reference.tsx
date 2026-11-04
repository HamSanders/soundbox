/**
 * The MCP half of the Developers page: how to connect a client, what the tools
 * actually take, what a real agent turn looks like, and what to do when the
 * connection does not come up.
 *
 * The tool list is not transcribed here any more. It lives in
 * `@/content/mcp/tools`, derived from `server/src/mcp/server.ts` — the MCP tool
 * surface is defined by `registerTool` calls and zod schemas rather than by the
 * OpenAPI document, so unlike the HTTP reference this part cannot be generated
 * from `/openapi.json`. It used to be a local array, and it drifted: five tools
 * documented against twenty on the server, and a citation of
 * `backend/src/soundbox/mcp_server.py`, a Python module deleted when the server
 * moved to TypeScript. Sharing one content module with the marketing page makes
 * that drift show up in two places at once instead of hiding in this file.
 *
 * The Claude-side setup steps are written as text rather than screenshots on
 * purpose. Product UI moves; `claude mcp add --transport http …` and the shape
 * of a config file do not, and an instruction that says exactly what to type
 * survives a redesign that would leave a screenshot lying.
 */

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  C,
  CopyBlock,
  Disclosure,
  DocSection,
  DocSubsection,
  FieldList,
  Note,
} from "@/components/docs-primitives";
import { MCP_TOOLS, MCP_TOOL_GROUPS } from "@/content/mcp/tools";
import { ChevronDownIcon } from "lucide-react";

const SOUND_RESULT = `{
  "id": "987a0eae-6c0e-45e8-b777-81cfe4d15af3",
  "name": "Door slam 01",
  "path": "C:\\\\Users\\\\you\\\\.konchi\\\\sounds\\\\987a0eae-….wav",
  "url": "/files/987a0eae-6c0e-45e8-b777-81cfe4d15af3.wav",
  "model": "stable-audio-open-small",
  "prompt": "heavy wooden door slam, dry room",
  "duration_s": 3.0,
  "sample_rate": 44100,
  "channels": 2,
  "seed": 752071476,
  "tags": ["door", "impact"]
}`;

/* --------------------------------------------------------------- connect */

export function McpConnect({ origin }: { origin: string }) {
  const httpConfig = JSON.stringify(
    { mcpServers: { konchi: { type: "http", url: `${origin}/mcp` } } },
    null,
    2,
  );
  // Spawned by absolute path rather than by name. `npx konchi-mcp` cannot
  // resolve — the package is private — and npm links the bin only into the
  // checkout's own node_modules/.bin, which is not on the PATH an MCP client
  // spawns with. The Agents page shows this line with the path already filled
  // in for the running install; here there is no server to ask.
  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        konchi: {
          command: "node",
          args: ["/absolute/path/to/soundbox/server/dist/mcp/stdio.js"],
          env: { KONCHI_URL: origin },
        },
      },
    },
    null,
    2,
  );

  return (
    <DocSection
      id="mcp-connect"
      title="Connect an MCP client"
      intro={
        <>
          The MCP server runs inside the main Konchi process at <C>{origin}/mcp</C>. There is no
          second daemon to start, but this app must be running for any of it to work.
        </>
      }
    >
      <Note>
        Before connecting a client, install at least one model on the{" "}
        <strong className="text-foreground">Models</strong> page. An agent calling{" "}
        <C>konchi.generate</C> with nothing installed gets an error telling the user to go there.
      </Note>

      <Tabs defaultValue="claude-code">
        {/* Four triggers do not fit in 375px, and TabsList is `w-fit inline-flex`
            with non-shrinking children — left alone it widens the whole page
            rather than clipping. Let the strip scroll inside itself instead. */}
        {/* overflow-y-hidden as well as -x: the active-tab indicator overshoots
            the strip by a pixel, and `overflow-x: auto` alone makes the y axis
            auto too, which draws a vertical scrollbar over a 32px-tall row. */}
        <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
          <TabsTrigger value="http">Other HTTP clients</TabsTrigger>
          <TabsTrigger value="stdio">stdio bridge</TabsTrigger>
        </TabsList>

        <TabsContent value="claude-code" className="mt-3 min-w-0 space-y-3">
          <ol className="ml-4 list-decimal space-y-3 text-sm marker:text-muted-foreground">
            <li>
              Leave Konchi running. The MCP endpoint is served by this process, so a client can
              only reach it while the app is up.
            </li>
            <li>
              In a terminal, in any directory, run:
              <CopyBlock
                className="mt-2"
                code={`claude mcp add --transport http konchi ${origin}/mcp`}
                label="Copy the claude mcp add command"
              />
              Add <C>--scope user</C> to make it available in every project instead of only this
              one.
            </li>
            <li>
              Start or restart <C>claude</C>, then type <C>/mcp</C>. Konchi should be listed as{" "}
              <C>connected</C>, with its {MCP_TOOLS.length} tools.
            </li>
            <li>
              Ask for a sound in plain language, e.g. “make me a heavy wooden door slam for my game”.
              Claude Code will ask to run <C>konchi.generate</C>; approve it, and the reply comes
              back with a file path.
            </li>
          </ol>
          <Note>
            <C>claude mcp list</C> shows what is registered and whether it connects.{" "}
            <C>claude mcp remove konchi</C> undoes step 2.
          </Note>
        </TabsContent>

        <TabsContent value="claude-desktop" className="mt-3 min-w-0 space-y-3">
          <ol className="ml-4 list-decimal space-y-3 text-sm marker:text-muted-foreground">
            <li>Leave Konchi running.</li>
            <li>
              In Claude Desktop, open <strong>Settings → Developer → Edit Config</strong>. That
              opens <C>claude_desktop_config.json</C>: on Windows in{" "}
              <C>%APPDATA%\Claude\</C>, on macOS in{" "}
              <C>~/Library/Application Support/Claude/</C>.
            </li>
            <li>
              Merge this into the file. If <C>mcpServers</C> already exists, add the{" "}
              <C>konchi</C> key to it; do not replace the object.
              <CopyBlock
                className="mt-2"
                code={httpConfig}
                language="json"
                label="Copy the Claude Desktop config"
              />
            </li>
            <li>
              Quit Claude Desktop completely and reopen it. Config is read at startup, and closing
              the window does not quit the app on either platform.
            </li>
            <li>
              Open a new chat and check the tools indicator in the composer: all{" "}
              {MCP_TOOLS.length} Konchi tools should be listed there.
            </li>
          </ol>
          <Note>
            If Konchi does not appear, check the config file first. A trailing comma or a
            duplicated <C>mcpServers</C> key makes the whole file unparseable, and every server
            in it disappears.
          </Note>
        </TabsContent>

        <TabsContent value="http" className="mt-3 min-w-0 space-y-3">
          <p className="text-muted-foreground text-sm">
            Cursor, Windsurf, Zed and most other clients accept a streamable-HTTP server directly,
            with no extra process to run. The key name and file location differ per client; the value is
            the same.
          </p>
          <CopyBlock code={httpConfig} language="json" label="Copy the HTTP MCP config" />
          <Note>
            There is <strong className="text-foreground">no trailing slash</strong> on the URL.
            Konchi rewrites <C>/mcp</C> to the mounted path internally so that clients which do
            not follow 307 redirects on POST still work.
          </Note>
        </TabsContent>

        <TabsContent value="stdio" className="mt-3 min-w-0 space-y-3">
          <p className="text-muted-foreground text-sm">
            For clients that only speak stdio. The bridge is a thin proxy onto the running server:
            it loads no models, so two copies of a diffusion model never compete for one GPU.
          </p>
          <CopyBlock code={stdioConfig} language="json" label="Copy the stdio bridge config" />
          <Note>
            <C>KONCHI_URL</C> tells the bridge where the server is; it defaults to{" "}
            <C>http://127.0.0.1:17494</C> and only needs setting if you moved the port. The path in{" "}
            <C>args</C> must be absolute, and must be the built{" "}
            <C>server/dist/mcp/stdio.js</C>. The Agents page prints it with the path already
            resolved for this install.
          </Note>
        </TabsContent>
      </Tabs>
    </DocSection>
  );
}

/* ----------------------------------------------------------------- tools */

/** A one-word warning on the summary row, so it is visible before opening. */
function ToolBadge({ kind }: { kind: "slow" | "destructive" }) {
  return (
    <span
      className={
        "shrink-0 rounded px-1 py-px text-[0.6rem] font-medium tracking-wide uppercase " +
        (kind === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground")
      }
    >
      {kind === "destructive" ? "deletes" : "blocks"}
    </span>
  );
}

export function McpTools() {
  return (
    <DocSection
      id="mcp-tools"
      title="The tools"
      intro="What an agent sees once connected: sounds first, then speech, then the script and timeline."
    >
      {MCP_TOOL_GROUPS.map((group) => (
        <DocSubsection key={group.id} id={`mcp-tools-${group.id}`} title={group.title}>
          <p className="text-muted-foreground text-sm">{group.intro}</p>
          <div className="min-w-0 space-y-2">
            {MCP_TOOLS.filter((tool) => tool.group === group.id).map((tool) => (
              <Disclosure
                key={tool.name}
                className="bg-card rounded-lg border"
                summary={
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <code className="min-w-0 truncate font-mono text-xs font-medium">
                        {tool.name}
                      </code>
                      {tool.slow ? <ToolBadge kind="slow" /> : null}
                      {tool.destructive ? <ToolBadge kind="destructive" /> : null}
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="text-muted-foreground ml-auto size-4 shrink-0 transition-transform group-open:rotate-180"
                      />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-snug">{tool.blurb}</p>
                  </div>
                }
              >
                {tool.args.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-[0.7rem] font-semibold tracking-wide uppercase">
                      Arguments
                    </p>
                    <FieldList fields={tool.args} />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">No arguments.</p>
                )}
              </Disclosure>
            ))}
          </div>
        </DocSubsection>
      ))}

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-[0.7rem] font-semibold tracking-wide uppercase">
          What a sound looks like coming back
        </p>
        <CopyBlock code={SOUND_RESULT} language="json" label="Copy the sound result shape" />
      </div>

      <Note>
        Every sound-shaped result carries <C>path</C>: an{" "}
        <strong className="text-foreground">absolute filesystem path</strong> to the WAV on this
        machine. The agent can hand it straight to ffmpeg, copy it into a game project's assets
        folder, or attach it, without knowing anything about the Konchi server or its HTTP port.
      </Note>

      <Note>
        Generation is serialised (one GPU, one job at a time), so five parallel{" "}
        <C>konchi.generate</C> calls queue and run one after another. Use <C>variations</C> for
        several takes of one idea. If no model is installed, <C>generate</C> returns an
        actionable error naming the Models screen: surface it, do not retry.
      </Note>
    </DocSection>
  );
}

/* -------------------------------------------------------- worked example */

function Turn({
  role,
  children,
}: {
  role: "You" | "Agent" | "Tool call" | "Tool result";
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-1 text-[0.7rem] font-semibold tracking-wide uppercase">
        {role}
      </p>
      <div className="min-w-0 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

export function McpWorkedExample() {
  return (
    <DocSection
      id="mcp-example"
      title="A worked example"
      intro="One full turn, from a sentence to a file sitting in a game project."
    >
      <div className="bg-card min-w-0 space-y-4 rounded-lg border p-4">
        <Turn role="You">
          <p className="text-foreground">
            “Make me a door slam for my game: heavy wooden door, stone corridor. Put it in{" "}
            <C>assets/audio/</C> as a 48k mono wav.”
          </p>
        </Turn>

        <Turn role="Agent">
          <p className="text-muted-foreground">
            Checks the library first, finds nothing close, and calls the generate tool. It writes a
            physical description of material, action and space instead of repeating your words back.
          </p>
        </Turn>

        <Turn role="Tool call">
          <CopyBlock
            language="json"
            label="Copy the example tool call"
            code={`konchi.generate({
  "prompt": "heavy wooden door slamming shut in a stone corridor, hard impact, long tail",
  "duration_s": 3,
  "variations": 2,
  "tags": ["door", "impact", "game"]
})`}
          />
        </Turn>

        <Turn role="Tool result">
          <CopyBlock
            language="json"
            label="Copy the example tool result"
            code={`{
  "sounds": [
    {
      "id": "987a0eae-6c0e-45e8-b777-81cfe4d15af3",
      "name": "Door slam 01",
      "path": "C:\\\\Users\\\\you\\\\.konchi\\\\sounds\\\\987a0eae-….wav",
      "url": "/files/987a0eae-6c0e-45e8-b777-81cfe4d15af3.wav",
      "duration_s": 3.0,
      "sample_rate": 44100,
      "channels": 2,
      "seed": 752071476
    },
    { "id": "b1f4…", "name": "Door slam 02", "path": "C:\\\\Users\\\\you\\\\.konchi\\\\sounds\\\\b1f4….wav" }
  ],
  "model": "stable-audio-open-small",
  "elapsed_s": 4.71
}`}
          />
        </Turn>

        <Turn role="Agent">
          <p className="text-muted-foreground">
            The <C>path</C> is absolute, so the next step is ordinary file work, with no HTTP and no
            knowledge of the Konchi port. It converts to the format the project wants and drops it
            in:
          </p>
          <CopyBlock
            className="mt-2"
            label="Copy the ffmpeg conversion"
            code={`ffmpeg -i "C:/Users/you/.konchi/sounds/987a0eae-….wav" \\
  -ac 1 -ar 48000 assets/audio/door_slam.wav`}
          />
          <p className="text-muted-foreground mt-2">
            Then it plays both takes back to you by path, or keeps the one whose{" "}
            <C>seed</C> it can reuse later for a matching variant. The sounds are also in the
            Library here, so you can audition them without leaving the conversation.
          </p>
        </Turn>
      </div>

      <Note>
        The agent needed no Konchi-specific code: it called a tool, got JSON with a path, and
        used its normal file tools. A URL relative to the Konchi server would have made this turn
        three steps longer.
      </Note>
    </DocSection>
  );
}

/* ------------------------------------------------------------- debugging */

export function McpDebugging({ origin }: { origin: string }) {
  return (
    <DocSection
      id="mcp-debug"
      title="Debugging your MCP connection"
      intro="Roughly in order of how often each one is the problem."
    >
      <ol className="ml-4 min-w-0 list-decimal space-y-4 text-sm marker:text-muted-foreground">
        <li>
          <strong className="text-foreground">Check the server is up.</strong> The MCP endpoint lives
          inside this app's process, so if Konchi is closed there is nothing to connect to.
          <CopyBlock
            className="mt-2"
            code={`curl ${origin}/api/health`}
            label="Copy the health check"
          />
        </li>
        <li>
          <strong className="text-foreground">Check /mcp is reachable.</strong> A bare GET is not a
          valid MCP request, but the status code tells you what you need: <C>405</C> or <C>400</C>{" "}
          means the endpoint is there and speaking MCP, <C>404</C> means it is not mounted, and
          connection-refused means the port is wrong.
          <CopyBlock
            className="mt-2"
            code={`curl -i ${origin}/mcp`}
            label="Copy the /mcp reachability check"
          />
        </li>
        <li>
          <strong className="text-foreground">Inspect it directly.</strong> MCP Inspector connects
          to a server without any client in the way, lists its tools and lets you invoke one with
          arguments you choose. That tells “the server is broken” apart from “my client's config is
          wrong” in about a minute.
          <CopyBlock
            className="mt-2"
            code={`npx @modelcontextprotocol/inspector`}
            label="Copy the MCP Inspector command"
          />
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            In the Inspector, pick transport <C>Streamable HTTP</C> and URL <C>{origin}/mcp</C>,
            then Connect → List Tools. You should see all {MCP_TOOLS.length} tools; run{" "}
            <C>konchi.list_models</C> as the cheapest end-to-end check, since it needs no GPU.
          </p>
        </li>
        <li>
          <strong className="text-foreground">421 Misdirected Request.</strong> The MCP SDK
          arms DNS-rebinding protection with a localhost-only host allowlist. That is right for a
          local app, but it rejects requests arriving under any other hostname. That
          happens if you bound the server to <C>0.0.0.0</C> and connect by LAN address or container
          name. Set <C>KONCHI_ALLOWED_HOSTS</C> to a comma-separated list of the hosts you use.
        </li>
        <li>
          <strong className="text-foreground">Check the URL has no trailing slash</strong> and that
          it ends in <C>/mcp</C>, not <C>/api/mcp</C>. Clients that do not follow 307 redirects on
          POST fail in a confusing way otherwise.
        </li>
        <li>
          <strong className="text-foreground">stdio bridge.</strong> The bridge proxies to a
          running server, so both must be up. If the server is not on the
          default port, set <C>KONCHI_URL</C> in the client's <C>env</C> block{" "}
          (<C>{origin}</C> for this instance).
        </li>
        <li>
          <strong className="text-foreground">Read the server log.</strong> It records every
          connection and job. The Activity page in this app shows the tail of it, and{" "}
          <C>GET /api/logs?lines=200</C> returns the same thing as JSON.
        </li>
      </ol>
    </DocSection>
  );
}
