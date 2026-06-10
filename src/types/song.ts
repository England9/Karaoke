export type FeedbackGrade = 'perfect' | 'good' | 'off-key' | 'silent';

export type ScaleMode = 'major' | 'minor' | 'chromatic';

export interface SongNote {
  time: number;
  duration: number;
  note: string;
  lyric: string;
  frequency: number;
}

export interface SongChart {
  songTitle: string;
  artist: string;
  bpm: number;
  key: string;
  aliases?: string[];
  source?: string;
  notes: SongNote[];
}

export interface PitchFrame {
  frequency: number;
  clarity: number;
  note: string;
  midi: number;
  cents: number;
  volume: number;
  timestamp: number;
}

export interface GameScore {
  hits: number;
  attempts: number;
  combo: number;
  bestCombo: number;
  score: number;
  accuracy: number;
  lastGrade: FeedbackGrade;
}
