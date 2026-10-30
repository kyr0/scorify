/**
 * Monophonic pitch detection with YIN (de Cheveigné and Kawahara, 2002): the difference function, its cumulative
 * mean normalization, an absolute threshold on the first dip, and parabolic interpolation of the period. Host-neutral
 * and dependency-free, so the same code runs offline, in a Worker and in the AudioWorklet (scorify/pitch-worklet).
 */
/** The AudioWorklet processor name registered by scorify/pitch-worklet. */
export const PITCH_PROCESSOR_NAME = "scorify-pitch-detector-v1";
export interface PitchDetectOptions {
  /** Lowest frequency searched, Hz (default 40: below an 8-string guitar's F#1 tuned a quarter-tone flat). */
  readonly minFrequency?: number;
  /** Highest frequency searched, Hz (default 1500). */
  readonly maxFrequency?: number;
  /** YIN absolute threshold on the normalized difference (default 0.15); lower is stricter. */
  readonly threshold?: number;
  /** Below this RMS the window counts as silence (default 0.003, about -50 dBFS). */
  readonly minRms?: number;
}
export interface PitchEstimate {
  /** Fundamental frequency, Hz. */
  readonly frequency: number;
  /** 1 minus the normalized difference at the chosen period: 1 is perfectly periodic. */
  readonly clarity: number;
  readonly rms: number;
}
const DEFAULTS = {
  minFrequency: 40,
  maxFrequency: 1500,
  threshold: 0.15,
  minRms: 0.003,
} as const;
function check(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`${label} must be in [${min}, ${max}]`);
}
export function pitchDetectOptions(
  options: PitchDetectOptions = {},
): Required<PitchDetectOptions> {
  const o = { ...DEFAULTS, ...options };
  check(o.minFrequency, 10, 10000, "Minimum frequency");
  check(o.maxFrequency, o.minFrequency * 1.5, 20000, "Maximum frequency");
  check(o.threshold, 0.01, 0.9, "YIN threshold");
  check(o.minRms, 0, 1, "Silence level");
  return o;
}
/** The window a detector needs: two of the longest periods searched. */
export function minimumWindow(
  sampleRate: number,
  options: PitchDetectOptions = {},
): number {
  return 2 * Math.ceil(sampleRate / pitchDetectOptions(options).minFrequency) + 2;
}
/**
 * The pitch of one window of samples, or null for silence or no clear period. The window must hold at least two
 * periods of `minFrequency` (`minimumWindow`); the DC offset is removed first.
 */
export function detectPitch(
  samples: ArrayLike<number>,
  sampleRate: number,
  options: PitchDetectOptions = {},
): PitchEstimate | null {
  check(sampleRate, 8000, 384000, "Sample rate");
  const o = pitchDetectOptions(options),
    maxLag = Math.ceil(sampleRate / o.minFrequency);
  return yin(samples, sampleRate, o, new Float64Array(samples.length), new Float64Array(maxLag + 2));
}
/** YIN on validated options, with caller-owned scratch buffers (x: one per sample, d: maxLag + 2). */
function yin(
  samples: ArrayLike<number>,
  sampleRate: number,
  o: Required<PitchDetectOptions>,
  x: Float64Array,
  d: Float64Array,
): PitchEstimate | null {
  const n = samples.length,
    maxLag = Math.ceil(sampleRate / o.minFrequency),
    minLag = Math.max(2, Math.floor(sampleRate / o.maxFrequency));
  if (n < 2 * maxLag + 2)
    throw new RangeError(
      `A window of ${n} samples is too short for ${o.minFrequency} Hz; use at least ${2 * maxLag + 2}`,
    );
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i]!;
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = samples[i]! - mean;
    energy += x[i]! * x[i]!;
  }
  const rms = Math.sqrt(energy / n);
  if (!Number.isFinite(rms) || rms < o.minRms || rms === 0) return null;
  // Difference function over a fixed integration window, then its cumulative mean normalized form.
  const width = n - maxLag - 1;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const delta = x[i]! - x[i + lag]!;
      sum += delta * delta;
    }
    d[lag] = sum;
  }
  d[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    running += d[lag]!;
    d[lag] = running > 0 ? (d[lag]! * lag) / running : 1;
  }
  // The first dip under the threshold, followed down to its local minimum; else the deepest dip, if periodic enough.
  let lag = -1;
  for (let t = minLag; t <= maxLag; t++)
    if (d[t]! < o.threshold) {
      while (t + 1 <= maxLag && d[t + 1]! < d[t]!) t++;
      lag = t;
      break;
    }
  if (lag < 0) {
    let best = minLag;
    for (let t = minLag + 1; t <= maxLag; t++) if (d[t]! < d[best]!) best = t;
    if (d[best]! >= 2 * o.threshold) return null;
    lag = best;
  }
  const a = d[lag - 1]!,
    b = d[lag]!,
    c = d[lag + 1]!,
    curve = a - 2 * b + c,
    shift = curve > 0 ? Math.max(-1, Math.min(1, (a - c) / (2 * curve))) : 0,
    period = lag + shift,
    clarity = Math.max(0, Math.min(1, 1 - (b - 0.25 * (a - c) * shift)));
  const frequency = sampleRate / period;
  if (frequency < o.minFrequency * 0.97 || frequency > o.maxFrequency * 1.03)
    return null;
  return { frequency, clarity, rms };
}
export interface PitchTrackerOptions extends PitchDetectOptions {
  readonly sampleRate: number;
  /** Samples analysed per detection (default: `minimumWindow`; the cost of a detection grows with window × period). */
  readonly windowSize?: number;
  /** Samples between detections (default: a thirtieth of a second, at most the window). */
  readonly hopSize?: number;
  /** Readings under this clarity are reported without a frequency (default 0.8). */
  readonly minClarity?: number;
  /** Recent readings a smoothed frequency is the median of (default 5); 1 disables smoothing. */
  readonly smoothing?: number;
}
export interface PitchReading {
  /** Smoothed frequency, Hz, or null for silence or no clear pitch. */
  readonly frequency: number | null;
  /** This window's own estimate, before smoothing. */
  readonly rawFrequency: number | null;
  readonly clarity: number;
  readonly rms: number;
  /** Input frames consumed when this window ended (its last sample is frame - 1). */
  readonly frame: number;
  readonly time: number;
}
export interface PitchTracker {
  readonly options: Readonly<Required<Omit<PitchTrackerOptions, keyof PitchDetectOptions>>> &
    Required<PitchDetectOptions>;
  /** Append samples; returns one reading per completed hop. */
  push(samples: ArrayLike<number>): PitchReading[];
  /** Forget buffered audio and smoothing history. */
  reset(): void;
}
/**
 * Detect pitch on a stream of samples: a sliding window, one detection per hop, and a median over recent readings of
 * the same note (within a semitone), so a tuner's needle neither jumps between octaves nor jitters.
 */
