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
  vocalIsolation: boolean;
  latencyCompensationMs: number;
}

export const defaultAudioSettings: AudioEngineSettings = {
  outputEnabled: false,
  correctionStrength: 35,
  key: 'C',
  scale: 'major',
  echoEnabled: false,
  echoDelay: 0.18,
  echoFeedback: 0.2,
  reverbEnabled: false,
  reverbMix: 0.25,
  masterGain: 0.68,
  karaokeCut: false,
  vocalIsolation: true,
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

  private micHighPass?: BiquadFilterNode;

  private micLowPass?: BiquadFilterNode;

  private compressor?: DynamicsCompressorNode;

  private masterGain?: GainNode;

  private dryGain?: GainNode;

  private echoDelayNode?: DelayNode;

  private echoInputGain?: GainNode;

  private echoFeedbackGain?: GainNode;

  private echoWetGain?: GainNode;

  private reverbConvolver?: ConvolverNode;

  private reverbGain?: GainNode;

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

  private monitorGate = 0;

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
    this.micHighPass = this.context.createBiquadFilter();
    this.micHighPass.type = 'highpass';
    this.micHighPass.frequency.value = 90;
    this.micHighPass.Q.value = 0.7;

    this.micLowPass = this.context.createBiquadFilter();
    this.micLowPass.type = 'lowpass';
    this.micLowPass.frequency.value = 1450;
    this.micLowPass.Q.value = 0.65;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.18;

    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -26;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 2.8;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.1;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.settings.masterGain;
    this.dryGain = this.context.createGain();
    this.echoDelayNode = this.context.createDelay(1.5);
    this.echoInputGain = this.context.createGain();
    this.echoFeedbackGain = this.context.createGain();
    this.echoWetGain = this.context.createGain();
    this.reverbConvolver = this.context.createConvolver();
    this.reverbConvolver.buffer = this.createImpulseResponse(2.3, 1.8);
    this.reverbGain = this.context.createGain();

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

    this.source.connect(this.micHighPass);
    this.micHighPass.connect(this.micLowPass);
    this.micLowPass.connect(this.analyser);
    this.analyser.connect(this.compressor);

    this.compressor.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    this.compressor.connect(this.echoInputGain);
    this.echoInputGain.connect(this.echoDelayNode);
    this.echoDelayNode.connect(this.echoWetGain);
    this.echoWetGain.connect(this.masterGain);
    this.echoDelayNode.connect(this.echoFeedbackGain);
    this.echoFeedbackGain.connect(this.echoDelayNode);

    this.compressor.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

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

    const now = this.context?.currentTime ?? 0;

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.settings.masterGain, now, 0.02);
    }

    if (this.micHighPass) {
      this.micHighPass.frequency.setTargetAtTime(this.settings.vocalIsolation ? 90 : 35, now, 0.02);
    }

    if (this.micLowPass) {
      this.micLowPass.frequency.setTargetAtTime(this.settings.vocalIsolation ? 1450 : 6000, now, 0.02);
    }

    if (this.echoDelayNode) {
      this.echoDelayNode.delayTime.setTargetAtTime(this.settings.echoDelay, now, 0.02);
    }

    this.applyMonitorGains();

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
    this.updateMonitorGate(frame.volume);

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
    this.micHighPass?.disconnect();
    this.micLowPass?.disconnect();
    this.analyser?.disconnect();
    this.compressor?.disconnect();
    this.masterGain?.disconnect();
    this.dryGain?.disconnect();
    this.echoDelayNode?.disconnect();
    this.echoInputGain?.disconnect();
    this.echoFeedbackGain?.disconnect();
    this.echoWetGain?.disconnect();
    this.reverbConvolver?.disconnect();
    this.reverbGain?.disconnect();
    this.pitchShift?.dispose();
    this.feedbackDelay?.dispose();
    this.reverb?.dispose();
  }

  private updateMonitorGate(volume: number): void {
    const openThreshold = this.settings.vocalIsolation ? 0.018 : 0.012;
    const closeThreshold = this.settings.vocalIsolation ? 0.009 : 0.006;
    const targetGate =
      volume >= openThreshold
        ? 1
        : volume <= closeThreshold
          ? 0
          : (volume - closeThreshold) / (openThreshold - closeThreshold);

    this.monitorGate = this.monitorGate * 0.82 + targetGate * 0.18;
    this.applyMonitorGains();
  }

  private applyMonitorGains(): void {
    const now = this.context?.currentTime ?? 0;
    const gate = this.settings.vocalIsolation ? this.monitorGate : 1;
    const echoActive = this.settings.echoEnabled ? gate : 0;

    this.dryGain?.gain.setTargetAtTime(this.settings.outputEnabled ? 0.74 * gate : 0, now, 0.025);
    this.echoInputGain?.gain.setTargetAtTime(echoActive, now, 0.025);
    this.echoFeedbackGain?.gain.setTargetAtTime(clamp(this.settings.echoFeedback, 0, 0.55) * echoActive, now, 0.025);
    this.echoWetGain?.gain.setTargetAtTime(0.58 * echoActive, now, 0.025);
    this.reverbGain?.gain.setTargetAtTime(this.settings.reverbEnabled ? this.settings.reverbMix * gate : 0, now, 0.025);
  }

  private createImpulseResponse(duration: number, decay: number): AudioBuffer {
    const context = this.requireContext();
    const length = Math.floor(context.sampleRate * duration);
    const impulse = context.createBuffer(2, length, context.sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);

      for (let index = 0; index < length; index += 1) {
        const envelope = (1 - index / length) ** decay;
        data[index] = (Math.random() * 2 - 1) * envelope;
      }
    }

    return impulse;
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
