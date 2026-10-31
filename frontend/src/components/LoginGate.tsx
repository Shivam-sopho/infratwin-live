import { useState } from "react";
import { api } from "../api";
import { useTwin } from "../store";

export function LoginGate() {
  const required = useTwin((s) => s.authRequired);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!required) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(token.trim());
      location.reload();
    } catch {
      setError("That access token was not accepted.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/95 p-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-5">
        <div>
          <div className="font-semibold text-ink">InfraTwin-Live</div>
          <p className="text-xs text-ink-2">This deployment is private. Enter the access token to continue.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          aria-label="Access token"
          className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink"
        />
        {error && <p className="text-xs text-ink-2">{error}</p>}
        <button disabled={!token || busy} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg disabled:opacity-50">
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
