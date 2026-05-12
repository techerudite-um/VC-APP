"use client";

import dynamic from "next/dynamic";

const App = dynamic(() => import("@/components/app").then((m) => m.App), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background" aria-busy="true" aria-label="Loading" />
  ),
});

export function SpaShell() {
  return <App />;
}
