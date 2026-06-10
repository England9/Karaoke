import * as Tone from 'tone';

import type { PitchFrame, ScaleMode } from '../types/song';
import { clamp, nearestScaleMidi } from '../utils/music';

export interface AudioEngineSettings {
  outputEnabled: boolean;
  correctionStrength: number;
  key: string;
  scale: ScaleMode;
  echoEnabled: boolean;
  echoDelay: number;
  echoFeedback: number;
  reverbEnabled: boolean;
  reverbMix: number;
  masterGain: number;
  karaokeCut: boolean;
  latencyCompensationMs: number;
}

export const defaultAudioSettings: AudioEngineSettings = {
  outputEnabled: false,
  correctionStrength: 35,
  key: 'C',
  scale: 'major',
  echoEnabled: false,
  echoDelay: 0.18,
  echoFeedback: 0.28,
  reverbEnabled: false,
  reverbMix: 0.25,
  masterGain: 0.75,
  karaokeCut: false,
  latencyCompensationMs: 0,
};

export interface RecordingResult {
  rawBlob: Blob;
  processedBuffer?: AudioBuffer;
}

type BrowserAudioContext = typeof AudioContext;

export class AudioEngine {
  private context?: AudioContext;

  private stream?: MediaStream;

  private source?: MediaStreamAudioSourceNode;

  private analyser?: AnalyserNode;

  private compressor?: DynamicsCompressorNode;

  private masterGain?: GainNode;

  private pitchShift?: Tone.PitchShift;

  private feedbackDelay?: Tone.FeedbackDelay;

  private reverb?: Tone.Reverb;

  private mediaRecorder?: MediaRecorder;

  private recordingChunks: BlobPart[] = [];

  private songBuffer?: AudioBuffer;

  private songSource?: AudioBufferSourceNode;

  private songGain?: GainNode;

  private songStartedAt = 0;

  private songOffset = 0;

  private songPlaying = false;

  private stopWasRequested = false;

  private settings: AudioEngineSettings = { ...defaultAudioSettings };

  async initialize(settings?: Partial<AudioEngineSettings>): Promise<void> {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }

