import type { RoomState, VoiceSignal } from '@poker/protocol';
import { uk } from '../i18n';
import type { PokerClient } from '../net/client';
import type { VoiceMessage } from '../net/connection';

/** Публічні STUN-сервери: щоб гравці за NAT знайшли одне одного. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** Як часто перевіряти, хто говорить, мс. */
const SPEAKING_POLL_MS = 150;
/** Поріг гучності (RMS, 0…1), вище якого гравець «говорить». */
const SPEAKING_LEVEL = 0.02;
/** Скільки індикатор горить після останнього звуку, мс: паузи між словами не блимають. */
const SPEAKING_HOLD_MS = 800;

/** Можливості браузера, потрібні голосу; у тестах їх підмінюють. */
export interface VoiceEnv {
  /** Без WebRTC голосу немає зовсім. */
  readonly RTCPeerConnection: typeof RTCPeerConnection | undefined;
  readonly getUserMedia:
    ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  /** Мікрофон браузер дає лише на HTTPS (і localhost). */
  readonly secure: boolean;
  /** Для індикатора «хто говорить»; без нього індикатора немає. */
  readonly AudioContext: typeof AudioContext | undefined;
  /** Елемент, що відтворює звук іншого гравця. */
  readonly createAudio: () => HTMLAudioElement;
}

/** Справжні можливості браузера. */
export function browserVoiceEnv(): VoiceEnv {
  return {
    RTCPeerConnection: globalThis.RTCPeerConnection,
    getUserMedia:
      typeof navigator.mediaDevices?.getUserMedia === 'function'
        ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
        : undefined,
    secure: window.isSecureContext,
    AudioContext: globalThis.AudioContext,
    createAudio: () => {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.hidden = true;
      document.body.append(audio);
      return audio;
    },
  };
}

export interface VoiceState {
  /** `starting` — чекаємо дозволу на мікрофон. */
  readonly mic: 'off' | 'starting' | 'on';
  /** Чому мікрофон не ввімкнувся (HTTP, немає дозволу). */
  readonly notice: string | null;
  readonly othersMuted: boolean;
  /** Гравці, з якими є голосове зʼєднання. */
  readonly peers: readonly string[];
  /** Хто зараз говорить (зокрема ви). */
  readonly speaking: ReadonlySet<string>;
}

interface Peer {
  readonly pc: RTCPeerConnection;
  audio: HTMLAudioElement | null;
}

interface Meter {
  readonly source: MediaStreamAudioSourceNode;
  readonly analyser: AnalyserNode;
  readonly data: Uint8Array<ArrayBuffer>;
  /** Коли гравець востаннє звучав (мс, `performance.now()`). */
  loudAt: number;
}

/**
 * Голосовий чат кімнати (T63): WebRTC mesh до 6 гравців, сигналінг через сервер гри.
 * Хто входить у голос, пропонує зʼєднання (offer) усім, хто вже там; ті відповідають.
 * Після перепідключення до сервера клієнт заходить у голос заново, мікрофон лишається.
 */
