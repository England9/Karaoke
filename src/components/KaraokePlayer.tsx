import { useEffect, useMemo, useRef } from 'react';

import type { GameScore, PitchFrame, SongChart } from '../types/song';
import { centsBetween, clamp, getFeedbackGrade, noteNameToMidi } from '../utils/music';

interface KaraokePlayerProps {
  chart: SongChart;
  currentTime: number;
  pitchFrame: PitchFrame | null;
  latencyCompensationMs: number;
  onScoreChange: (score: GameScore) => void;
}

const initialScore: GameScore = {
  hits: 0,
  attempts: 0,
  combo: 0,
  bestCombo: 0,
  score: 0,
  accuracy: 0,
  lastGrade: 'silent',
};

export function KaraokePlayer({
  chart,
  currentTime,
  pitchFrame,
  latencyCompensationMs,
  onScoreChange,
}: KaraokePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const scoreRef = useRef<GameScore>(initialScore);
  const scoredNotesRef = useRef<Set<number>>(new Set());
  const previousTimeRef = useRef(0);

  const midiRange = useMemo(() => {
    const noteMidis = chart.notes.map((note) => noteNameToMidi(note.note));
    return {
      min: Math.min(...noteMidis) - 5,
      max: Math.max(...noteMidis) + 5,
    };
  }, [chart.notes]);

  useEffect(() => {
    if (currentTime < previousTimeRef.current || currentTime < 0.1) {
      scoreRef.current = initialScore;
      scoredNotesRef.current.clear();
      onScoreChange(initialScore);
    }

    previousTimeRef.current = currentTime;
  }, [currentTime, onScoreChange]);

  function renderCanvas(context: CanvasRenderingContext2D, width: number, height: number) {
    const effectiveTime = currentTime + latencyCompensationMs / 1000;
    const playheadX = 138;
    const pxPerSecond = Math.max(92, width / 7);
    const railTop = 54;
    const railBottom = height - 82;
    const activeNote = chart.notes.find((note) => effectiveTime >= note.time && effectiveTime <= note.time + note.duration);
    const targetCents =
      activeNote && pitchFrame?.frequency
        ? centsBetween(pitchFrame.frequency, activeNote.frequency)
        : null;
    const liveGrade = getFeedbackGrade(targetCents);

    judgeNotes(effectiveTime, targetCents);

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#05070d');
    gradient.addColorStop(0.52, '#111827');
    gradient.addColorStop(1, '#12051f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    drawGrid(context, width, railTop, railBottom, midiRange.min, midiRange.max);
    drawPlayhead(context, playheadX, railTop, railBottom, liveGrade);

    for (const [index, note] of chart.notes.entries()) {
      const noteMidi = noteNameToMidi(note.note);
      const x = playheadX + (note.time - effectiveTime) * pxPerSecond;
      const barWidth = Math.max(36, note.duration * pxPerSecond);

      if (x + barWidth < -40 || x > width + 80) {
        continue;
      }

      const y = pitchToY(noteMidi, railTop, railBottom, midiRange.min, midiRange.max);
      const isActive = activeNote === note;
      const wasHit = scoredNotesRef.current.has(index) && Math.abs(targetCents ?? 999) <= 25;
      const color = isActive
        ? gradeColor(liveGrade)
        : wasHit
          ? '#22c55e'
          : index % 2 === 0
            ? '#22d3ee'
            : '#d946ef';

      context.shadowColor = color;
      context.shadowBlur = isActive ? 26 : 14;
      context.fillStyle = color;
      context.globalAlpha = isActive ? 0.95 : 0.72;
      roundedRect(context, x, y - 11, barWidth, 22, 11);
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.fillStyle = '#f8fafc';
      context.font = '700 13px Inter, system-ui, sans-serif';
      context.fillText(note.note, x + 10, y - 16);
    }

    drawVocalPuck(context, playheadX, railTop, railBottom, liveGrade);
    drawLyrics(context, width, height, effectiveTime, liveGrade);
    drawHud(context, width, liveGrade, targetCents);
  }

  function judgeNotes(effectiveTime: number, targetCents: number | null) {
    chart.notes.forEach((note, index) => {
      const judgeTime = note.time + note.duration * 0.58;

      if (scoredNotesRef.current.has(index) || effectiveTime < judgeTime || effectiveTime > note.time + note.duration + 0.3) {
        return;
      }

      scoredNotesRef.current.add(index);
      const grade = getFeedbackGrade(targetCents);
      const hit = grade === 'perfect' || grade === 'good';
      const nextAttempts = scoreRef.current.attempts + 1;
      const nextHits = scoreRef.current.hits + (hit ? 1 : 0);
      const nextCombo = hit ? scoreRef.current.combo + 1 : 0;
      const bestCombo = Math.max(scoreRef.current.bestCombo, nextCombo);
      const accuracy = nextAttempts ? Math.round((nextHits / nextAttempts) * 100) : 0;
      const score = clamp(Math.round(accuracy + bestCombo * 1.5), 0, 100);

      scoreRef.current = {
        hits: nextHits,
        attempts: nextAttempts,
        combo: nextCombo,
        bestCombo,
        score,
        accuracy,
        lastGrade: grade,
      };
      onScoreChange(scoreRef.current);
    });
  }

  function pitchToY(midi: number, top: number, bottom: number, minMidi: number, maxMidi: number) {
    const normalized = clamp((midi - minMidi) / (maxMidi - minMidi), 0, 1);
    return bottom - normalized * (bottom - top);
  }

  function drawGrid(
    context: CanvasRenderingContext2D,
    width: number,
    top: number,
    bottom: number,
    minMidi: number,
    maxMidi: number,
  ) {
    context.strokeStyle = 'rgba(125, 211, 252, 0.12)';
    context.lineWidth = 1;

    for (let midi = Math.ceil(minMidi); midi <= maxMidi; midi += 2) {
      const y = pitchToY(midi, top, bottom, minMidi, maxMidi);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.strokeStyle = 'rgba(217, 70, 239, 0.18)';
    for (let x = 0; x < width; x += 88) {
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
  }

  function drawPlayhead(
    context: CanvasRenderingContext2D,
    playheadX: number,
    top: number,
    bottom: number,
    grade: GameScore['lastGrade'],
  ) {
    context.strokeStyle = gradeColor(grade);
    context.shadowColor = gradeColor(grade);
    context.shadowBlur = 24;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(playheadX, top);
    context.lineTo(playheadX, bottom);
    context.stroke();
    context.shadowBlur = 0;
  }

  function drawVocalPuck(
    context: CanvasRenderingContext2D,
    playheadX: number,
    top: number,
    bottom: number,
    grade: GameScore['lastGrade'],
  ) {
    const y = pitchFrame?.midi ? pitchToY(pitchFrame.midi, top, bottom, midiRange.min, midiRange.max) : (top + bottom) / 2;
    const color = gradeColor(grade);

    context.shadowColor = color;
    context.shadowBlur = 36;
    context.fillStyle = color;
    context.beginPath();
    context.arc(playheadX, y, 14, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = '#f8fafc';
    context.lineWidth = 2;
    context.stroke();
  }

  function drawLyrics(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    effectiveTime: number,
    grade: GameScore['lastGrade'],
  ) {
    const upcoming = chart.notes.filter((note) => note.time + note.duration >= effectiveTime - 0.3).slice(0, 5);
    const lyric = upcoming.map((note) => note.lyric).join(' ');

    context.textAlign = 'center';
    context.font = '800 30px Inter, system-ui, sans-serif';
    context.shadowColor = gradeColor(grade);
    context.shadowBlur = 18;
    context.fillStyle = grade === 'perfect' || grade === 'good' ? '#86efac' : '#e0f2fe';
    context.fillText(lyric || 'Press play and sing into the neon rail', width / 2, height - 34);
    context.shadowBlur = 0;
    context.textAlign = 'start';
  }

  function drawHud(
    context: CanvasRenderingContext2D,
    width: number,
    grade: GameScore['lastGrade'],
    targetCents: number | null,
  ) {
    context.fillStyle = 'rgba(2, 6, 23, 0.68)';
    roundedRect(context, 16, 14, width - 32, 34, 14);
    context.fill();
    context.fillStyle = '#c4b5fd';
    context.font = '700 13px Inter, system-ui, sans-serif';
    context.fillText(`${chart.songTitle} - ${chart.artist}`, 30, 36);
    context.fillStyle = gradeColor(grade);
    context.fillText(
      `${grade.toUpperCase()}${targetCents === null ? '' : ` | ${Math.round(targetCents)} cents`}`,
      width - 190,
      36,
    );
  }

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return undefined;
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;

      if (canvas.width !== rect.width * ratio || canvas.height !== rect.height * ratio) {
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
      }

      context.save();
      context.scale(ratio, ratio);
      renderCanvas(context, rect.width, rect.height);
      context.restore();

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  });

  return (
    <canvas
      ref={canvasRef}
      className="h-[460px] w-full rounded-[2rem] border border-cyan-300/20 bg-slate-950 shadow-[0_0_70px_rgba(34,211,238,0.12)]"
      aria-label="Scrolling karaoke note highway"
    />
  );
}

function gradeColor(grade: GameScore['lastGrade']): string {
  switch (grade) {
    case 'perfect':
      return '#22c55e';
    case 'good':
      return '#a3e635';
    case 'off-key':
      return '#fb7185';
    case 'silent':
    default:
      return '#22d3ee';
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