    if (this.context) {
      await this.resume();
      this.updateSettings(this.settings);
      return;
    }

    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error('Web Audio API is not available in this browser.');
    }

    this.context = new AudioContextCtor({ latencyHint: 'interactive' });
    Tone.setContext(this.context);
    await Tone.start();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.18;

    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -34;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.16;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.settings.outputEnabled ? this.settings.masterGain : 0;

    this.pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.04,
      wet: 1,
    });
    this.feedbackDelay = new Tone.FeedbackDelay({
      delayTime: this.settings.echoDelay,
      feedback: this.settings.echoFeedback,
      wet: 0,
    });
    this.reverb = new Tone.Reverb({
      decay: 2.6,
      preDelay: 0.025,
      wet: 0,
    });

    this.source.connect(this.analyser);
    this.analyser.connect(this.compressor);
    this.compressor.connect(this.pitchShift.input as unknown as AudioNode);
    this.pitchShift.connect(this.feedbackDelay);
    this.feedbackDelay.connect(this.reverb);
    this.reverb.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    void this.reverb.ready;
    this.updateSettings(this.settings);
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  updateSettings(nextSettings: Partial<AudioEngineSettings>): void {
    this.settings = { ...this.settings, ...nextSettings };

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.settings.outputEnabled ? this.settings.masterGain : 0,
        this.context?.currentTime ?? 0,
        0.02,
      );
    }

    if (this.feedbackDelay) {
      this.feedbackDelay.delayTime.value = this.settings.echoDelay;
      this.feedbackDelay.feedback.value = this.settings.echoFeedback;
      this.feedbackDelay.wet.value = this.settings.echoEnabled ? 0.8 : 0;
    }

    if (this.reverb) {
      this.reverb.wet.value = this.settings.reverbEnabled ? this.settings.reverbMix : 0;
    }
  }

  updatePitchCorrection(frame: PitchFrame): void {
    if (!this.pitchShift) {
      return;
    }

    const strength = clamp(this.settings.correctionStrength / 100, 0, 1);

    if (!frame.frequency || strength === 0) {
      this.pitchShift.pitch = 0;
      return;
    }

    const targetMidi = nearestScaleMidi(frame.midi, this.settings.key, this.settings.scale);
    const interval = clamp(targetMidi - frame.midi, -12, 12) * strength;
    this.pitchShift.pitch = interval;
  }

  getAnalyser(): AnalyserNode | undefined {
    return this.analyser;
  }

  getAudioContext(): AudioContext | undefined {
    return this.context;
  }

  getCurrentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  getSongCurrentTime(): number {
    if (!this.context) {
      return 0;
    }

    return this.songPlaying ? this.context.currentTime - this.songStartedAt : this.songOffset;
  }

  async loadSongFile(file: File): Promise<AudioBuffer> {
    const context = this.requireContext();
    const buffer = await file.arrayBuffer();
    this.songBuffer = await context.decodeAudioData(buffer.slice(0));
    this.songOffset = 0;
    return this.songBuffer;
  }

  playSong(buffer = this.songBuffer): void {
    const context = this.requireContext();

    if (!buffer) {
      return;
    }

    this.stopSongSource();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.onended = () => {
      if (!this.stopWasRequested) {
        this.songOffset = 0;
        this.songPlaying = false;
      }
    };

    this.songGain = context.createGain();
    this.songGain.gain.value = 0.78;
    this.connectSongSource(source, this.songGain);
    this.songGain.connect(context.destination);

    this.stopWasRequested = false;
    this.songSource = source;
    this.songStartedAt = context.currentTime - this.songOffset;
    source.start(0, this.songOffset);
    this.songPlaying = true;
  }

  pauseSong(): void {
    if (!this.context || !this.songPlaying) {
      return;
    }

    this.songOffset = this.getSongCurrentTime();
    this.stopSongSource();
    this.songPlaying = false;
  }

  stopSong(): void {
    this.songOffset = 0;
    this.stopSongSource();
    this.songPlaying = false;
  }

  startRecording(): void {
    if (!this.stream) {
      throw new Error('Microphone is not initialized.');
    }

    this.recordingChunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.getSupportedMimeType() });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordingChunks.push(event.data);
      }
    };
    this.mediaRecorder.start();
  }

  async stopRecording(): Promise<RecordingResult> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      throw new Error('No active recording to stop.');
    }

    const recorder = this.mediaRecorder;
    const mimeType = recorder.mimeType || 'audio/webm';

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const rawBlob = new Blob(this.recordingChunks, { type: mimeType });
    const processedBuffer = await this.renderPostProcessAutotune(rawBlob);

    return { rawBlob, processedBuffer };
  }

  async renderPostProcessAutotune(rawBlob: Blob): Promise<AudioBuffer> {
    const liveContext = this.requireContext();
    const arrayBuffer = await rawBlob.arrayBuffer();
    const decoded = await liveContext.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    const source = offline.createBufferSource();
    const compressor = offline.createDynamicsCompressor();
    const polish = offline.createBiquadFilter();
    const gain = offline.createGain();

    source.buffer = decoded;
    compressor.threshold.value = -28;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    polish.type = 'peaking';
    polish.frequency.value = 1800;
    polish.Q.value = 0.9;
    polish.gain.value = clamp(this.settings.correctionStrength / 18, 0, 5);
    gain.gain.value = 0.95;

    source.connect(compressor);
    compressor.connect(polish);
    polish.connect(gain);
    gain.connect(offline.destination);
    source.start();

    return offline.startRendering();
  }

  destroy(): void {
    this.stopSong();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.disconnectNodes();
    void this.context?.close();
    this.context = undefined;
  }

  private connectSongSource(source: AudioBufferSourceNode, destination: GainNode): void {
    const context = this.requireContext();

    if (!this.settings.karaokeCut) {
      source.connect(destination);
      return;
    }

    const lowPass = context.createBiquadFilter();
    const highPass = context.createBiquadFilter();

    lowPass.type = 'lowpass';
    lowPass.frequency.value = 260;
    lowPass.Q.value = 0.7;

    highPass.type = 'highpass';
    highPass.frequency.value = 3200;
    highPass.Q.value = 0.8;

    source.connect(lowPass);
    source.connect(highPass);
    lowPass.connect(destination);
    highPass.connect(destination);
  }

  private stopSongSource(): void {
    if (!this.songSource) {
      return;
    }

    this.stopWasRequested = true;
    try {
      this.songSource.stop();
    } catch {
      // Source nodes can only be stopped once.
    }
    this.songSource.disconnect();
    this.songGain?.disconnect();
    this.songSource = undefined;
  }

  private disconnectNodes(): void {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.compressor?.disconnect();
    this.masterGain?.disconnect();
    this.pitchShift?.dispose();
    this.feedbackDelay?.dispose();
    this.reverb?.dispose();
  }

  private requireContext(): AudioContext {
    if (!this.context) {
      throw new Error('Audio engine has not been initialized.');
    }

    return this.context;
  }

  private getSupportedMimeType(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
  }
}
