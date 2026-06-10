import { PitchDetector as McLeodPitchDetector } from 'pitchy';

import type { PitchFrame } from '../types/song';
import { centsBetween, hzToMidi, midiToHz, midiToNoteName } from '../utils/music';

export interface PitchDetectorOptions {
  fftSize?: number;
  clarityThreshold?: number;
  minVolumeDecibels?: number;
}

export class RealtimePitchDetector {
  private readonly buffer: Float32Array;

  private readonly detector: McLeodPitchDetector<Float32Array>;

  constructor(private readonly options: PitchDetectorOptions = {}) {
    const fftSize = options.fftSize ?? 4096;
    this.buffer = new Float32Array(fftSize);
    this.detector = McLeodPitchDetector.forFloat32Array(fftSize);
    this.detector.clarityThreshold = options.clarityThreshold ?? 0.86;
    this.detector.minVolumeDecibels = options.minVolumeDecibels ?? -48;
  }

  readFrame(analyser: AnalyserNode, sampleRate: number): PitchFrame {
    analyser.getFloatTimeDomainData(this.buffer);

    const [frequency, clarity] = this.detector.findPitch(this.buffer, sampleRate);
    const volume = this.getRmsVolume();
    const detected = frequency > 0 && clarity >= (this.options.clarityThreshold ?? 0.86);
    const midi = detected ? hzToMidi(frequency) : 0;
    const roundedMidi = detected ? Math.round(midi) : 0;
    const targetFrequency = detected ? midiToHz(roundedMidi) : 0;

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

  private getRmsVolume(): number {
    let sum = 0;

    for (const sample of this.buffer) {
      sum += sample * sample;
    }

    return Math.sqrt(sum / this.buffer.length);
  }
}
