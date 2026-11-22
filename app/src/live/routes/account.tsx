import { useQuery } from "@tanstack/react-query";

import { LiveShell, LogLabel } from "../components/live-shell";
import { useLive } from "../live-context";
import { clock } from "../lib/prefs";

/**
 * Minutes and account. A placeholder until the cloud ledger exists: locally
 * calls are unlimited and this shows what this machine has used.
 */
export function AccountPage() {
  const live = useLive();
  const { data, isLoading, isError } = useQuery({ queryKey: ["live", "account"], queryFn: live.account, retry: false });
  const m = data?.minutes;

  return (
    <LiveShell>
      <LogLabel>account</LogLabel>
      <h1 className="font-display text-5xl font-extrabold uppercase tracking-wide">Minutes</h1>
      {isLoading ? <p className="mt-6 text-muted-foreground">Loading…</p> : isError || !data ? (
        <p className="mt-6 text-muted-foreground">Can't reach the call service.</p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Stat label="plan" value={data.plan === "local" ? "This computer" : data.plan} />
            <Stat label="used" value={clock(m!.used_seconds)} hint="min:sec" />
            <Stat label="left" value={m!.unlimited ? "Unlimited" : clock(m!.left_seconds ?? 0)} hint={m!.unlimited ? "calls on your own GPU are free" : undefined} />
          </div>
          <section className="mt-10 rounded-xl border border-border bg-card p-6">
            <h2 className="font-medium">Mirli Cloud</h2>
            <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
              No GPU at hand? Mirli Cloud runs the same calls on our servers and bills by the minute. Sign-in and minute packs are not available yet.
            </p>
          </section>
          <h2 className="mt-10 font-medium">Recent calls</h2>
          {data.recent_calls.length ? (
            <table className="mt-3 w-full text-sm">
              <thead className="font-log text-xs text-muted-foreground"><tr><th className="py-2 text-left font-normal">when</th><th className="text-left font-normal">kind</th><th className="text-right font-normal">length</th></tr></thead>
              <tbody>
                {data.recent_calls.map((c) => (
                  <tr key={c.call} className="border-t border-border">
                    <td className="py-2">{new Date(c.started * 1000).toLocaleString()}</td>
                    <td>{c.mode}</td>
                    <td className="text-right font-log">{clock(c.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mt-2 text-sm text-muted-foreground">No calls yet since the call service started.</p>}
        </>
      )}
    </LiveShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-border bg-card p-5">
      <LogLabel>{label}</LogLabel>
      <span className="font-display text-3xl font-extrabold uppercase tracking-wide" data-testid={`stat-${label}`}>{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
