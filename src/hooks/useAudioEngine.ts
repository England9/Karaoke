import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AudioEngine, defaultAudioSettings, type AudioEngineSettings, type RecordingResult } from '../engine/AudioEngine';
import { RealtimePitchDetector } from '../engine/PitchDetector';
import type { PitchFrame } from '../types/song';

export interface AudioEngineViewState {
  initialized: boolean;
  initializing: boolean;
  error: string | null;
  pitchFrame: PitchFrame | null;
  songTime: number;
  recording: boolean;
  lastRecording: RecordingResult | null;
  loadedSongName: string | null;
}

export function useAudioEngine() {
  const engine = useRef(new AudioEngine());
  const detector = useRef(new RealtimePitchDetector({ fftSize: 4096 }));
  const animationFrame = useRef<number | null>(null);
  const [settings, setSettingsState] = useState<AudioEngineSettings>(defaultAudioSettings);
  const [state, setState] = useState<AudioEngineViewState>({
    initialized: false,
    initializing: false,
    error: null,
    pitchFrame: null,
    songTime: 0,
    recording: false,
    lastRecording: null,
    loadedSongName: null,
  });

  const stopLoop = useCallback(() => {
    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const analyser = engine.current.getAnalyser();
    const audioContext = engine.current.getAudioContext();

    if (analyser && audioContext) {
      const pitchFrame = detector.current.readFrame(analyser, audioContext.sampleRate, settings.noiseGateDb);

      if (pitchFrame) {
        engine.current.updatePitchCorrection(pitchFrame);
      } else {
        engine.current.updatePitchCorrection(null);
      }

      setState((previous) => ({
        ...previous,
        pitchFrame,
        songTime: engine.current.getSongCurrentTime(),
      }));
    }

    animationFrame.current = requestAnimationFrame(tick);
  }, [settings.noiseGateDb]);

  const startLoop = useCallback(() => {
    stopLoop();
    animationFrame.current = requestAnimationFrame(tick);
  }, [stopLoop, tick]);

  const initialize = useCallback(async () => {
    setState((previous) => ({ ...previous, initializing: true, error: null }));

    try {
      await engine.current.initialize(settings);
      setState((previous) => ({ ...previous, initialized: true, initializing: false }));
      startLoop();
    } catch (error) {
      setState((previous) => ({
        ...previous,
        initializing: false,
        error: error instanceof Error ? error.message : 'Unable to initialize audio engine.',
      }));
    }
  }, [settings, startLoop]);

  const stopCalibration = useCallback(() => {
    stopLoop();
    engine.current.destroy();
    detector.current.reset();
    setSettingsState((previous) => ({
      ...previous,
      outputEnabled: false,
      echoEnabled: false,
      reverbEnabled: false,
    }));
    setState((previous) => ({
      ...previous,
      initialized: false,
      initializing: false,
      error: null,
      pitchFrame: null,
      recording: false,
      songTime: 0,
    }));
  }, [stopLoop]);

  const updateSettings = useCallback((nextSettings: Partial<AudioEngineSettings>) => {
    setSettingsState((previous) => {
      const merged = { ...previous, ...nextSettings };
      engine.current.updateSettings(merged);
      return merged;
    });
  }, []);

  const loadSong = useCallback(async (file: File) => {
    const buffer = await engine.current.loadSongFile(file);
    setState((previous) => ({ ...previous, loadedSongName: file.name, songTime: 0 }));
    return buffer;
  }, []);

  const playSong = useCallback(() => {
    engine.current.playSong();
  }, []);

  const pauseSong = useCallback(() => {
    engine.current.pauseSong();
  }, []);

  const stopSong = useCallback(() => {
    engine.current.stopSong();
    setState((previous) => ({ ...previous, songTime: 0 }));
  }, []);

  const startRecording = useCallback(() => {
    engine.current.startRecording();
    setState((previous) => ({ ...previous, recording: true, lastRecording: null }));
  }, []);

  const stopRecording = useCallback(async () => {
    const result = await engine.current.stopRecording();
    setState((previous) => ({ ...previous, recording: false, lastRecording: result }));
  }, []);

  useEffect(() => {
    const currentEngine = engine.current;

    return () => {
      stopLoop();
      currentEngine.destroy();
    };
  }, [stopLoop]);

  return useMemo(
    () => ({
      engine: engine.current,
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
    }),
    [
      initialize,
      loadSong,
      pauseSong,
      playSong,
      settings,
      startRecording,
      state,
      stopCalibration,
      stopRecording,
      stopSong,
      updateSettings,
    ],
  );
}
