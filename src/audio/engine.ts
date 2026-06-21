// The sound engine: a tiny Web Audio singleton that SYNTHESIZES every sound from
// oscillators + gain — no audio files, no network, no deps. This keeps the whole
// feature self-contained and copyright-clean: all of it is original sound in the
// SPIRIT of an upbeat 8-bit Dream Land, none of it sampled from anything.
//
// Shape:
//   - one shared AudioContext, created LAZILY on the first unmute (a user gesture,
//     which is also what browsers require before audio may play).
//   - master gain -> two buses: sfxGain (blips) and musicGain (the loop, softer).
//   - a set of short, enveloped SFX (each < ~400ms, gentle at default volume).
//   - an original major-key chiptune loop, scheduled with the standard Web Audio
//     lookahead pattern (a setInterval that queues notes a little ahead of the
//     audio clock so timing stays rock-steady regardless of JS jank).
//
// Everything is defensive: if the browser has no AudioContext, every method is a
// no-op, so the rest of the app never has to care.

/** The distinct one-shot effects the cluster can trigger. */
export type Sfx =
  | "born" //       a happy ascending arpeggio/chime — an agent is funded
  | "earn" //       a bright two-note coin blip — sats came in
  | "lowRunway" //  a worried wavering warble — an agent is starving soon
  | "died" //       a sad descending KO — reaped when broke
  | "rejected" //   a harsh error buzz — a forged event was dropped
  | "failover" //   a warp-star whoosh (fast pitch sweep) — a node fell, it survived
  | "quorum" //     a confirming chime — the quorum signed
  | "spendRefused"; // a denied thunk — a single node tried to move money, refused

type OscShape = OscillatorType; // "sine" | "square" | "sawtooth" | "triangle"

const MASTER_DEFAULT = 0.6; // headroom under 1.0 so layered sounds never clip
const MUSIC_BUS_LEVEL = 0.34; // the loop sits clearly UNDER the SFX
const SFX_BUS_LEVEL = 0.9;

const LS_MUTED = "kirby.sound.muted";
const LS_VOLUME = "kirby.sound.volume";

/** Read the persisted mute flag. DEFAULT MUTED on first visit (no key yet). */
function loadMuted(): boolean {
  try {
    const v = window.localStorage.getItem(LS_MUTED);
    if (v === null) return true; // first visit -> muted, opt-in only
    return v === "1";
  } catch {
    return true;
  }
}

