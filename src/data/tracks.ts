import type { SongChart, SongNote } from '../types/song';
import { noteNameToHz } from '../utils/music';

export interface MelodyTimelineItem {
  startTime: number;
  endTime: number;
  frequency: number;
  noteName: string;
  lyric: string;
}

export interface TrackDatabaseEntry {
  title: string;
  artist: string;
  key: string;
  bpm: number;
  aliases: string[];
  melodyTimeline: MelodyTimelineItem[];
}

const babydollNotes: Array<{ start: number; end: number; note: string; lyric: string }> = [
  { start: 0.7, end: 1.15, note: 'F#4', lyric: 'Intro' },
  { start: 1.2, end: 1.6, note: 'E4', lyric: 'cue' },
  { start: 1.72, end: 2.12, note: 'C#4', lyric: 'Babydoll' },
  { start: 2.25, end: 2.66, note: 'D4', lyric: 'line' },
  { start: 2.78, end: 3.2, note: 'E4', lyric: 'one' },
  { start: 3.34, end: 3.78, note: 'F#4', lyric: 'phrase' },
  { start: 3.9, end: 4.28, note: 'E4', lyric: 'two' },
  { start: 4.4, end: 4.82, note: 'C#4', lyric: 'Babydoll' },
  { start: 5.0, end: 5.44, note: 'B3', lyric: 'verse' },
  { start: 5.58, end: 6.02, note: 'C#4', lyric: 'cue' },
  { start: 6.18, end: 6.62, note: 'E4', lyric: 'hold' },
  { start: 6.76, end: 7.18, note: 'F#4', lyric: 'on' },
  { start: 7.32, end: 7.74, note: 'E4', lyric: 'hook' },
  { start: 7.88, end: 8.32, note: 'D4', lyric: 'lead' },
  { start: 8.48, end: 8.94, note: 'C#4', lyric: 'in' },
  { start: 9.12, end: 9.58, note: 'B3', lyric: 'low' },
  { start: 9.78, end: 10.22, note: 'C#4', lyric: 'lift' },
  { start: 10.4, end: 10.86, note: 'E4', lyric: 'up' },
  { start: 11.04, end: 11.52, note: 'F#4', lyric: 'Babydoll' },
  { start: 11.7, end: 12.18, note: 'A4', lyric: 'hook' },
  { start: 12.34, end: 12.8, note: 'G#4', lyric: 'tag' },
  { start: 12.98, end: 13.44, note: 'F#4', lyric: 'line' },
  { start: 13.62, end: 14.08, note: 'E4', lyric: 'fall' },
  { start: 14.26, end: 14.72, note: 'C#4', lyric: 'back' },
  { start: 15.0, end: 15.46, note: 'B3', lyric: 'verse' },
  { start: 15.62, end: 16.08, note: 'C#4', lyric: 'two' },
  { start: 16.26, end: 16.72, note: 'E4', lyric: 'steady' },
  { start: 16.9, end: 17.36, note: 'F#4', lyric: 'note' },
  { start: 17.54, end: 18.0, note: 'E4', lyric: 'answer' },
  { start: 18.18, end: 18.64, note: 'D4', lyric: 'line' },
  { start: 18.84, end: 19.32, note: 'C#4', lyric: 'Babydoll' },
  { start: 19.52, end: 20.0, note: 'B3', lyric: 'drop' },
  { start: 20.24, end: 20.72, note: 'C#4', lyric: 'rise' },
  { start: 20.9, end: 21.38, note: 'E4', lyric: 'again' },
  { start: 21.58, end: 22.08, note: 'F#4', lyric: 'hook' },
  { start: 22.28, end: 22.78, note: 'A4', lyric: 'high' },
  { start: 22.96, end: 23.44, note: 'G#4', lyric: 'glow' },
  { start: 23.64, end: 24.12, note: 'F#4', lyric: 'down' },
  { start: 24.34, end: 24.82, note: 'E4', lyric: 'to' },
  { start: 25.04, end: 25.54, note: 'C#4', lyric: 'home' },
];

export const trackDatabase: TrackDatabaseEntry[] = [
  {
    title: 'Babydoll',
    artist: 'Dominic Fike',
    key: 'F#',
    bpm: 150,
    aliases: ['babydoll', 'baby doll', 'dominic fike babydoll', 'dominic fike baby doll'],
    melodyTimeline: babydollNotes.map(({ start, end, note, lyric }) => ({
      startTime: start,
      endTime: end,
      frequency: noteNameToHz(note),
      noteName: note,
      lyric,
    })),
  },
];

export function trackToSongChart(track: TrackDatabaseEntry): SongChart {
  return {
    songTitle: track.title,
    artist: track.artist,
    bpm: track.bpm,
    key: track.key,
    aliases: track.aliases,
    source: 'Internal track database',
    notes: track.melodyTimeline.map(timelineItemToSongNote),
  };
}

function timelineItemToSongNote(item: MelodyTimelineItem): SongNote {
  return {
    time: item.startTime,
    duration: Math.max(0.12, item.endTime - item.startTime),
    note: item.noteName,
    lyric: item.lyric,
    frequency: item.frequency,
  };
}
