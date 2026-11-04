/**
 * Agents — the companion-app view of the MCP surface.
 *
 * Konchi's other screens are about sounds; this one is about *who asked for
 * them*. Every agent that has ever connected over MCP, what it called, how it
 * went, and the two levers a team actually needs — the connection details to
 * hand a new client, and installing the bundled skills that make an agent use
 * the tools well from the first call.
 *
 * `useMcpStatus` (4s poll) is the summary: endpoint, connected clients,
 * totals, telemetry status, skills. `useMcpCalls` (3s poll) is the log. Both
 * are cheap local reads — this is a local server with no auth, so "poll a
 * little too often" costs nothing a real deployment would care about.
 */

import { useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleSlashIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  PlugZapIcon,
  ScrollTextIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyBlock } from "@/components/docs-primitives";
import { formatRelative } from "@/lib/format";
import { SearchInput } from "@/components/search-input";
import { useInstallSkills, useMcpCalls, useMcpStatus } from "@/lib/queries";
import type { McpCall, McpClient, SkillInfo, SkillTarget } from "@/lib/api";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------- helpers */

function toolShortName(tool: string): string {
  return tool.replace(/^konchi\./, "");
}

const STATUS_ICON: Record<McpCall["status"], React.ReactNode> = {
  ok: <CheckCircle2Icon className="text-ok size-3.5" aria-hidden="true" />,
  error: <XCircleIcon className="text-danger size-3.5" aria-hidden="true" />,
  running: <Loader2Icon className="text-warn size-3.5 animate-spin" aria-hidden="true" />,
};

/* ------------------------------------------------------------ stat tiles */

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    // A meter, not a KPI card: caps label, a mono readout, the context under it.
    <div className="bg-card rounded-lg border px-3 py-2.5">
      <p className="text-muted-foreground label-caps">{label}</p>
      <p className="mt-1 font-mono text-2xl font-medium tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- connect */

