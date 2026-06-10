import { PitchDetector as McLeodPitchDetector } from 'pitchy';

import type { PitchFrame } from '../types/song';
import { centsBetween, hzToMidi, midiToHz, midiToNoteName } from '../utils/music';

export interface PitchDetectorOptions {
  fftSize?: number;
  clarityThreshold?: number;
  minVolumeDecibels?: number;
  minFrequency?: number;
  maxStableFrequency?: number;
  holdMs?: number;
  smoothing?: number;
}

export class RealtimePitchDetector {
  private readonly buffer: Float32Array<ArrayBuffer>;

  private readonly detector: McLeodPitchDetector<Float32Array>;

  private previousFrequency = 0;

  private lastFrame: PitchFrame | null = null;

  private readonly stableMidiBuffer: number[] = [];

  constructor(private readonly options: PitchDetectorOptions = {}) {
    const fftSize = options.fftSize ?? 4096;
    this.buffer = new Float32Array(fftSize) as Float32Array<ArrayBuffer>;
    this.detector = McLeodPitchDetector.forFloat32Array(fftSize);
    this.detector.clarityThreshold = options.clarityThreshold ?? 0.5;
    this.detector.minVolumeDecibels = options.minVolumeDecibels ?? -58;
  }

  readFrame(analyser: AnalyserNode, sampleRate: number, noiseGateDb = -45): PitchFrame | null {
    analyser.getFloatTimeDomainData(this.buffer);

    const [rawFrequency, clarity] = this.detector.findPitch(this.buffer, sampleRate);
    const volume = this.getRmsVolume();
    const timestamp = performance.now();
    const frequency = this.smoothFrequency(this.stabilizeFrequency(rawFrequency));
    const gateThreshold = 10 ** (noiseGateDb / 20);
    const isVoiced = volume >= gateThreshold;
    const detected = frequency > 0 && isVoiced && clarity >= (this.options.clarityThreshold ?? 0.5);

    if (detected) {
      const stableFrequency = this.stabilizeNoteChange(frequency);
      const frame = this.createFrame(stableFrequency, clarity, volume, timestamp);
      this.previousFrequency = frequency;
      this.lastFrame = frame;
      return frame;
    }

    if (this.lastFrame && isVoiced && timestamp - this.lastFrame.timestamp <= (this.options.holdMs ?? 220)) {
      return {
        ...this.lastFrame,
        clarity,
        volume,
        timestamp,
      };
    }

    if (!isVoiced) {
      this.previousFrequency = 0;
      this.lastFrame = null;
      this.stableMidiBuffer.length = 0;
    }

    return null;
  }

  reset(): void {
    this.previousFrequency = 0;
    this.lastFrame = null;
    this.stableMidiBuffer.length = 0;
  }

  private createFrame(frequency: number, clarity: number, volume: number, timestamp: number): PitchFrame {
    const midi = hzToMidi(frequency);
    const roundedMidi = Math.round(midi);
    const targetFrequency = midiToHz(roundedMidi);

    return {
      frequency,
      clarity,
      note: midiToNoteName(midi),
      midi,
      cents: centsBetween(frequency, targetFrequency),
      volume,
      timestamp,
    };
  }

  private getRmsVolume(): number {
    let sum = 0;

    for (const sample of this.buffer) {
      sum += sample * sample;
    }

    return Math.sqrt(sum / this.buffer.length);
  }

  private stabilizeFrequency(rawFrequency: number): number {
    if (!rawFrequency) {
      return 0;
    }

    const minFrequency = this.options.minFrequency ?? 75;
    const maxStableFrequency = this.options.maxStableFrequency ?? 560;
    const candidates = [rawFrequency / 4, rawFrequency / 2, rawFrequency, rawFrequency * 2]
      .filter((frequency) => frequency >= minFrequency && frequency <= maxStableFrequency)
      .map((frequency) => ({
        frequency,
        score: this.scoreCandidate(frequency, maxStableFrequency),
      }))
      .sort((a, b) => a.score - b.score);

    return candidates[0]?.frequency ?? rawFrequency;
  }

  private scoreCandidate(frequency: number, maxStableFrequency: number): number {
    if (!this.previousFrequency) {
      const vocalCenterPenalty = Math.abs(Math.log2(frequency / 260)) * 0.08;
      const highPenalty = frequency > maxStableFrequency * 0.86 ? 0.25 : 0;
      return vocalCenterPenalty + highPenalty;
    }

    const octaveDistance = Math.abs(Math.log2(frequency / this.previousFrequency));
    const semitoneJump = Math.abs(12 * Math.log2(frequency / this.previousFrequency));
    const jumpPenalty = semitoneJump > 5 ? 0.35 : 0;

    return octaveDistance + jumpPenalty;
  }

  private smoothFrequency(frequency: number): number {
    if (!frequency || !this.previousFrequency) {
      return frequency;
    }

    const semitoneJump = Math.abs(12 * Math.log2(frequency / this.previousFrequency));

    if (semitoneJump > 7) {
      return this.previousFrequency;
    }

    const smoothing = this.options.smoothing ?? 0.28;
    return this.previousFrequency * (1 - smoothing) + frequency * smoothing;
  }

  private stabilizeNoteChange(frequency: number): number {
    const midi = hzToMidi(frequency);
    this.stableMidiBuffer.push(midi);

    if (this.stableMidiBuffer.length > 5) {
      this.stableMidiBuffer.shift();
    }

    if (!this.lastFrame || this.stableMidiBuffer.length < 3) {
      return frequency;
    }

    const averageMidi = this.stableMidiBuffer.reduce((sum, value) => sum + value, 0) / this.stableMidiBuffer.length;
    const maxDeviationCents = Math.max(...this.stableMidiBuffer.map((value) => Math.abs(value - averageMidi) * 100));
    const noteChanged = Math.round(averageMidi) !== Math.round(this.lastFrame.midi);

    if (noteChanged && maxDeviationCents > 30) {
      return this.lastFrame.frequency;
    }

    return frequency;
  }
}
