"use client";

import { useState } from "react";

export default function Home() {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <div className="loader">Loading Ecom Pro Dashboard…</div>}
      <iframe
        className="app-frame"
        src="/dashboard.html"
        title="Ecom Pro Dashboard"
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
