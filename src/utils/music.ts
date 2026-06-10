import type { FeedbackGrade, ScaleMode } from '../types/song';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const NOTE_INDEX = new Map<string, number>(NOTE_NAMES.map((note, index) => [note, index]));

export function hzToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const note = NOTE_NAMES[((rounded % 12) + 12) % 12];
  return `${note}${octave}`;
}

export function noteNameToMidi(noteName: string): number {
  const match = noteName.trim().match(/^([A-G])(#|b)?(-?\d+)$/i);

  if (!match) {
    throw new Error(`Invalid note name: ${noteName}`);
  }

  const [, rawNote, accidental = '', rawOctave] = match;
  const normalizedNote = `${rawNote.toUpperCase()}${accidental}`;
  const sharpNote = normalizedNote.endsWith('b')
    ? NOTE_NAMES[(NOTE_NAMES.indexOf(normalizedNote[0] as (typeof NOTE_NAMES)[number]) + 11) % 12]
    : normalizedNote;
  const noteIndex = NOTE_INDEX.get(sharpNote);

  if (noteIndex === undefined) {
    throw new Error(`Invalid note name: ${noteName}`);
  }

  return (Number(rawOctave) + 1) * 12 + noteIndex;
}

export function noteNameToHz(noteName: string): number {
  return midiToHz(noteNameToMidi(noteName));
}

export function centsBetween(frequency: number, targetFrequency: number): number {
  if (frequency <= 0 || targetFrequency <= 0) {
    return 0;
  }

  return 1200 * Math.log2(frequency / targetFrequency);
}

export function nearestScaleMidi(midi: number, key = 'C', scale: ScaleMode = 'major'): number {
  const keyIndex = NOTE_INDEX.get(key.toUpperCase()) ?? 0;
  const intervals = SCALE_INTERVALS[scale];
  const baseOctave = Math.floor(midi / 12) - 1;
  let bestMidi = Math.round(midi);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave += 1) {
    for (const interval of intervals) {
      const candidate = (octave + 1) * 12 + keyIndex + interval;
      const distance = Math.abs(candidate - midi);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMidi = candidate;
      }
    }
  }

  return bestMidi;
}

export function getFeedbackGrade(centsOff: number | null): FeedbackGrade {
  if (centsOff === null) {
    return 'silent';
  }

  const absoluteCents = Math.abs(centsOff);

  if (absoluteCents <= 10) {
    return 'perfect';
  }

  if (absoluteCents <= 25) {
    return 'good';
  }

  return 'off-key';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
