import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/bench" element={<BenchPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
