import { useEffect, useState, type FormEvent } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { getJson, postJson } from "./api";
import { ScanPage } from "./scan/ScanPage";
import { BenchPage } from "./bench/BenchPage";

function useServerStatus(): string {
  const [serverStatus, setServerStatus] = useState("checking");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((health: { status: string }) => !cancelled && setServerStatus(health.status))
      .catch(() => !cancelled && setServerStatus("unreachable"));
    return () => {
      cancelled = true;
    };
  }, []);
  return serverStatus;
}

function Home() {
  const serverStatus = useServerStatus();
  return (
    <main className="screen">
      <p className="eyebrow">Proof of concept</p>
      <h1>Teardown Scanner</h1>
      <p className="muted">Standalone. Throwaway storage, CSV out only.</p>
      <nav className="choices">
        <Link className="choice" to="/scan">
          <strong>Phone</strong>
          <span>Scan parts with the camera</span>
        </Link>
        <Link className="choice" to="/bench">
          <strong>Bench</strong>
          <span>Live list, review and export</span>
        </Link>
      </nav>
      <p className={`status status-${serverStatus}`} data-testid="server-status">
        Server: {serverStatus}
      </p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="screen">
      <Link to="/" className="back">← Home</Link>
      <h1>Not found</h1>
      <p className="muted">No such screen.</p>
    </main>
  );
}

interface SignInStatus {
  signInRequired: boolean;
  techName: string | null;
}

// Shown instead of the app when the server has a team passcode and this phone hasn't signed in yet
function SignIn({ onSignedIn }: { onSignedIn: (techName: string) => void }) {
  const [name, setName] = useState(() => {
    try { return window.localStorage.getItem("teardown-tech-name") ?? ""; } catch { return ""; }
  });
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await postJson<{ techName: string }>("/api/login", { name, passcode });
      try { window.localStorage.setItem("teardown-tech-name", name.trim()); } catch { /* the name is just a convenience */ }
      onSignedIn(result.techName);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Sign-in failed");
    }
  }

  return (
    <main className="screen">
      <p className="eyebrow">Teardown Scanner</p>
      <h1>Sign in</h1>
      <form className="sign-in-form" onSubmit={(event) => void submit(event)}>
        <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" data-testid="sign-in-name" />
        <input className="field-input" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} placeholder="Team passcode" data-testid="sign-in-passcode" />
        <button className="btn-primary" type="submit" data-testid="sign-in-btn">Sign in</button>
        {error && <p className="form-error">{error}</p>}
      </form>
    </main>
  );
}

export function App() {
  const [signIn, setSignIn] = useState<SignInStatus | null>(null);
  useEffect(() => {
    getJson<SignInStatus>("/api/me")
      .then(setSignIn)
      // If the check itself fails, let the app load; the API will still refuse calls that need sign-in
      .catch(() => setSignIn({ signInRequired: false, techName: null }));
  }, []);

  if (!signIn) return null;
  if (signIn.signInRequired && !signIn.techName) {
    return <SignIn onSignedIn={(techName) => setSignIn({ signInRequired: true, techName })} />;
  }
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/bench" element={<BenchPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
