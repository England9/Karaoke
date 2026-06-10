import { PitchDetector } from 'pitchy';
import { parseBlob } from 'music-metadata-browser';

import type { SongChart, SongNote } from '../types/song';
import { clamp, hzToMidi, midiToNoteName, noteNameToHz } from '../utils/music';
import { trackDatabase, trackToSongChart, type TrackDatabaseEntry } from './tracks';

type RawSongNote = Omit<SongNote, 'frequency'>;

type RawSongChart = Omit<SongChart, 'notes'> & {
  notes: RawSongNote[];
};

export interface SongChartLookup {
  chart: SongChart | null;
  query: string;
  source: 'internal-track-database' | 'demo-database' | 'lrclib-audio-analysis' | 'audio-analysis' | 'not-found';
  lyricsSource?: string;
  noteSource?: string;
  message?: string;
}

interface LyricsSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface LyricLine {
  time: number;
  text: string;
}

interface SongIdentity {
  title: string;
  artist?: string;
  source: 'file-tags' | 'itunes-search' | 'filename';
}

interface ITunesSearchResult {
  artistName?: string;
  trackName?: string;
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

export async function resolveSongChart(
  fileNameOrTitle: string,
  audioBuffer?: AudioBuffer,
  file?: File,
): Promise<SongChartLookup> {
  const query = cleanSongQuery(fileNameOrTitle);
  const identity = await resolveSongIdentity(query, file);
  const trackMatch = findTrackDatabaseMatch(identity, query);

  if (trackMatch) {
    return {
      chart: trackToSongChart(trackMatch),
      query,
      source: 'internal-track-database',
      lyricsSource: 'Internal synced timeline',
      noteSource: 'Internal melody timeline',
      message: `Matched ${trackMatch.artist} - ${trackMatch.title} from the internal track database using ${identity.source.replace('-', ' ')} metadata.`,
    };
  }

  const lyricQuery = [identity.artist, identity.title].filter(Boolean).join(' ');
  const remoteLyrics = await fetchLyricsFromLrcLib(lyricQuery || query);

  if (audioBuffer) {
    const chart = buildChartFromAudio(audioBuffer, query, remoteLyrics);

    return {
      chart,
      query,
      source: remoteLyrics ? 'lrclib-audio-analysis' : 'audio-analysis',
      lyricsSource: remoteLyrics ? `LRCLIB: ${remoteLyrics.artistName} - ${remoteLyrics.trackName}` : 'Generated timing placeholders',
      noteSource: 'Uploaded audio pitch analysis',
      message: remoteLyrics
        ? `Identified by ${identity.source.replace('-', ' ')} as ${identity.artist ? `${identity.artist} - ` : ''}${identity.title}. Loaded lyrics for ${remoteLyrics.artistName} - ${remoteLyrics.trackName}; notes were extracted from the uploaded audio.`
        : `Identified by ${identity.source.replace('-', ' ')} as ${identity.artist ? `${identity.artist} - ` : ''}${identity.title}. No public lyrics match was found; notes were extracted from audio and placeholder lyrics were generated.`,
    };
  }

  const localMatch = findLocalSongChart(query);
  if (localMatch) {
    return {
      chart: localMatch,
      query,
      source: 'demo-database',
      lyricsSource: 'Demo chart',
      noteSource: 'Demo chart',
    };
  }

  return {
    chart: null,
    query,
    source: 'not-found',
  };
}

async function resolveSongIdentity(query: string, file?: File): Promise<SongIdentity> {
  const taggedIdentity = file ? await readFileTags(file) : null;

  if (taggedIdentity?.title) {
    return {
      title: taggedIdentity.title,
      artist: taggedIdentity.artist,
      source: 'file-tags',
    };
  }

  const iTunesIdentity = await fetchITunesIdentity(query);

  if (iTunesIdentity) {
    return iTunesIdentity;
  }

  return {
    title: titleCase(query),
    source: 'filename',
  };
}

function findTrackDatabaseMatch(identity: SongIdentity, fallbackQuery: string): TrackDatabaseEntry | null {
  const candidates = [
    identity.title,
    identity.artist ? `${identity.artist} ${identity.title}` : '',
    fallbackQuery,
  ].filter(Boolean);

  return (
    trackDatabase.find((track) => {
      const searchable = [track.title, track.artist, `${track.artist} ${track.title}`, ...track.aliases].map(toSongSlug);

      return candidates.some((candidate) => {
        const candidateSlug = toSongSlug(candidate);
        return searchable.some((value) => value === candidateSlug || value.includes(candidateSlug) || candidateSlug.includes(value));
      });
    }) ?? null
  );
}

async function fetchITunesIdentity(query: string): Promise<SongIdentity | null> {
  if (!query) {
    return null;
  }

  try {
    const url = new URL('https://itunes.apple.com/search');
    url.searchParams.set('term', query);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', '5');

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { results?: ITunesSearchResult[] };
    const match = chooseBestITunesMatch(data.results ?? [], query);

    if (!match?.trackName) {
      return null;
    }

    return {
      title: match.trackName,
      artist: match.artistName,
      source: 'itunes-search',
    };
  } catch {
    return null;
  }
}

function chooseBestITunesMatch(results: ITunesSearchResult[], query: string): ITunesSearchResult | null {
  const querySlug = toSongSlug(query);

  return (
    results
      .filter((result) => result.trackName)
      .map((result, index) => {
        const titleSlug = toSongSlug(result.trackName ?? '');
        const exactTitle = titleSlug === querySlug ? 10 : 0;
        const containsTitle = titleSlug.includes(querySlug) || querySlug.includes(titleSlug) ? 4 : 0;

        return {
          result,
          score: exactTitle + containsTitle - index * 0.2,
        };
      })
      .sort((a, b) => b.score - a.score)[0]?.result ?? null
  );
}

async function readFileTags(file: File): Promise<{ title?: string; artist?: string } | null> {
  try {
    const metadata = await parseBlob(file, {
      duration: false,
      skipCovers: true,
      skipPostHeaders: true,
    });
    const title = metadata.common.title?.trim();
    const artist = metadata.common.artist?.trim() || metadata.common.artists?.[0]?.trim();

    return title || artist ? { title, artist } : null;
  } catch {
    return null;
  }
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

async function fetchLyricsFromLrcLib(query: string): Promise<LyricsSearchResult | null> {
  if (!query) {
    return null;
  }

  try {
    const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const results = (await response.json()) as LyricsSearchResult[];
    return chooseBestLyricsMatch(results, query);
  } catch {
    return null;
  }
}

function chooseBestLyricsMatch(results: LyricsSearchResult[], query: string): LyricsSearchResult | null {
  const querySlug = toSongSlug(query);
  const scored = results
    .filter((result) => !result.instrumental && (result.syncedLyrics || result.plainLyrics))
    .map((result) => {
      const titleSlug = toSongSlug(result.trackName);
      const artistSlug = toSongSlug(result.artistName);
      const exactTitle = titleSlug === querySlug ? 10 : 0;
      const containsTitle = titleSlug.includes(querySlug) || querySlug.includes(titleSlug) ? 5 : 0;
      const lyricBonus = result.syncedLyrics ? 2 : 1;

      return {
        result,
        score: exactTitle + containsTitle + lyricBonus - Math.abs(titleSlug.length - querySlug.length) * 0.02 - artistSlug.length * 0.001,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.result ?? null;
}

function buildChartFromAudio(audioBuffer: AudioBuffer, query: string, lyrics: LyricsSearchResult | null): SongChart {
  const notes = extractNotesFromAudio(audioBuffer);
  const lyricLines = lyrics ? parseLyricLines(lyrics) : [];
  const assignedNotes = assignLyrics(notes, lyricLines, query);
  const title = lyrics?.trackName || titleCase(query);
  const artist = lyrics?.artistName || 'Uploaded Song';

  return {
    songTitle: title,
    artist,
    bpm: estimateBpm(assignedNotes),
    key: estimateKey(assignedNotes),
    aliases: [query, title, `${artist} ${title}`],
    source: lyrics ? 'LRCLIB lyrics + uploaded audio analysis' : 'Uploaded audio analysis',
    notes: assignedNotes,
  };
}

function extractNotesFromAudio(audioBuffer: AudioBuffer): SongNote[] {
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = 4096;
  const hopSize = Math.floor(sampleRate * 0.18);
  const detector = PitchDetector.forFloat32Array(windowSize);
  const scratch = new Float32Array(windowSize) as Float32Array<ArrayBuffer>;
  const points: Array<{ time: number; midi: number; note: string; frequency: number; volume: number }> = [];
  const maxSamples = Math.min(audioBuffer.length, sampleRate * 240);

  detector.clarityThreshold = 0.58;
  detector.minVolumeDecibels = -50;

  for (let offset = 0; offset + windowSize < maxSamples; offset += hopSize) {
    let energy = 0;

    for (let index = 0; index < windowSize; index += 1) {
      const sample = getVocalBandSample(audioBuffer, offset + index);
      scratch[index] = sample;
      energy += sample * sample;
    }

    const volume = Math.sqrt(energy / windowSize);

    if (volume < 0.012) {
      continue;
    }

    const [rawFrequency, clarity] = detector.findPitch(scratch, sampleRate);
    const frequency = normalizeVocalFrequency(rawFrequency);

    if (!frequency || clarity < 0.58) {
      continue;
    }

    const midi = Math.round(hzToMidi(frequency));

    if (midi < 36 || midi > 84) {
      continue;
    }

    points.push({
      time: offset / sampleRate,
      midi,
      note: midiToNoteName(midi),
      frequency: noteNameToHz(midiToNoteName(midi)),
      volume,
    });
  }

  return groupPitchPoints(points, audioBuffer.duration);
}

function getVocalBandSample(audioBuffer: AudioBuffer, index: number): number {
  const left = audioBuffer.getChannelData(0)[index] ?? 0;
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1)[index] ?? 0 : left;
  const center = (left + right) * 0.5;
  const side = (left - right) * 0.18;

  return center - side;
}

function normalizeVocalFrequency(rawFrequency: number): number {
  if (!rawFrequency) {
    return 0;
  }

  let frequency = rawFrequency;

  while (frequency > 560) {
    frequency /= 2;
  }

  while (frequency < 80) {
    frequency *= 2;
  }

  return frequency >= 80 && frequency <= 560 ? frequency : 0;
}

function groupPitchPoints(
  points: Array<{ time: number; midi: number; note: string; frequency: number; volume: number }>,
  duration: number,
): SongNote[] {
  if (!points.length) {
    return createFallbackNotes(duration);
  }

  const notes: SongNote[] = [];
  let start = points[0];
  let previous = points[0];
  const bucket: number[] = [points[0].midi];

  for (const point of points.slice(1)) {
    const samePhrase = point.time - previous.time <= 0.42 && Math.abs(point.midi - previous.midi) <= 1;

    if (samePhrase) {
      bucket.push(point.midi);
      previous = point;
      continue;
    }

    notes.push(createNoteFromBucket(start.time, previous.time, bucket));
    start = point;
    previous = point;
    bucket.length = 0;
    bucket.push(point.midi);
  }

  notes.push(createNoteFromBucket(start.time, previous.time, bucket));

  return notes
    .filter((note) => note.duration >= 0.16)
    .slice(0, 500);
}

function createNoteFromBucket(startTime: number, endTime: number, bucket: number[]): SongNote {
  const midi = Math.round(bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
  const noteName = midiToNoteName(midi);

  return {
    time: Number(startTime.toFixed(2)),
    duration: Number(clamp(endTime - startTime + 0.18, 0.18, 2.4).toFixed(2)),
    note: noteName,
    lyric: '...',
    frequency: noteNameToHz(noteName),
  };
}

function createFallbackNotes(duration: number): SongNote[] {
  const notes = ['C4', 'D4', 'E4', 'G4', 'A4', 'G4', 'E4', 'D4'];
  const count = Math.max(8, Math.min(48, Math.floor(duration / 1.2)));

  return Array.from({ length: count }, (_, index) => {
    const note = notes[index % notes.length];
    return {
      time: Number((index * 1.2 + 0.5).toFixed(2)),
      duration: 0.8,
      note,
      lyric: '...',
      frequency: noteNameToHz(note),
    };
  });
}

function parseLyricLines(lyrics: LyricsSearchResult): LyricLine[] {
  if (lyrics.syncedLyrics) {
    return lyrics.syncedLyrics
      .split('\n')
      .map((line) => {
        const match = line.match(/^\[(\d{1,2}):(\d{2}(?:\.\d+)?)][ \t]*(.*)$/);

        if (!match) {
          return null;
        }

        return {
          time: Number(match[1]) * 60 + Number(match[2]),
          text: match[3].trim(),
        };
      })
      .filter((line): line is LyricLine => Boolean(line?.text));
  }

  const plainLines = lyrics.plainLyrics?.split('\n').filter((line) => line.trim()) ?? [];
  const duration = lyrics.duration || plainLines.length * 4 || 120;

  return plainLines.map((line, index) => ({
    time: (duration / Math.max(plainLines.length, 1)) * index,
    text: line.trim(),
  }));
}

function assignLyrics(notes: SongNote[], lyricLines: LyricLine[], query: string): SongNote[] {
  if (!lyricLines.length) {
    const words = titleCase(query).split(/\s+/).filter(Boolean);
    return notes.map((note, index) => ({
      ...note,
      lyric: words[index % Math.max(words.length, 1)] ?? 'Sing',
    }));
  }

  return notes.map((note) => {
    const lineIndex = findLyricLineIndex(lyricLines, note.time);
    const currentLine = lyricLines[lineIndex];
    const nextLine = lyricLines[lineIndex + 1];
    const words = currentLine.text.split(/\s+/).filter(Boolean);
    const lineDuration = Math.max((nextLine?.time ?? note.time + 4) - currentLine.time, 0.5);
    const progress = clamp((note.time - currentLine.time) / lineDuration, 0, 0.999);
    const word = words[Math.floor(progress * words.length)] ?? currentLine.text;

    return {
      ...note,
      lyric: word,
    };
  });
}

function findLyricLineIndex(lines: LyricLine[], time: number): number {
  let selected = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].time <= time) {
      selected = index;
    } else {
      break;
    }
  }

  return selected;
}

function estimateBpm(notes: SongNote[]): number {
  if (notes.length < 4) {
    return 120;
  }

  const gaps = notes.slice(1).map((note, index) => note.time - notes[index].time).filter((gap) => gap > 0.18 && gap < 2);
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(gaps.length, 1);

  return Math.round(clamp(60 / averageGap, 70, 180));
}

function estimateKey(notes: SongNote[]): string {
  const counts = new Map<string, number>();

  for (const note of notes) {
    const pitchClass = note.note.replace(/-?\d+$/, '');
    counts.set(pitchClass, (counts.get(pitchClass) ?? 0) + note.duration);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'C';
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

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function toSongSlug(value: string): string {
  return cleanSongQuery(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