function ConnectCard({
  endpoint,
  stdioCommand,
}: {
  endpoint: string;
  stdioCommand: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZapIcon className="size-4" aria-hidden="true" />
          Connect an agent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Streamable HTTP (preferred)</p>
          <CopyBlock code={endpoint} label="Copy the MCP endpoint" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Claude Code</p>
          <CopyBlock
            label="Copy the claude mcp add command"
            code={`claude mcp add --transport http konchi ${endpoint}`}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Stdio bridge (clients without HTTP transport)</p>
          <CopyBlock code={stdioCommand} label="Copy the stdio command" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            Proxies to this server over HTTP rather than loading models itself, so calls made
            through it still show up below, tagged <code className="font-mono">stdio</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- skills */

function SkillsCard({
  skills,
  targets,
}: {
  skills: SkillInfo[];
  targets: SkillTarget[];
}) {
  const [target, setTarget] = useState(() => targets.find((t) => t.exists)?.id ?? targets[0]?.id);
  const install = useInstallSkills();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollTextIcon className="size-4" aria-hidden="true" />
          Skills
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Konchi ships agent skills that teach a connected agent how to use it well — prompting
          text-to-audio models, checking licences, running a full sound pass over a project. Install
          them once and any agent that reads skills from this machine picks them up.
        </p>

        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.name} className="rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono text-xs font-medium">{s.name}</span>
                {Object.keys(s.installed_at).length > 0 && (
                  <Badge variant="outline" className="ml-auto shrink-0 gap-1">
                    <CheckCircle2Icon className="size-3" aria-hidden="true" />
                    Installed
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{s.description}</p>
            </li>
          ))}
          {skills.length === 0 && (
            <p className="text-muted-foreground text-sm">No bundled skills reported.</p>
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-44" aria-label="Install target">
              <SelectValue placeholder="Choose a target" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id} disabled={!t.exists}>
                  {t.label}
                  {!t.exists ? " (not found)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!target || install.isPending}
            onClick={() => target && install.mutate({ target })}
          >
            {install.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <DownloadIcon />
            )}
            Install all skills
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Or from a terminal: <code className="font-mono">konchi skills install</code>
        </p>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- clients */

function ClientCard({ client }: { client: McpClient }) {
  const errorRate = client.calls > 0 ? Math.round((client.errors / client.calls) * 100) : 0;
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Breathes while the agent is connected: the page is a monitor,
            and a lit, moving LED is how a monitor says "this is live". */}
        <span
          className={cn("sb-led", client.active && "text-ok")}
          data-live={client.active || undefined}
          data-off={!client.active || undefined}
          aria-hidden="true"
        />
        <BotIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm font-medium">
          {client.name}
          {client.version && (
            <span className="text-muted-foreground ml-1 font-mono text-xs">{client.version}</span>
          )}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
          {client.active ? "active" : `seen ${formatRelative(client.last_seen)}`}
        </span>
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <strong className="text-foreground font-medium tabular-nums">{client.calls}</strong> call
          {client.calls === 1 ? "" : "s"}
        </span>
        <span>
          <strong className="text-foreground font-medium tabular-nums">{client.sounds}</strong> sound
          {client.sounds === 1 ? "" : "s"}
        </span>
        <span>
          <strong className="text-foreground font-medium tabular-nums">{client.sessions}</strong>{" "}
          session{client.sessions === 1 ? "" : "s"}
        </span>
        {client.errors > 0 && (
          <span className="text-warn">
            {client.errors} error{client.errors === 1 ? "" : "s"} ({errorRate}%)
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- calls */

function CallRow({ call }: { call: McpCall }) {
  const [open, setOpen] = useState(false);
  // A call that landed while the page was open washes in; the backlog on
  // first load does not, or the whole list would flash at once.
  const [fresh] = useState(() => Date.now() - Date.parse(call.ts) < 8_000);
  const argSummary = useMemo(() => {
    const { prompt, sound_id, q, ...rest } = call.args as Record<string, unknown>;
    const text = typeof prompt === "string" ? prompt : typeof q === "string" ? q : sound_id;
    if (typeof text === "string" && text) return text;
    const keys = Object.keys(rest);
    return keys.length ? `${keys[0]}: ${String(rest[keys[0]])}` : "";
  }, [call.args]);

  return (
    <li className={cn("px-3 py-2", fresh && "sb-feed-in")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-3 text-left"
      >
        {STATUS_ICON[call.status]}
        <span className="text-muted-foreground readout w-14 shrink-0">
          {formatRelative(call.ts)}
        </span>
        <Badge variant="outline" className="shrink-0 font-mono text-[0.65rem]">
          {toolShortName(call.tool)}
        </Badge>
        <span className="text-muted-foreground shrink-0 text-xs">
          {call.client_name ?? "unknown"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">{argSummary}</span>
        {call.sound_ids.length > 0 && (
          <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
            {call.sound_ids.length} sound{call.sound_ids.length === 1 ? "" : "s"}
          </Badge>
        )}
        <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
          {call.duration_ms != null ? `${call.duration_ms}ms` : "—"}
        </span>
      </button>
      {open && (
        <div className="text-muted-foreground mt-2 space-y-1 pl-6 text-xs leading-relaxed">
          <p>
            <span className="font-medium">transport:</span> {call.transport}
            {call.session_id && (
              <>
                {" · "}
                <span className="font-medium">session:</span>{" "}
                <code className="font-mono">{call.session_id.slice(0, 8)}</code>
              </>
            )}
            {call.job_id && (
              <>
                {" · "}
                <span className="font-medium">job:</span>{" "}
                <code className="font-mono">{call.job_id.slice(0, 8)}</code>
              </>
            )}
          </p>
          {call.error && <p className="text-red-500">{call.error}</p>}
          <pre className="bg-muted/50 overflow-x-auto rounded p-2 font-mono text-[0.7rem]">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ page */

export function AgentsPage() {
  const { data: status, isLoading: statusLoading } = useMcpStatus();
  const { data: calls, isLoading: callsLoading } = useMcpCalls({ limit: 100 });
  const [callQuery, setCallQuery] = useState("");

  // Client-side over the 100 rows already fetched. A server-side search would
  // mean a new endpoint for a list that is capped at a hundred anyway.
  const callNeedle = callQuery.trim().toLowerCase();
  const shownCalls = useMemo(() => {
    const all = calls ?? [];
    if (!callNeedle) return all;
    return all.filter((c) =>
      [c.tool, c.client_name ?? "", c.error ?? "", c.status]
        .join(" ")
        .toLowerCase()
        .includes(callNeedle),
    );
  }, [calls, callNeedle]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Agents
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
          Konchi is built to be driven by AI agents over MCP, not just by this app. This page is
          the mission control for that: who has connected, what they have called, and how it went.
        </p>
      </div>

      {statusLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : status ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Calls (24h)"
            value={String(status.calls_24h)}
            hint={`${status.calls_total} all-time`}
          />
          <StatTile
            label="Sounds via MCP"
            value={String(status.sounds_total)}
            hint="in the library"
          />
          <StatTile
            label="Active agents"
            value={String(status.clients.filter((c) => c.active).length)}
            hint={`${status.clients.length} ever connected`}
          />
          <StatTile
            label="Errors"
            value={String(status.errors_total)}
            hint={status.last_call_at ? `last call ${formatRelative(status.last_call_at)}` : undefined}
          />
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="skills" className="gap-1.5">
            Skills
            {status && status.skills.length > 0 && (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[0.65rem]">
                {status.skills.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {status && (
              <ConnectCard endpoint={status.endpoint} stdioCommand={status.stdio_command} />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BotIcon className="size-4" aria-hidden="true" />
                  Connected agents
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {statusLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 rounded-lg" />
                    ))}
                  </div>
                ) : status && status.clients.length > 0 ? (
                  status.clients.map((c) => (
                    <ClientCard key={`${c.name}-${c.version}`} client={c} />
                  ))
                ) : (
                  <p className="text-muted-foreground py-4 text-center text-sm">
                    No agent has connected yet. Add the endpoint above to your client and call{" "}
                    <code className="font-mono">konchi.list_models</code> to check.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {status && !status.otel.enabled && !status.otel.error && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <AlertTriangleIcon
                className="mt-0.5 size-4 shrink-0 text-amber-500"
                aria-hidden="true"
              />
              <p className="text-muted-foreground">
                Want MCP calls in Jaeger, Honeycomb or another OTLP backend? Set a collector
                endpoint in{" "}
                <a href="#/settings" className="text-foreground underline underline-offset-2">
                  Settings
                </a>{" "}
                — no extra install needed.
              </p>
            </div>
          )}
          {status?.otel.enabled && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <ActivityIcon className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
              <span className="text-muted-foreground">
                Exporting traces + metrics to{" "}
                <code className="font-mono">{status.otel.endpoint}</code>
              </span>
            </div>
          )}
          {status?.otel.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 px-3 py-2.5 text-sm">
              <CircleSlashIcon
                className="mt-0.5 size-4 shrink-0 text-red-500"
                aria-hidden="true"
              />
              <p className="text-muted-foreground">{status.otel.error}</p>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TerminalIcon className="size-4" aria-hidden="true" />
                Recent calls
                {status?.clients.some((c) => c.active) && (
                  <span className="label-caps text-ok ml-1 inline-flex items-center gap-1.5">
                    <span className="sb-led size-1.5" data-live aria-hidden="true" />
                    Live
                  </span>
                )}
              </CardTitle>
              {/* The log is the one thing on this page that gets long enough
                  to lose something in — "did that agent ever call speak?" is
                  the question, and scrolling was the only way to ask it. Tool,
                  client and error text, because that is what someone reading a
                  call log is looking for. */}
              {(calls?.length ?? 0) > 5 && (
                <SearchInput
                  value={callQuery}
                  onChange={setCallQuery}
                  placeholder="Search calls…"
                  className="mt-2 max-w-xs"
                />
              )}
            </CardHeader>
            <CardContent className="p-0">
              {callsLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : shownCalls.length > 0 ? (
                <ul className="divide-border/60 divide-y">
                  {shownCalls.map((c) => (
                    <CallRow key={c.id} call={c} />
                  ))}
                </ul>
              ) : callNeedle ? (
                <p className="text-muted-foreground p-4 text-center text-sm">
                  No calls match “{callQuery}”.
                </p>
              ) : (
                <p className="text-muted-foreground p-4 text-center text-sm">
                  Nothing yet — calls made through the MCP endpoint above show up here in real
                  time.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          {statusLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : status ? (
            <SkillsCard skills={status.skills} targets={status.skill_targets} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
