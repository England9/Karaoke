import { PitchDetector as McLeodPitchDetector } from 'pitchy';

import type { PitchFrame } from '../types/song';
import { centsBetween, hzToMidi, midiToHz, midiToNoteName } from '../utils/music';

export interface PitchDetectorOptions {
  fftSize?: number;
  clarityThreshold?: number;
  minVolumeDecibels?: number;
  minFrequency?: number;
  maxStableFrequency?: number;
}

export class RealtimePitchDetector {
  private readonly buffer: Float32Array<ArrayBuffer>;

  private readonly detector: McLeodPitchDetector<Float32Array>;

  private previousFrequency = 0;

  constructor(private readonly options: PitchDetectorOptions = {}) {
    const fftSize = options.fftSize ?? 4096;
    this.buffer = new Float32Array(fftSize) as Float32Array<ArrayBuffer>;
    this.detector = McLeodPitchDetector.forFloat32Array(fftSize);
    this.detector.clarityThreshold = options.clarityThreshold ?? 0.65;
    this.detector.minVolumeDecibels = options.minVolumeDecibels ?? -60;
  }

  readFrame(analyser: AnalyserNode, sampleRate: number): PitchFrame {
    analyser.getFloatTimeDomainData(this.buffer);

    const [rawFrequency, clarity] = this.detector.findPitch(this.buffer, sampleRate);
    const volume = this.getRmsVolume();
    const frequency = this.stabilizeFrequency(rawFrequency);
    const detected = frequency > 0 && clarity >= (this.options.clarityThreshold ?? 0.65);
    const midi = detected ? hzToMidi(frequency) : 0;
    const roundedMidi = detected ? Math.round(midi) : 0;
    const targetFrequency = detected ? midiToHz(roundedMidi) : 0;

    if (detected) {
      this.previousFrequency = frequency;
    }

    return {
      frequency: detected ? frequency : 0,
      clarity,
      note: detected ? midiToNoteName(midi) : '--',
      midi: detected ? midi : 0,
      cents: detected ? centsBetween(frequency, targetFrequency) : 0,
      volume,
      timestamp: performance.now(),
    };
  }

  reset(): void {
    this.previousFrequency = 0;
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
    const candidates = [rawFrequency, rawFrequency / 2, rawFrequency * 2]
      .filter((frequency) => frequency >= minFrequency && frequency <= maxStableFrequency)
      .map((frequency) => ({
        frequency,
        score: this.previousFrequency
          ? Math.abs(Math.log2(frequency / this.previousFrequency))
          : frequency > maxStableFrequency * 0.92
            ? 0.2
            : 0,
      }))
      .sort((a, b) => a.score - b.score);

    return candidates[0]?.frequency ?? rawFrequency;
  }
}
