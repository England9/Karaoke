import type { SongChart, SongNote } from '../types/song';
import { noteNameToHz } from '../utils/music';

type RawSongNote = Omit<SongNote, 'frequency'>;

type RawSongChart = Omit<SongChart, 'notes'> & {
  notes: RawSongNote[];
};

export interface SongChartLookup {
  chart: SongChart | null;
  query: string;
  source: 'local-demo-database' | 'remote-json-database' | 'not-found';
}

const localCharts: RawSongChart[] = [
  {
    songTitle: 'Neon Skyline',
    artist: 'Vocal Hero Demo',
    bpm: 120,
    key: 'C',
    aliases: ['neon skyline', 'vocal hero demo', 'demo track'],
    source: 'Local demo database',
    notes: [
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
    ],
  },
  {
    songTitle: 'Example Song',
    artist: 'Cursor Prompt Demo',
    bpm: 120,
    key: 'C',
    aliases: ['example song', 'hello', 'hello example'],
    source: 'Local demo database',
    notes: [
      { time: 0.5, duration: 1.0, note: 'C4', lyric: 'Hel' },
      { time: 1.5, duration: 0.5, note: 'E4', lyric: 'lo' },
      { time: 2.2, duration: 0.75, note: 'G4', lyric: 'from' },
      { time: 3.05, duration: 0.95, note: 'E4', lyric: 'the' },
      { time: 4.1, duration: 1.2, note: 'D4', lyric: 'stage' },
    ],
  },
  {
    songTitle: 'Vocal Warmup',
    artist: 'Practice Library',
    bpm: 90,
    key: 'C',
    aliases: ['vocal warmup', 'warmup', 'warm up', 'scale practice'],
    source: 'Local demo database',
    notes: [
      { time: 0.4, duration: 0.65, note: 'C4', lyric: 'Ma' },
      { time: 1.1, duration: 0.65, note: 'D4', lyric: 'me' },
      { time: 1.8, duration: 0.65, note: 'E4', lyric: 'mi' },
      { time: 2.5, duration: 0.65, note: 'F4', lyric: 'mo' },
      { time: 3.2, duration: 0.8, note: 'G4', lyric: 'mu' },
      { time: 4.2, duration: 0.65, note: 'F4', lyric: 'mo' },
      { time: 4.9, duration: 0.65, note: 'E4', lyric: 'mi' },
      { time: 5.6, duration: 0.65, note: 'D4', lyric: 'me' },
      { time: 6.3, duration: 1.0, note: 'C4', lyric: 'ma' },
    ],
  },
];

export const songDatabase = localCharts.map(hydrateChart);

export async function resolveSongChart(fileNameOrTitle: string): Promise<SongChartLookup> {
  const query = cleanSongQuery(fileNameOrTitle);
  const localMatch = findLocalSongChart(query);

  if (localMatch) {
    return {
      chart: localMatch,
      query,
      source: 'local-demo-database',
    };
  }

  const remoteMatch = await fetchRemoteSongChart(query);

  if (remoteMatch) {
    return {
      chart: remoteMatch,
      query,
      source: 'remote-json-database',
    };
  }

  return {
    chart: null,
    query,
    source: 'not-found',
  };
}

export function getSongDuration(chart: SongChart): number {
  return Math.max(...chart.notes.map((note) => note.time + note.duration), 0) + 1.2;
}

function findLocalSongChart(query: string): SongChart | null {
  const slug = toSongSlug(query);

  return (
    songDatabase.find((chart) => {
      const searchable = [chart.songTitle, chart.artist, ...(chart.aliases ?? [])].map(toSongSlug);
      return searchable.some((value) => value === slug || slug.includes(value) || value.includes(slug));
    }) ?? null
  );
}

async function fetchRemoteSongChart(query: string): Promise<SongChart | null> {
  const slug = toSongSlug(query);

  if (!slug) {
    return null;
  }

  try {
    const response = await fetch(`/song-database/${slug}.json`);

    if (!response.ok) {
      return null;
    }

    return hydrateChart((await response.json()) as RawSongChart);
  } catch {
    return null;
  }
}

function hydrateChart(chart: RawSongChart): SongChart {
  return {
    ...chart,
    notes: chart.notes.map((note) => ({
      ...note,
      frequency: noteNameToHz(note.note),
    })),
  };
}

function cleanSongQuery(fileNameOrTitle: string): string {
  return fileNameOrTitle
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b(official|audio|video|lyrics|karaoke|instrumental|remaster(ed)?|mp3|wav)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSongSlug(value: string): string {
  return cleanSongQuery(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