/** Read the persisted master volume (0..1), defaulting to a comfortable level. */
function loadVolume(): number {
  try {
    const v = window.localStorage.getItem(LS_VOLUME);
    if (v === null) return MASTER_DEFAULT;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : MASTER_DEFAULT;
  } catch {
    return MASTER_DEFAULT;
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private muted: boolean = loadMuted();
  private volume: number = loadVolume();

  // --- theme-song scheduler state ---
  private musicOn = false;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0; // audio-clock time of the next note to schedule
  private stepIndex = 0; // position within the song (in sixteenth steps)

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  /** True if the browser exposes Web Audio at all. */
  private get supported(): boolean {
    return typeof window !== "undefined" && "AudioContext" in window;
  }

  /**
   * Create the AudioContext + gain graph on demand. MUST be called from a user
   * gesture (the unmute click) the first time, or the context starts suspended.
   * Idempotent: safe to call on every unmute.
   */
  private ensureContext(): boolean {
    if (!this.supported) return false;
    if (this.ctx) return true;

    const ctx = new AudioContext();
    const master = ctx.createGain();
    const sfxBus = ctx.createGain();
    const musicBus = ctx.createGain();

    sfxBus.gain.value = SFX_BUS_LEVEL;
    musicBus.gain.value = MUSIC_BUS_LEVEL;
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
    this.applyMasterGain();
    return true;
  }

  /** Push the current muted/volume state onto the master gain. */
  private applyMasterGain() {
    if (!this.ctx || !this.master) return;
    const target = this.muted ? 0 : this.volume;
    // Short ramp avoids clicks on mute/unmute and volume drags.
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(target, now, 0.02);
  }

  // ---------------------------------------------------------------------------
  // public controls (used by the SoundToggle)
  // ---------------------------------------------------------------------------

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return this.volume;
  }

  /** Whether audio can actually be heard right now (created, running, unmuted). */
  isAudible(): boolean {
    return !!this.ctx && this.ctx.state === "running" && !this.muted;
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    try {
      window.localStorage.setItem(LS_VOLUME, String(this.volume));
    } catch {
      /* ignore */
    }
    this.applyMasterGain();
  }

  /**
   * Mute / unmute. On the FIRST unmute this also creates + resumes the context
   * (it's the user gesture), so callers should invoke this from a click handler.
   * Returns a promise that resolves once the context is running (or immediately).
   */
  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    try {
      window.localStorage.setItem(LS_MUTED, muted ? "1" : "0");
    } catch {
      /* ignore */
    }

    if (!muted) {
      // Unmuting: make sure the context exists and is running (autoplay unlock).
      this.ensureContext();
      if (this.ctx && this.ctx.state !== "running") {
        try {
          await this.ctx.resume();
        } catch {
          /* ignore */
        }
      }
    }
    this.applyMasterGain();
  }

  /** Current AudioContext run-state, for diagnostics/tests ("running" once live). */
  contextState(): AudioContextState | "none" {
    return this.ctx ? this.ctx.state : "none";
  }

  // ---------------------------------------------------------------------------
  // SFX — short synthesized blips with attack/decay envelopes
  // ---------------------------------------------------------------------------

  /**
   * Play a single enveloped oscillator note on the SFX bus.
   * @param freq      frequency in Hz (or [from,to] for a glide)
   * @param startIn   delay before the note starts, in seconds (for arpeggios)
   * @param dur       note duration in seconds
   * @param shape     oscillator waveform (square/triangle/etc — the 8-bit color)
   * @param peak      envelope peak gain (per-note loudness, pre-bus)
   */
  private blip(
    freq: number | [number, number],
    startIn: number,
    dur: number,
    shape: OscShape,
    peak: number,
  ) {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + startIn;

    const osc = ctx.createOscillator();
    osc.type = shape;
    if (Array.isArray(freq)) {
      osc.frequency.setValueAtTime(freq[0], t0);
      // exponential glide reads as a smooth pitch sweep (warp/whoosh)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), t0 + dur);
    } else {
      osc.frequency.setValueAtTime(freq, t0);
    }

    const g = ctx.createGain();
    // a punchy 8-bit envelope: fast attack, exponential decay to ~silence
    const attack = Math.min(0.012, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Play one of the named effects. No-op when muted / unsupported / suspended. */
  play(sfx: Sfx) {
    if (this.muted) return;
    if (!this.ensureContext()) return;
    if (!this.ctx || this.ctx.state !== "running") return;

    switch (sfx) {
      // happy ascending arpeggio/chime — a major triad climbing into the octave
      case "born": {
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        notes.forEach((f, i) => this.blip(f, i * 0.06, 0.13, "square", 0.32));
        // a soft triangle sparkle on top of the last note
        this.blip(1318.51, 0.24, 0.12, "triangle", 0.18);
        break;
      }

      // bright two-note coin blip (the classic up-flick), kept gentle
      case "earn": {
        this.blip(987.77, 0, 0.07, "square", 0.3); // B5
        this.blip(1318.51, 0.07, 0.14, "square", 0.3); // E6
        break;
      }

      // worried wavering warble — a minor second see-sawing, anxious
      case "lowRunway": {
        this.blip(440, 0, 0.1, "triangle", 0.24); // A4
        this.blip(415.3, 0.1, 0.1, "triangle", 0.24); // G#4
        this.blip(440, 0.2, 0.13, "triangle", 0.24);
        break;
      }

      // sad descending KO — a downward minor figure, deflating
      case "died": {
        this.blip(659.25, 0, 0.12, "square", 0.28); // E5
        this.blip(523.25, 0.12, 0.12, "square", 0.26); // C5
        this.blip(392.0, 0.24, 0.14, "square", 0.24); // G4
        this.blip(311.13, 0.38, 0.26, "triangle", 0.26); // Eb4 — the thud
        break;
      }

      // harsh error buzz — a low detuned sawtooth pair, the forged-rejection beat
      case "rejected": {
        this.blip(155.56, 0, 0.16, "sawtooth", 0.26); // Eb3
        this.blip(146.83, 0, 0.16, "sawtooth", 0.22); // D3 (detune = grit)
        this.blip(130.81, 0.14, 0.12, "sawtooth", 0.22); // C3 drop
        break;
      }

      // warp-star whoosh — a fast upward pitch sweep with a triangle tail
      case "failover": {
        this.blip([220, 1760], 0, 0.26, "sawtooth", 0.22); // the warp streak
        this.blip([1760, 880], 0.2, 0.16, "triangle", 0.18); // settle on the new node
        break;
      }

      // confirming chime — a clean rising perfect-fifth + octave, "signed"
      case "quorum": {
        this.blip(659.25, 0, 0.12, "triangle", 0.26); // E5
        this.blip(987.77, 0.1, 0.12, "triangle", 0.26); // B5
        this.blip(1318.51, 0.2, 0.22, "triangle", 0.26); // E6 (held)
        break;
      }

      // denied thunk — a short, blunt low knock (can't move the money)
      case "spendRefused": {
        this.blip(196.0, 0, 0.09, "square", 0.3); // G3
        this.blip(130.81, 0.07, 0.16, "square", 0.28); // C3 — the "no"
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // THE THEME SONG — an original, defined upbeat major-key chiptune loop.
  //
  // Composed (not random): a lilting C-major melody over a simple I–vi–IV–V
  // bassline, the kind of bouncy Dream-Land cadence that loops seamlessly. The
  // melody is a square/pulse lead; the bass is a triangle. Scored on a 16th-note
  // grid; the whole loop is 8 bars (128 steps) and wraps cleanly to bar 1.
  // ---------------------------------------------------------------------------

  // tempo + grid
  private readonly BPM = 132;
  private get stepDur(): number {
    return 60 / this.BPM / 4; // one sixteenth note, in seconds
  }
  private readonly STEPS = 128; // 8 bars × 16 sixteenths
  private readonly LOOKAHEAD_MS = 25; // how often the scheduler wakes
  private readonly SCHEDULE_AHEAD = 0.12; // how far ahead we queue notes (s)

  // The melody, as [stepIndex, midiNote, sixteenths] triples. Rests are simply
  // the gaps. A bouncy, mostly-stepwise major tune that resolves home each loop.
  // C-major; MIDI 60 = C4.
  private readonly MELODY: ReadonlyArray<readonly [number, number, number]> = [
    // bar 1 — kick off bright, skipping up the triad
    [0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2],
    [8, 77, 2], [10, 76, 2], [12, 74, 4],
    // bar 2 — answer phrase, lands on the 2nd
    [16, 72, 2], [18, 74, 2], [20, 76, 2], [22, 72, 2],
    [24, 74, 4], [28, 71, 4],
    // bar 3 — lift to the upper neighbor, a little hop
    [32, 76, 2], [34, 79, 2], [36, 81, 2], [38, 79, 2],
    [40, 77, 2], [42, 76, 2], [44, 77, 4],
    // bar 4 — settle back toward home
    [48, 76, 2], [50, 74, 2], [52, 72, 4],
    [56, 74, 2], [58, 76, 2], [60, 74, 4],
    // bar 5 — repeat the opening idea, varied tail
    [64, 72, 2], [66, 76, 2], [68, 79, 2], [70, 76, 2],
    [72, 77, 2], [74, 79, 2], [76, 81, 4],
    // bar 6 — a brighter answer, reaching the high C
    [80, 79, 2], [82, 77, 2], [84, 76, 2], [86, 74, 2],
    [88, 76, 4], [92, 84, 4],
    // bar 7 — descending skip back down
    [96, 83, 2], [98, 81, 2], [100, 79, 2], [102, 77, 2],
    [104, 76, 2], [106, 74, 2], [108, 72, 4],
    // bar 8 — cadence: V back to I, set up the loop
    [112, 74, 2], [114, 71, 2], [116, 67, 2], [118, 71, 2],
    [120, 72, 4], [124, 79, 2], [126, 71, 2],
  ];

  // The bassline: one root per half-bar, a I–vi–IV–V journey (and a turnaround),
  // as [stepIndex, midiNote, sixteenths]. Triangle = round, soft low end.
  private readonly BASS: ReadonlyArray<readonly [number, number, number]> = [
    [0, 36, 8], [8, 36, 8], //   C
    [16, 33, 8], [24, 33, 8], //  A (vi)
    [32, 29, 8], [40, 29, 8], //  F (IV)
    [48, 31, 8], [56, 31, 8], //  G (V)
    [64, 36, 8], [72, 36, 8], //  C
    [80, 33, 8], [88, 33, 8], //  A (vi)
    [96, 29, 8], [104, 29, 8], // F (IV)
    [112, 31, 8], [120, 31, 8], // G (V) -> turnaround back to C
  ];

  private static midiToFreq(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /** Schedule a single melodic/bass note on the music bus at an absolute time. */
  private musicNote(
    freq: number,
    at: number,
    dur: number,
    shape: OscShape,
    peak: number,
  ) {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(freq, at);

    const g = ctx.createGain();
    // gentle pluck: quick attack, smooth decay, leaves a touch of gap = bounce
    const attack = 0.008;
    const body = Math.max(0.05, dur * 0.85);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + body);

    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(at);
    osc.stop(at + body + 0.02);
  }

  /** Queue every note that falls in the current step, then advance the clock. */
  private scheduleStep(step: number, when: number) {
    const sd = this.stepDur;
    for (const [s, midi, len] of this.MELODY) {
      if (s === step) {
        this.musicNote(SoundEngine.midiToFreq(midi), when, len * sd, "square", 0.16);
      }
    }
    for (const [s, midi, len] of this.BASS) {
      if (s === step) {
        this.musicNote(SoundEngine.midiToFreq(midi), when, len * sd, "triangle", 0.2);
      }
    }
  }

  /** The lookahead loop: keep the next ~120ms of notes queued on the audio clock. */
  private scheduler = () => {
    if (!this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + this.SCHEDULE_AHEAD) {
      this.scheduleStep(this.stepIndex, this.nextNoteTime);
      this.nextNoteTime += this.stepDur;
      this.stepIndex = (this.stepIndex + 1) % this.STEPS; // seamless wrap to bar 1
    }
  };

  /** Start the theme loop (idempotent). Creates/awakens the context if needed. */
  startMusic() {
    if (this.musicOn) return;
    if (!this.ensureContext() || !this.ctx) return;
    this.musicOn = true;
    this.stepIndex = 0;
    // start a hair in the future so the first notes aren't clipped
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.scheduler();
    this.schedulerId = setInterval(this.scheduler, this.LOOKAHEAD_MS);
  }

  /** Stop the theme loop (notes already queued will ring out). */
  stopMusic() {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.musicOn = false;
  }

  isMusicOn(): boolean {
    return this.musicOn;
  }
}

/** The process-wide singleton. Import this everywhere; never construct your own. */
export const sound = new SoundEngine();
