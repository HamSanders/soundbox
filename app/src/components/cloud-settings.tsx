/**
 * Settings → Mirli Cloud: sign in, see the balance, buy credits, sign out.
 *
 * Sign-in is a device code: Mirli shows a code, you approve it at mirli.app
 * in the browser, and this panel flips to signed in on its next poll. Nothing
 * here holds the token; the server keeps it.
 */

import { CheckCircle2Icon, CloudIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CloudPack, CloudStatus } from "@/lib/api";
import { creditsLabel } from "@/lib/cloud";
import { useCloudCancelSignIn, useCloudCheckout, useCloudSignIn, useCloudSignOut } from "@/lib/queries";

const PACKS: { id: CloudPack; label: string; note?: string }[] = [
  { id: "p10", label: "$10 · 1,000 credits" },
  { id: "p25", label: "$25 · 2,600 credits", note: "+4%" },
  { id: "p50", label: "$50 · 5,500 credits", note: "+10%" },
];

const credits = creditsLabel;

export function CloudAccountPanel({ status }: { status: CloudStatus }) {
  const signIn = useCloudSignIn();
  const cancel = useCloudCancelSignIn();
  const signOut = useCloudSignOut();
  const checkout = useCloudCheckout();
  const pending = status.sign_in.state === "pending" ? status.sign_in : null;
  const problem =
    status.sign_in.state === "denied" || status.sign_in.state === "expired" || status.sign_in.state === "error"
      ? status.sign_in.message
      : null;

  if (status.signed_in) {
    const a = status.account;
    return (
      <div className="space-y-3">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CheckCircle2Icon className="text-ok size-4" aria-hidden="true" />
              {a ? a.email : "Signed in"}
            </p>
            {a ? (
              <p className="text-muted-foreground text-xs">
                {a.held > 0 ? `${credits(a.held)} held for renders in progress · ` : ""}
                {credits(a.spent_today)} spent today
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">{status.account_error ?? "Couldn't read the balance."}</p>
            )}
          </div>
          {a && <p className="font-display text-2xl tabular-nums">{credits(a.balance)}</p>}
        </div>
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">
            Buy credits. Checkout opens in your browser. Credits last 12 months, and a failed render is never charged.
          </p>
          <div className="flex flex-wrap gap-2">
            {PACKS.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                disabled={checkout.isPending}
                onClick={() =>
                  checkout.mutate(p.id, {
                    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
                  })
                }
              >
                {p.label}
                {p.note && <span className="text-muted-foreground">{p.note}</span>}
              </Button>
            ))}
          </div>
        </div>
        {!status.hosted && (
          <Button variant="ghost" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out of Mirli Cloud
          </Button>
        )}
      </div>
    );
  }

  if (pending) {
    return (
      <div className="border-border space-y-3 rounded-lg border p-3">
        <p className="text-sm">
          Approve this device in your browser. Check that the code there matches:
        </p>
        <p className="font-mono text-2xl tracking-widest">{pending.user_code}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href={pending.verification_uri_complete} target="_blank" rel="noopener noreferrer">
              Open mirli.app <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => cancel.mutate()}>
            Cancel
          </Button>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs" role="status">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
            Waiting for approval
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Cloud models render on Mirli's servers instead of your GPU, and cost credits. Your prompts are sent to Mirli
        Cloud for those renders only; local models never leave this machine.
      </p>
      {problem && (
        <p className="text-danger text-xs" role="alert">
          {problem}
        </p>
      )}
      <Button size="sm" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
        {signIn.isPending ? (
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <CloudIcon className="size-3.5" aria-hidden="true" />
        )}
        Sign in to Mirli Cloud
      </Button>
    </div>
  );
}
