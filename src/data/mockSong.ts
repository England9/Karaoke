import type { SongChart } from '../types/song';
import { noteNameToHz } from '../utils/music';

const rawNotes = [
  { time: 0.5, duration: 0.75, note: 'C4', lyric: 'Wake' },
  { time: 1.3, duration: 0.65, note: 'D4', lyric: 'the' },
  { time: 2.0, duration: 0.9, note: 'E4', lyric: 'neon' },
  { time: 3.0, duration: 0.7, note: 'G4', lyric: 'sky' },
  { time: 4.0, duration: 0.8, note: 'A4', lyric: 'Sing' },
  { time: 4.9, duration: 0.65, note: 'G4', lyric: 'it' },
  { time: 5.6, duration: 0.85, note: 'E4', lyric: 'back' },
  { time: 6.55, duration: 1.1, note: 'D4', lyric: 'tonight' },
  { time: 8.0, duration: 0.7, note: 'E4', lyric: 'Hold' },
  { time: 8.8, duration: 0.7, note: 'G4', lyric: 'that' },
  { time: 9.55, duration: 0.95, note: 'A4', lyric: 'violet' },
  { time: 10.6, duration: 1.25, note: 'C5', lyric: 'light' },
];

export const mockSong: SongChart = {
  songTitle: 'Neon Skyline',
  artist: 'Vocal Hero Demo',
  bpm: 120,
  key: 'C',
  notes: rawNotes.map((note) => ({
    ...note,
    frequency: noteNameToHz(note.note),
  })),
};

export const mockSongDuration = 13;