export function createPitchTracker(options: PitchTrackerOptions): PitchTracker {
  const detect = pitchDetectOptions(options),
    sampleRate = options.sampleRate;
  check(sampleRate, 8000, 384000, "Sample rate");
  const needed = minimumWindow(sampleRate, detect),
    windowSize = options.windowSize ?? needed,
    hopSize = options.hopSize ?? Math.min(windowSize, Math.round(sampleRate / 30)),
    minClarity = options.minClarity ?? 0.8,
    smoothing = options.smoothing ?? 5;
  if (!Number.isSafeInteger(windowSize) || windowSize < needed || windowSize > 65536)
    throw new RangeError(`Window size must be an integer in [${needed}, 65536]`);
  if (!Number.isSafeInteger(hopSize) || hopSize < 1 || hopSize > windowSize)
    throw new RangeError("Hop size must be an integer in [1, window size]");
  check(minClarity, 0, 1, "Minimum clarity");
  if (!Number.isSafeInteger(smoothing) || smoothing < 1 || smoothing > 64)
    throw new RangeError("Smoothing must be an integer in [1, 64]");
  // Every buffer is allocated once: the tracker runs on the audio thread.
  const ring = new Float32Array(windowSize),
    window = new Float32Array(windowSize),
    x = new Float64Array(windowSize),
    d = new Float64Array(Math.ceil(sampleRate / detect.minFrequency) + 2);
  let filled = 0,
    write = 0,
    sinceHop = 0,
    frames = 0,
    recent: number[] = [];
  const reading = (): PitchReading => {
    for (let i = 0; i < windowSize; i++) window[i] = ring[(write + i) % windowSize]!;
    const estimate = yin(window, sampleRate, detect, x, d),
      clear = estimate && estimate.clarity >= minClarity ? estimate : null;
    if (!clear) recent = [];
    else {
      // A new note (more than a semitone away) restarts the history.
      if (recent.length && Math.abs(12 * Math.log2(clear.frequency / median(recent))) > 1)
        recent = [];
      recent.push(clear.frequency);
      if (recent.length > smoothing) recent.shift();
    }
    return {
      frequency: clear ? median(recent) : null,
      rawFrequency: clear?.frequency ?? null,
      clarity: estimate?.clarity ?? 0,
      rms: estimate?.rms ?? rmsOf(window),
      frame: frames,
      time: frames / sampleRate,
    };
  };
  return {
    options: { ...detect, sampleRate, windowSize, hopSize, minClarity, smoothing },
    push(samples) {
      const out: PitchReading[] = [];
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i]!;
        ring[write] = Number.isFinite(v) ? v : 0;
        write = (write + 1) % windowSize;
        frames++;
        if (filled < windowSize) filled++;
        if (++sinceHop >= hopSize && filled === windowSize) {
          sinceHop = 0;
          out.push(reading());
        }
      }
      return out;
    },
    reset() {
      ring.fill(0);
      filled = write = sinceHop = 0;
      recent = [];
    },
  };
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function rmsOf(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! ** 2;
  return Math.sqrt(sum / Math.max(1, samples.length));
}
