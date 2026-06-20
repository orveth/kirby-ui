// Live meter needles: the 21000 ephemeral ticks per agent. An SVG arc gauge whose
// needle sweeps to cpu_pct (CSS transition on the rotation = the needle "sweeps"
// to a new value), plus mem and egress readouts. The fidelity badge is honest
// about metering precision: cgroup_exact (Linux nodes) vs host_coarse (the VZ
// node's coarser host-side metering). A meter that's gone quiet shows "no signal".

import type { MeterView } from "../nostr/clusterState";
import { meterIsLive } from "../nostr/clusterState";
import { CPU_MAX_PCT, METER_IDLE_SECS } from "../config";
import { num, bps } from "./format";
import { Panel } from "./Panel";

interface MetersProps {
  meters: Record<string, MeterView>;
  now: number;
}

export function Meters({ meters, now }: MetersProps) {
  const list = Object.values(meters).sort((a, b) => a.agent_id.localeCompare(b.agent_id));

  return (
    <Panel
      title="live meters"
      sub="cpu · mem · egress · kind 21000"
      meta={list.length > 0 ? `${list.length} streaming` : undefined}
    >
      {list.length === 0 ? (
        <div className="empty">
          <span className="empty-pulse" aria-hidden="true" />
          no live meters — pending on the cluster path
        </div>
      ) : (
        <div className="meter-grid">
          {list.map((m) => (
            <MeterCard key={m.agent_id} meter={m} now={now} />
          ))}
        </div>
      )}
    </Panel>
  );
}

const FIDELITY_COPY: Record<MeterView["fidelity"], { label: string; cls: string; title: string }> = {
  cgroup_exact: { label: "exact", cls: "exact", title: "cgroup-exact (Linux node)" },
  host_coarse: { label: "approx", cls: "coarse", title: "host-coarse (VZ node, coarser metering)" },
};

function MeterCard({ meter, now }: { meter: MeterView; now: number }) {
  const live = meterIsLive(meter, now, METER_IDLE_SECS);
  const fid = FIDELITY_COPY[meter.fidelity];
  const cpu = Math.max(0, Math.min(CPU_MAX_PCT, meter.cpu_pct));

  return (
    <article className={`meter-card${live ? "" : " meter-card--idle"}`}>
      <header className="meter-card-head">
        <span className="agent-id mono">{meter.agent_id}</span>
        <span className={`fidelity fidelity--${fid.cls}`} title={fid.title}>
          {fid.label}
        </span>
      </header>

      <Gauge value={cpu} max={CPU_MAX_PCT} live={live} />

      <div className="meter-readouts">
        <Readout k="mem" v={live ? `${num(meter.mem_mib)} MiB` : "—"} />
        <Readout k="egress" v={live ? bps(meter.egress_bps) : "—"} hot={live && meter.egress_bps > 0} />
      </div>

      {!live && <div className="meter-nosignal">no signal</div>}
    </article>
  );
}

/** A 220°-sweep SVG arc gauge. The needle rotates via CSS transform with a
 *  transition, so a new value makes it physically sweep across the dial. */
function Gauge({ value, max, live }: { value: number; max: number; live: boolean }) {
  const START = -110; // leftmost angle (deg), 0 = straight up
  const END = 110; // rightmost angle
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const angle = START + frac * (END - START);

  // Build the background arc + a value arc using stroke-dasharray on a circle path.
  const R = 42;
  const CX = 50;
  const CY = 52;
  const sweepLen = ((END - START) / 360) * (2 * Math.PI * R); // length of the visible track
  const valueLen = frac * sweepLen;

  // Convert polar (angle from vertical) to an SVG point for the arc endpoints.
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  };
  const a0 = pt(START);
  const a1 = pt(END);
  const arc = `M ${a0.x} ${a0.y} A ${R} ${R} 0 1 1 ${a1.x} ${a1.y}`;

  return (
    <div className={`gauge${live ? "" : " gauge--idle"}`}>
      <svg viewBox="0 0 100 70" className="gauge-svg" aria-hidden="true">
        {/* track */}
        <path className="gauge-track" d={arc} fill="none" strokeLinecap="round" />
        {/* value arc (the lit portion) */}
        <path
          className="gauge-value"
          d={arc}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${valueLen} ${sweepLen * 2}`}
        />
        {/* the needle, rotated about the hub */}
        <g className="gauge-needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R + 4} />
        </g>
        <circle className="gauge-hub" cx={CX} cy={CY} r="3.4" />
      </svg>
      <div className="gauge-readout">
        <span className="gauge-num mono">{live ? value.toFixed(1) : "—"}</span>
        <span className="gauge-unit">% cpu</span>
      </div>
    </div>
  );
}

function Readout({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className="readout">
      <span className="readout-k">{k}</span>
      <span className={`readout-v mono${hot ? " readout-v--hot" : ""}`}>{v}</span>
    </div>
  );
}