export class VoiceChat {
  private state: VoiceState = {
    mic: 'off',
    notice: null,
    othersMuted: false,
    peers: [],
    speaking: new Set(),
  };
  private readonly listeners = new Set<() => void>();
  private readonly peers = new Map<string, Peer>();
  private readonly meters = new Map<string, Meter>();
  private unsubscribe: (() => void)[] = [];
  /** У голосі в поточному зʼєднанні з сервером: код кімнати й ваш id. */
  private joined: { code: string; you: string } | null = null;
  /** Стан кімнати, отриманий до обриву: заходити з ним у голос не можна (сервер нас ще не знає). */
  private staleRoom: RoomState | null = null;
  /** Інша вкладка того самого гравця забрала голос. */
  private replaced = false;
  private track: MediaStreamTrack | null = null;
  /** Сигнали обробляються по черзі: кандидат не має випередити опис сесії. */
  private queue: Promise<void> = Promise.resolve();
  private audioContext: AudioContext | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: PokerClient,
    private readonly env: VoiceEnv,
  ) {}

  getState = (): VoiceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Починає стежити за кімнатою й подіями голосу. */
  start(): void {
    if (this.unsubscribe.length > 0) return;
    this.unsubscribe = [
      this.client.subscribe(() => this.sync()),
      this.client.onVoice((message) => this.receive(message)),
    ];
    this.sync();
  }

  /** Виходить із голосу й вимикає мікрофон. */
  stop(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    this.closeAll();
    this.joined = null;
    this.stopTrack();
    if (this.meterTimer !== null) clearInterval(this.meterTimer);
    this.meterTimer = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  /** Заходить у голос, щойно сервер прийняв нас у кімнату, і виходить, коли звʼязку чи кімнати немає. */
  private sync(): void {
    const { connection, room } = this.client.getState();
    if (connection !== 'online' || room === null) {
      if (this.joined !== null) this.closeAll();
      this.joined = null;
      this.replaced = false;
      this.staleRoom = room;
      return;
    }
    if (this.joined !== null && this.joined.code !== room.code) {
      this.closeAll();
      this.joined = null;
    }
    if (this.joined !== null || room === this.staleRoom || this.replaced) return;
    this.staleRoom = null;
    this.joined = { code: room.code, you: room.you };
    void this.join(this.joined);
  }

  private async join(session: { code: string; you: string }): Promise<void> {
    const result = await this.client.voiceJoin();
    if (this.joined !== session) return;
    if (!result.ok) {
      // Спробуємо ще раз із наступним станом кімнати.
      this.joined = null;
      return;
    }
    for (const peer of result.data.peers) this.enqueue(() => this.offer(peer));
  }

  private receive(message: VoiceMessage): void {
    if (this.joined === null) return;
    if (message.type === 'left') {
      if (message.playerId === this.joined.you) {
        // Голос перейшов до іншої вкладки цього гравця.
        this.replaced = true;
        this.closeAll();
        return;
      }
      this.closePeer(message.playerId);
      return;
    }
    // Новий учасник сам запропонує зʼєднання.
    if (message.type === 'joined') return;
    const { from, signal } = message;
    this.enqueue(() => this.handleSignal(from, signal));
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      console.error('Голосовий чат', error);
    });
  }

  private async handleSignal(from: string, signal: VoiceSignal): Promise<void> {
    if (signal.type === 'offer') {
      await this.answer(from, signal.sdp);
      return;
    }
    const peer = this.peers.get(from);
    if (peer === undefined) return;
    if (signal.type === 'answer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
    } else {
      await peer.pc.addIceCandidate(signal.candidate).catch(() => {});
    }
  }

  private send(to: string, signal: VoiceSignal): void {
    void this.client.send('voice:signal', { to, signal });
  }

  private createPeer(id: string, initiator: boolean): Peer {
    this.closePeer(id);
    const Connection = this.env.RTCPeerConnection;
    if (Connection === undefined) throw new Error('WebRTC недоступний');
    const pc = new Connection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, audio: null };
    this.peers.set(id, peer);
    this.set({ peers: [...this.peers.keys()] });
    pc.onicecandidate = (event) => {
      if (event.candidate === null || this.peers.get(id) !== peer) return;
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate;
      this.send(id, {
        type: 'candidate',
        candidate: { candidate, sdpMid: sdpMid ?? null, sdpMLineIndex: sdpMLineIndex ?? null },
      });
    };
    pc.ontrack = (event) => {
      if (this.peers.get(id) !== peer) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      peer.audio ??= this.env.createAudio();
      peer.audio.dataset.voicePeer = id;
      peer.audio.muted = this.state.othersMuted;
      peer.audio.srcObject = stream;
      void peer.audio.play().catch(() => {});
      this.meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      // Зʼєднання розірвалося (мережа змінилася): той, хто пропонував, пропонує знову.
      if (pc.connectionState === 'failed' && initiator && this.peers.get(id) === peer) {
        this.enqueue(() => this.offer(id));
      }
    };
    return peer;
  }

  /** Пропонує зʼєднання гравцеві, який уже в голосі. */
  private async offer(id: string): Promise<void> {
    const { pc } = this.createPeer(id, true);
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (this.track !== null) await transceiver.sender.replaceTrack(this.track);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send(id, { type: 'offer', sdp: offer.sdp ?? '' });
  }

  /** Відповідає на пропозицію; стара сесія з цим гравцем (до перепідключення) закривається. */
  private async answer(id: string, sdp: string): Promise<void> {
    const { pc } = this.createPeer(id, false);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const transceiver of pc.getTransceivers()) {
      transceiver.direction = 'sendrecv';
      if (this.track !== null) await transceiver.sender.replaceTrack(this.track);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send(id, { type: 'answer', sdp: answer.sdp ?? '' });
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id);
    if (peer === undefined) return;
    this.peers.delete(id);
    peer.pc.close();
    if (peer.audio !== null) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.unmeter(id);
    this.set({ peers: [...this.peers.keys()] });
  }

  private closeAll(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  /** Вмикає чи вимикає мікрофон; звук іде всім учасникам голосу. */
  async setMic(on: boolean): Promise<void> {
    if (!on) {
      this.stopTrack();
      await this.replaceTracks();
      return;
    }
    if (!this.env.secure || this.env.getUserMedia === undefined) {
      this.set({ notice: uk.voice.httpsOnly });
      return;
    }
    if (this.state.mic !== 'off') return;
    this.set({ mic: 'starting', notice: null });
    try {
      const stream = await this.env.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.track = stream.getAudioTracks()[0] ?? null;
    } catch {
      this.track = null;
    }
    if (this.track === null) {
      this.set({ mic: 'off', notice: uk.voice.denied });
      return;
    }
    this.set({ mic: 'on' });
    const you = this.joined?.you ?? this.client.getState().room?.you;
    if (you !== undefined && this.env.AudioContext !== undefined) {
      this.meter(you, new MediaStream([this.track]));
    }
    await this.replaceTracks();
  }

  private stopTrack(): void {
    this.track?.stop();
    this.track = null;
    for (const [id] of this.meters) if (!this.peers.has(id)) this.unmeter(id);
    if (this.state.mic !== 'off') this.set({ mic: 'off' });
  }

  private async replaceTracks(): Promise<void> {
    for (const { pc } of this.peers.values()) {
      for (const transceiver of pc.getTransceivers()) {
        await transceiver.sender.replaceTrack(this.track);
      }
    }
  }

  /** Вимикає чи вмикає звук усіх інших гравців. */
  setOthersMuted(muted: boolean): void {
    for (const { audio } of this.peers.values()) if (audio !== null) audio.muted = muted;
    this.set({ othersMuted: muted });
  }

  /** Аудіоконтекст для індикатора; браузер дозволяє звук після дії користувача. */
  private context(): AudioContext | null {
    if (this.env.AudioContext === undefined) return null;
    this.audioContext ??= new this.env.AudioContext();
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
    return this.audioContext;
  }

  /** Індикатор «хто говорить»: гучність потоку гравця. */
  private meter(id: string, stream: MediaStream): void {
    const context = this.context();
    if (context === null) return;
    this.unmeter(id);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.meters.set(id, {
      source,
      analyser,
      data: new Uint8Array(analyser.fftSize),
      loudAt: -Infinity,
    });
    this.meterTimer ??= setInterval(() => this.measure(), SPEAKING_POLL_MS);
  }

  private unmeter(id: string): void {
    const meter = this.meters.get(id);
    if (meter === undefined) return;
    meter.source.disconnect();
    this.meters.delete(id);
    if (this.state.speaking.has(id)) {
      const speaking = new Set(this.state.speaking);
      speaking.delete(id);
      this.set({ speaking });
    }
  }

  private measure(): void {
    if (this.audioContext?.state === 'suspended') void this.audioContext.resume();
    const now = performance.now();
    const speaking = new Set<string>();
    for (const [id, meter] of this.meters) {
      meter.analyser.getByteTimeDomainData(meter.data);
      let sum = 0;
      for (const value of meter.data) sum += ((value - 128) / 128) ** 2;
      if (Math.sqrt(sum / meter.data.length) > SPEAKING_LEVEL) meter.loudAt = now;
      if (now - meter.loudAt < SPEAKING_HOLD_MS) speaking.add(id);
    }
    const same =
      speaking.size === this.state.speaking.size &&
      [...speaking].every((id) => this.state.speaking.has(id));
    if (!same) this.set({ speaking });
  }
}
