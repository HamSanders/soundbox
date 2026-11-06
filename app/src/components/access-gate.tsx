/**
 * The sign-in screen for a Soundbox that has an access token set.
 *
 * Most installs never see it: a desktop server has no token, and
 * `/api/auth/status` answers `required: false` at once. A server started with
 * `SOUNDBOX_API_TOKEN` (a rented GPU, a LAN box, Docker on a public address)
 * answers 401 to every API call until the browser signs in. This asks for the
 * token once, trades it for an HttpOnly cookie (server/src/auth.ts), and only
 * then mounts the app, so the first screen is not a wall of failed requests.
 *
 * If a request comes back 401 later (the cookie expired, or the token was
 * changed on the server) the screen covers the app again instead of
 * unmounting it, so an open studio keeps its state through a re-sign-in.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLinesIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, AUTH_REQUIRED_EVENT, errorMessage } from "@/lib/api";

const AUTH_STATUS_KEY = ["auth-status"] as const;

export function AccessGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: AUTH_STATUS_KEY,
    queryFn: () => api.getAuthStatus(),
    retry: false,
    staleTime: Infinity,
  });
  /** Set once the app has been shown, so a later sign-out covers it rather
   *  than unmounting it. Only ever goes from false to true. */
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onRequired = () => void queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, [queryClient]);

  // No answer at all lets the app load: its own "is the server running?"
  // errors say more than a sign-in box would.
  const open = status.isError || (status.data ? !status.data.required || status.data.signed_in : false);
  if (open && !shown) setShown(true);

  const onSignedIn = () => {
    queryClient.setQueryData(AUTH_STATUS_KEY, { required: true, signed_in: true });
    // Everything that failed while signed out tries again now.
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== AUTH_STATUS_KEY[0] });
  };

  return (
    <>
      {(open || shown) && children}
      {status.data && !open && <SignInScreen onSignedIn={onSignedIn} />}
    </>
  );
}

function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.signIn(token.trim());
      onSignedIn();
    } catch (exc) {
      setError(errorMessage(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-gate-title"
      className="bg-background text-foreground fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
            <AudioLinesIcon className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 id="access-gate-title" className="text-lg font-semibold">
              Sign in to Soundbox
            </h1>
            <p className="text-muted-foreground text-sm">{window.location.host}</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          This Soundbox asks for its access token. It is the value of{" "}
          <code className="font-mono text-xs">SOUNDBOX_API_TOKEN</code> on the machine running the
          server. This browser stays signed in for 30 days.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="access-token">Access token</Label>
          <Input
            id="access-token"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={!token.trim() || busy}>
          {busy && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
      </form>
    </div>
  );
}
