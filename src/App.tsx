// The composition root. Calls useCluster() once, then lays the signed cluster
// state out across the mission-control panels and threads `now` down for
// render-time liveness. The whole app is read-only over the relay — its single
// affordance is choosing the relay and proving it rejects forged events.

import { useCluster } from "./nostr/useCluster";
import { Header } from "./components/Header";
import { NodeGrid } from "./components/NodeGrid";
import { AgentDashboard } from "./components/AgentDashboard";
import { Meters } from "./components/Meters";
import { Feed } from "./components/Feed";
import { DemoControls } from "./components/DemoControls";

export default function App() {
  const { state, now, relayStatus, relayUrl, setRelayUrl, injectForged } = useCluster();

  return (
    <div className="app">
      {/* atmosphere layers — grain + scanlines + vignette, all pure CSS */}
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-scan" aria-hidden="true" />
      <div className="bg-vignette" aria-hidden="true" />

      <Header
        relayStatus={relayStatus}
        relayUrl={relayUrl}
        setRelayUrl={setRelayUrl}
        ingested={state.ingested}
        rejected={state.rejected}
        malformed={state.malformed}
      />

      <main className="grid">
        <NodeGrid nodes={state.nodes} now={now} />
        <AgentDashboard agents={state.agents} now={now} />
        <Meters meters={state.meters} now={now} />
        <Feed feed={state.feed} now={now} />
      </main>

      <DemoControls injectForged={injectForged} />
    </div>
  );
}
