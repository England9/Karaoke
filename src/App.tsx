import {
  Activity,
  AudioLines,
  Database,
  Download,
  Gauge,
  Mic,
  MicOff,
  Music2,
  Pause,
  Play,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  Waves,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { KaraokePlayer } from './components/KaraokePlayer';
import { mockSong } from './data/mockSong';
import { getSongDuration, resolveSongChart, songDatabase, type SongChartLookup } from './data/songDatabase';
import { useAudioEngine } from './hooks/useAudioEngine';
import type { GameScore, ScaleMode, SongChart } from './types/song';
import { audioBufferToWavBlob } from './utils/audioBuffer';

const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const emptyScore: GameScore = {
  hits: 0,
  attempts: 0,
  combo: 0,
  bestCombo: 0,
  score: 0,
  accuracy: 0,
  lastGrade: 'silent',
};

function App() {
  const {
    settings,
    state,
    initialize,
    stopCalibration,
    updateSettings,
    loadSong,
    playSong,
    pauseSong,
    stopSong,
    startRecording,
    stopRecording,
  } = useAudioEngine();
  const [score, setScore] = useState<GameScore>(emptyScore);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoTime, setDemoTime] = useState(0);
  const [activeChart, setActiveChart] = useState<SongChart>(mockSong);
  const [chartLookup, setChartLookup] = useState<SongChartLookup>({
    chart: mockSong,
    query: mockSong.songTitle,
    source: 'demo-database',
    lyricsSource: 'Demo chart',
    noteSource: 'Demo chart',
  });
  const demoStartRef = useRef(0);
  const demoFrameRef = useRef<number | null>(null);
  const lastRecording = state.lastRecording;
  const processedBlob = useMemo(
    () => (lastRecording?.processedBuffer ? audioBufferToWavBlob(lastRecording.processedBuffer) : null),
    [lastRecording],
  );
  const rawRecordingUrl = useObjectUrl(lastRecording?.rawBlob ?? null);
  const processedRecordingUrl = useObjectUrl(processedBlob);
  const chartDuration = getSongDuration(activeChart);
  const gameTime = state.loadedSongName ? state.songTime : demoTime;
  const activeNote = activeChart.notes.find((note) => gameTime >= note.time && gameTime <= note.time + note.duration);
  const scoreChanged = useCallback((nextScore: GameScore) => setScore(nextScore), []);

  useEffect(() => {
    if (!demoPlaying || state.loadedSongName) {
      if (demoFrameRef.current !== null) {
        cancelAnimationFrame(demoFrameRef.current);
        demoFrameRef.current = null;
      }
      return undefined;
    }

    const tick = () => {
      const nextTime = (performance.now() - demoStartRef.current) / 1000;

      if (nextTime >= chartDuration) {
        setDemoPlaying(false);
        setDemoTime(0);
        return;
      }

      setDemoTime(nextTime);
      demoFrameRef.current = requestAnimationFrame(tick);
    };

    demoFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (demoFrameRef.current !== null) {
        cancelAnimationFrame(demoFrameRef.current);
      }
    };
  }, [chartDuration, demoPlaying, state.loadedSongName]);

  const handleInitialize = async () => {
    await initialize();
  };

  const handleStopCalibration = () => {
    stopCalibration();
    setDemoPlaying(false);
    setDemoTime(0);
    setScore(emptyScore);
  };

  const handlePlay = async () => {
    if (!state.initialized) {
      await initialize();
    }

    if (state.loadedSongName) {
      playSong();
      return;
    }

    demoStartRef.current = performance.now() - demoTime * 1000;
    setDemoPlaying(true);
  };

  const handlePause = () => {
    if (state.loadedSongName) {
      pauseSong();
      return;
    }

    setDemoPlaying(false);
  };

  const handleStop = () => {
    if (state.loadedSongName) {
      stopSong();
    }

    setDemoPlaying(false);
    setDemoTime(0);
    setScore(emptyScore);
  };

  const handleSongUpload = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    if (!state.initialized) {
      await initialize();
    }

    const audioBuffer = await loadSong(file);
    const lookup = await resolveSongChart(file.name, audioBuffer);
    setChartLookup(lookup);

    if (lookup.chart) {
      setActiveChart(lookup.chart);
      updateSettings({ key: lookup.chart.key });
    }

    setDemoPlaying(false);
    setDemoTime(0);
    setScore(emptyScore);
  };

  const handleRecord = async () => {
    if (!state.initialized) {
      await initialize();
    }

    if (state.recording) {
      await stopRecording();
    } else {
      startRecording();
    }
  };

  const handleMonitorToggle = async (outputEnabled: boolean) => {
    if (outputEnabled && !state.initialized) {
      await initialize();
    }

    updateSettings({ outputEnabled });
  };

  const handleEchoToggle = async (echoEnabled: boolean) => {
    if (echoEnabled && !state.initialized) {
      await initialize();
    }

    updateSettings({ echoEnabled, outputEnabled: echoEnabled ? true : settings.outputEnabled });
  };

  const handleReverbToggle = async (reverbEnabled: boolean) => {
    if (reverbEnabled && !state.initialized) {
      await initialize();
    }

    updateSettings({ reverbEnabled, outputEnabled: reverbEnabled ? true : settings.outputEnabled });
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#03040a] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(217,70,239,0.18),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(124,58,237,0.18),transparent_35%)]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-[2rem] border border-white/10 bg-slate-950/70 p-6 shadow-[0_0_80px_rgba(34,211,238,0.12)] backdrop-blur-2xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.32em] text-cyan-200">
              <Sparkles className="h-4 w-4" />
              Vocal Hero
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
              Cyberpunk singing coach.
              <span className="block bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-violet-300 bg-clip-text text-transparent">
                Real-time karaoke game.
              </span>
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Pitchy-powered live note detection, Web Audio routing, Tone.js vocal effects, recording polish,
              and a scrolling note highway with synced lyrics and combo scoring.
            </p>
          </div>
          <div className="grid min-w-[260px] grid-cols-2 gap-3">
            <Stat label="Note" value={state.pitchFrame?.note ?? '--'} tone="cyan" />
            <Stat label="Cents" value={`${Math.round(state.pitchFrame?.cents ?? 0)}`} tone="magenta" />
            <Stat label="Accuracy" value={`${score.accuracy}%`} tone="violet" />
            <Stat label="Combo" value={`${score.combo}x`} tone="green" />
          </div>
        </header>

        {!state.initialized && (
          <section className="neon-card rounded-[2rem] p-6">
            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.35em] text-fuchsia-300">Calibration bay</p>
                <h2 className="mt-3 text-3xl font-black text-white">Initialize low-latency microphone analysis</h2>
                <p className="mt-3 text-slate-300">
                  Browsers require audio contexts to start from a user action. Run calibration to request the mic,
                  start the analyser, and prepare the compressor, pitch shifter, echo, and reverb chain.
                </p>
                {state.error && (
                  <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {state.error}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleInitialize}
                disabled={state.initializing}
                className="neon-button flex items-center justify-center gap-3 rounded-3xl bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500 px-6 py-5 text-lg font-black text-white transition-all duration-300 hover:scale-[1.02] disabled:cursor-wait disabled:opacity-60"
              >
                <Mic className="h-6 w-6" />
                {state.initializing ? 'Calibrating...' : 'Start mic calibration'}
              </button>
            </div>
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <div className="neon-card rounded-[2rem] p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Note highway</p>
                <h2 className="text-2xl font-black text-white">{activeChart.songTitle}</h2>
                <p className="text-sm text-slate-400">
                  {activeChart.artist} | {activeChart.bpm} BPM | {activeChart.key}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <TransportButton icon={<Play />} label="Play" onClick={handlePlay} />
                <TransportButton icon={<Pause />} label="Pause" onClick={handlePause} />
                <TransportButton icon={<Square />} label="Stop" onClick={handleStop} />
              </div>
            </div>
            <KaraokePlayer
              chart={activeChart}
              currentTime={gameTime}
              pitchFrame={state.pitchFrame}
              latencyCompensationMs={settings.latencyCompensationMs}
              onScoreChange={scoreChanged}
            />
          </div>

          <aside className="flex flex-col gap-4">
            <Panel title="Live pitch monitor" icon={<Activity className="h-5 w-5" />}>
              <div className="grid grid-cols-2 gap-3">
                <Readout label="Detected Hz" value={state.pitchFrame?.frequency ? state.pitchFrame.frequency.toFixed(1) : '0.0'} />
                <Readout label="Clarity" value={`${Math.round((state.pitchFrame?.clarity ?? 0) * 100)}%`} />
                <Readout label="Target" value={activeNote?.note ?? '--'} />
                <Readout label="Grade" value={score.lastGrade.toUpperCase()} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-violet-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, (state.pitchFrame?.volume ?? 0) * 800)}%` }}
                />
              </div>
              {state.initialized && (
                <button
                  type="button"
                  onClick={handleStopCalibration}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 transition-all duration-300 hover:bg-rose-400/20"
                >
                  <MicOff className="h-4 w-4" />
                  Stop mic calibration
                </button>
              )}
            </Panel>

            <Panel title="Song import" icon={<Upload className="h-5 w-5" />}>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-300/30 bg-cyan-300/5 p-5 text-center transition-all duration-300 hover:border-fuchsia-300/50 hover:bg-fuchsia-300/10">
                <Music2 className="mb-2 h-8 w-8 text-cyan-200" />
                <span className="text-sm font-bold text-white">Upload MP3/WAV backing track</span>
                <span className="mt-1 text-xs text-slate-400">
                  {state.loadedSongName ?? 'Using built-in demo chart until a file is loaded'}
                </span>
                <input
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
                  className="sr-only"
                  onChange={(event) => void handleSongUpload(event.target.files?.[0])}
                />
              </label>
              <Toggle
                label="Simulated karaoke cut"
                enabled={settings.karaokeCut}
                onChange={(enabled) => updateSettings({ karaokeCut: enabled })}
              />
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm">
                <p className="flex items-center gap-2 font-black text-white">
                  <Database className="h-4 w-4 text-cyan-200" />
                  Song database
                </p>
                <p className="mt-2 text-slate-300">
                  {chartLookup.chart
                    ? `${chartLookup.message ?? `Loaded "${chartLookup.chart.songTitle}".`}`
                    : `No lyrics match found for "${chartLookup.query}", and audio analysis could not build a chart.`}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Lyrics: {chartLookup.lyricsSource ?? 'none'} | Notes: {chartLookup.noteSource ?? 'none'}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Demo fallback entries: {songDatabase.map((song) => song.songTitle).join(', ')}
                </p>
              </div>
            </Panel>
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Panel title="Autotune engine" icon={<Zap className="h-5 w-5" />}>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Key"
                value={settings.key}
                options={keys}
                onChange={(key) => updateSettings({ key })}
              />
              <Select
                label="Scale"
                value={settings.scale}
                options={['major', 'minor', 'chromatic']}
                onChange={(scale) => updateSettings({ scale: scale as ScaleMode })}
              />
            </div>
            <Slider
              label="Correction strength"
              value={settings.correctionStrength}
              min={0}
              max={100}
              suffix="%"
              onChange={(correctionStrength) => updateSettings({ correctionStrength })}
            />
            <Toggle
              label="Monitor processed vocal output"
              enabled={settings.outputEnabled}
              onChange={(outputEnabled) => void handleMonitorToggle(outputEnabled)}
            />
          </Panel>

          <Panel title="Vocal FX module" icon={<Waves className="h-5 w-5" />}>
            <Toggle
              label="Vocal isolation mode"
              enabled={settings.vocalIsolation}
              onChange={(vocalIsolation) => updateSettings({ vocalIsolation })}
            />
            <Toggle
              label="Echo mode"
              enabled={settings.echoEnabled}
              onChange={(echoEnabled) => void handleEchoToggle(echoEnabled)}
            />
            <Slider
              label="Delay time"
              value={settings.echoDelay}
              min={0.05}
              max={0.7}
              step={0.01}
              suffix="s"
              onChange={(echoDelay) => updateSettings({ echoDelay })}
            />
            <Slider
              label="Feedback"
              value={settings.echoFeedback}
              min={0}
              max={0.55}
              step={0.01}
              suffix=""
              onChange={(echoFeedback) => updateSettings({ echoFeedback })}
            />
            <Toggle
              label="Room reverb"
              enabled={settings.reverbEnabled}
              onChange={(reverbEnabled) => void handleReverbToggle(reverbEnabled)}
            />
          </Panel>

          <Panel title="Record mode" icon={<Radio className="h-5 w-5" />}>
            <button
              type="button"
              onClick={() => void handleRecord()}
              className={`flex w-full items-center justify-center gap-3 rounded-3xl px-5 py-4 font-black text-white transition-all duration-300 ${
                state.recording
                  ? 'bg-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.35)]'
                  : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 shadow-[0_0_30px_rgba(217,70,239,0.28)]'
              }`}
            >
              <AudioLines className="h-5 w-5" />
              {state.recording ? 'Stop and post-process' : 'Record raw vocal'}
            </button>
            <Slider
              label="Latency compensation"
              value={settings.latencyCompensationMs}
              min={-250}
              max={250}
              step={5}
              suffix="ms"
              onChange={(latencyCompensationMs) => updateSettings({ latencyCompensationMs })}
            />
            <div className="grid gap-2">
              {rawRecordingUrl && (
                <DownloadLink href={rawRecordingUrl} label="Download raw take" fileName="vocal-hero-raw.webm" />
              )}
              {processedRecordingUrl && (
                <DownloadLink href={processedRecordingUrl} label="Download post-processed WAV" fileName="vocal-hero-polished.wav" />
              )}
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 rounded-[2rem] border border-violet-300/15 bg-slate-950/60 p-5 text-sm text-slate-300 md:grid-cols-3">
          <InfoBadge icon={<Gauge />} title="Pitch detection">
            McLeod pitch method via pitchy reads a 4096-sample analyser buffer at animation-frame cadence.
          </InfoBadge>
          <InfoBadge icon={<SlidersHorizontal />} title="Signal flow">
            Mic to vocal-isolation filters, analyser, compressor, gated monitor, echo/reverb sends, master gain, and destination.
          </InfoBadge>
          <InfoBadge icon={<Sparkles />} title="Scoring">
            Perfect within 10 cents, good within 25 cents, off-key outside 50 cents, with combo multiplier.
          </InfoBadge>
        </section>
      </div>
    </main>
  );
}

function useObjectUrl(blob: Blob | null) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  return url;
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="neon-card rounded-[2rem] p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl bg-cyan-300/10 p-2 text-cyan-200">{icon}</div>
        <h3 className="font-black text-white">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'magenta' | 'violet' | 'green' }) {
  const tones = {
    cyan: 'text-cyan-200 shadow-cyan-500/20',
    magenta: 'text-fuchsia-200 shadow-fuchsia-500/20',
    violet: 'text-violet-200 shadow-violet-500/20',
    green: 'text-emerald-200 shadow-emerald-500/20',
  };

  return (
    <div className={`rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function TransportButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 transition-all duration-300 hover:border-fuchsia-300/40 hover:bg-fuchsia-300/10"
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
        {label}
        <span className="text-cyan-200">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function Toggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition-all duration-300 hover:border-cyan-300/40"
    >
      <span className="text-sm font-bold text-slate-100">{label}</span>
      <span className={`h-6 w-11 rounded-full p-1 transition-all duration-300 ${enabled ? 'bg-cyan-400' : 'bg-slate-700'}`}>
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-all duration-300 ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 font-bold text-white outline-none transition-all duration-300 focus:border-cyan-300"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function DownloadLink({ href, label, fileName }: { href: string; label: string; fileName: string }) {
  return (
    <a
      href={href}
      download={fileName}
      className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100 transition-all duration-300 hover:bg-emerald-300/20"
    >
      <Download className="h-4 w-4" />
      {label}
    </a>
  );
}

function InfoBadge({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 text-violet-200 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      <div>
        <h4 className="font-black text-white">{title}</h4>
        <p className="mt-1 leading-6">{children}</p>
      </div>
    </div>
  );
}

export default App;
