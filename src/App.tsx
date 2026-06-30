// The composition root. Calls useCluster() once, then lays the signed cluster
// state out across the mission-control panels and threads `now` down for
// render-time liveness. The whole app is read-only over the relay — its single
// affordance is choosing the relay and proving it rejects forged events.

import { useEffect, useState } from "react";
import { useCluster } from "./nostr/useCluster";
import { agentTimeline, visibleNodes } from "./nostr/clusterState";
import { NODE_GONE_SECS } from "./config";
import { Header } from "./components/Header";
import { NodeGrid } from "./components/NodeGrid";
import { AgentDashboard } from "./components/AgentDashboard";
import { AgentDetail } from "./components/AgentDetail";
import { CreateAgent } from "./components/CreateAgent";
import { Feed } from "./components/Feed";
import { DemoControls } from "./components/DemoControls";
import { SoundToggle } from "./components/SoundToggle";
import { ConfirmSign } from "./components/ConfirmSign";
import { useClusterSound } from "./audio/useClusterSound";

export default function App() {
  const { state, now, relayStatus, relayUrl, setRelayUrl, injectForged, publish } = useCluster();

  // The drill-down selection. Lives here (the composition root holds `state`), so
  // the detail modal can read timeline + meter without threading them through the
  // dashboard. Cleared automatically if the agent vanishes (e.g. relay reset).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? state.agents[selectedId] : undefined;
  useEffect(() => {
    if (selectedId && !state.agents[selectedId]) setSelectedId(null);
  }, [selectedId, state.agents]);

  // Watch the signed cluster state and fire SFX on real transitions (muted by
  // default; the SoundToggle is the opt-in). Skips the relay's back-fill backlog.
  useClusterSound(state);

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
        rejected={state.rejected}
      />

      <main className="grid">
        {/* nodes as a compact full-width strip on top, then the agents hero, then
            the signed feed — all full-width bands, no half-empty columns */}
        <NodeGrid nodes={visibleNodes(state, now, NODE_GONE_SECS)} now={now} />
        {/* control plane: publish a signed 31003 spawn request to bring an agent to life */}
        <div className="section-actions">
          <CreateAgent publish={publish} isSpawned={(id) => !!state.agents[id]} />
        </div>
        <AgentDashboard agents={state.agents} now={now} onSelect={setSelectedId} />
        <Feed feed={state.feed} now={now} />
      </main>

      <DemoControls injectForged={injectForged} />

      {/* floating sound control (muted by default; opt-in unmute) */}
      <SoundToggle />

      {/* confirm-before-sign: renders only when a signature is pending approval */}
      <ConfirmSign />

      {/* agent drill-down: opens when a card is selected */}
      {selected && (
        <AgentDetail
          agent={selected}
          timeline={agentTimeline(state, selected.agent_id)}
          now={now}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
