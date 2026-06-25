// The composition root. Calls useCluster() once, then lays the signed cluster
// state out across the mission-control panels and threads `now` down for
// render-time liveness. The whole app is read-only over the relay — its single
// affordance is choosing the relay and proving it rejects forged events.

import { useEffect, useState } from "react";
import { useCluster } from "./nostr/useCluster";
import { agentTimeline, fleetSummary } from "./nostr/clusterState";
import { useWatchlist } from "./nostr/watchlist";
import { STALE_WINDOW_SECS } from "./config";
import { Header } from "./components/Header";
import { FleetOverview } from "./components/FleetOverview";
import { NodeGrid } from "./components/NodeGrid";
import { AgentDashboard } from "./components/AgentDashboard";
import { AgentDetail } from "./components/AgentDetail";
import { Feed } from "./components/Feed";
import { DemoControls } from "./components/DemoControls";
import { SoundToggle } from "./components/SoundToggle";
import { ConfirmSign } from "./components/ConfirmSign";
import { useClusterSound } from "./audio/useClusterSound";

export default function App() {
  const { state, now, relayStatus, relayUrl, setRelayUrl, injectForged } = useCluster();

  // The drill-down selection. Lives here (the composition root holds `state`), so
  // the detail modal can read timeline + meter without threading them through the
  // dashboard. Cleared automatically if the agent vanishes (e.g. relay reset).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? state.agents[selectedId] : undefined;
  useEffect(() => {
    if (selectedId && !state.agents[selectedId]) setSelectedId(null);
  }, [selectedId, state.agents]);

  // The personal layer: agents the user has starred to follow (localStorage).
  const watchlist = useWatchlist();

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
        {/* cluster vitals at a glance, then nodes, the agents hero, the signed feed */}
        <FleetOverview summary={fleetSummary(state, now, STALE_WINDOW_SECS)} />
        <NodeGrid nodes={state.nodes} now={now} />
        <AgentDashboard
          agents={state.agents}
          now={now}
          onSelect={setSelectedId}
          watched={watchlist.watched}
          onToggleWatch={watchlist.toggle}
        />
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
