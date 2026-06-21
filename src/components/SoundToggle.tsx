// The sound control: a floating bottom-right pill with a speaker icon (mute/
// unmute) and a small volume slider. Styled to match the Kirby night-sky theme
// (hot-pink, rounded, soft glow). It is the ONLY audio affordance — audio is muted
// by default and only ever starts after this is clicked (which is both the product
// choice and the browser-required user gesture for autoplay).
//
// On the first unmute it resumes/creates the AudioContext and starts the theme
// loop; muting stops the loop. Mute + volume are persisted to localStorage by the
// engine; this component just reflects + drives that state.

import { useCallback, useEffect, useState } from "react";
import { sound } from "../audio/engine";

export function SoundToggle() {
  // Mirror the engine's persisted state into React so the control reflects it.
  const [muted, setMuted] = useState<boolean>(() => sound.isMuted());
  const [volume, setVolume] = useState<number>(() => sound.getVolume());

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next);
    await sound.setMuted(next);
    if (next) {
      sound.stopMusic();
    } else {
      // first unmute = the user gesture: context is now running, start the loop.
      sound.startMusic();
    }
  }, [muted]);

  const onVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value) / 100;
    setVolume(v);
    sound.setVolume(v);
  }, []);

  // If the loop ever gets torn down (e.g. context auto-suspends after the tab is
  // backgrounded), restart it when we come back and are meant to be playing.
  useEffect(() => {
    if (!muted && !sound.isMusicOn()) sound.startMusic();
  }, [muted, volume]);

  return (
    <div className={`sound-toggle${muted ? "" : " sound-toggle--on"}`} role="group" aria-label="sound">
      <button
        type="button"
        className="sound-btn"
        onClick={toggleMute}
        aria-pressed={!muted}
        title={muted ? "Unmute — play Kirby sounds + theme" : "Mute"}
      >
        <SpeakerIcon muted={muted} />
        <span className="sound-btn-label">{muted ? "muted" : "sound on"}</span>
      </button>

      <input
        className="sound-slider"
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={onVolume}
        disabled={muted}
        aria-label="volume"
        title="Volume"
      />
    </div>
  );
}

/** A tiny inline speaker glyph: waves when on, a slash when muted. Matches the
 *  app's inline-SVG convention (no icon dependency). */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      className="sound-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {/* the speaker body */}
      <path
        d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {muted ? (
        // a slash across — muted
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        // two sound waves — on
        <>
          <path d="M15.5 9.2a4 4 0 0 1 0 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M18 7a7.5 7.5 0 0 1 0 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
