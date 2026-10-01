import type { VoiceSignal } from '@poker/protocol';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PokerClient } from '../src/net/client';
import { ClientProvider } from '../src/net/react';
import { VoiceChat, type VoiceEnv } from '../src/voice/VoiceChat';
import { VoiceControls, VoiceProvider } from '../src/voice/VoiceControls';
import { FakeConnection, human, roomState } from './support/fakeConnection';

/** Фейковий RTCPeerConnection: памʼятає описи, кандидати й трансивери. */
class FakePeerConnection {
  static all: FakePeerConnection[] = [];
  readonly transceivers: {
    direction: string;
    sender: { track: unknown; replaceTrack: (track: unknown) => Promise<void> };
  }[] = [];
  local: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  readonly candidates: unknown[] = [];
  closed = false;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  connectionState = 'new';

  constructor(readonly config: unknown) {
    FakePeerConnection.all.push(this);
  }

  private transceiver(direction: string) {
    const sender = {
      track: null as unknown,
      replaceTrack: (track: unknown) => {
        sender.track = track;
        return Promise.resolve();
      },
    };
    const created = { direction, sender };
    this.transceivers.push(created);
    return created;
  }

  addTransceiver(_kind: unknown, init: { direction: string }) {
    return this.transceiver(init.direction);
  }

  getTransceivers() {
    return this.transceivers;
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'offer-sdp' });
  }

  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'answer-sdp' });
  }

  setLocalDescription(description: { type: string; sdp: string }) {
    this.local = description;
    return Promise.resolve();
  }

  setRemoteDescription(description: { type: string; sdp: string }) {
    this.remote = description;
    if (description.type === 'offer' && this.transceivers.length === 0) {
      this.transceiver('recvonly');
    }
    return Promise.resolve();
  }

  addIceCandidate(candidate: unknown) {
    this.candidates.push(candidate);
    return Promise.resolve();
  }

  close() {
    this.closed = true;
  }
}

const micTrack = { kind: 'audio', stop: vi.fn() };
const getUserMedia = vi.fn(() =>
  Promise.resolve({ getAudioTracks: () => [micTrack], getTracks: () => [micTrack] }),
);

function env(secure = true): VoiceEnv {
  return {
    RTCPeerConnection: FakePeerConnection as unknown as typeof RTCPeerConnection,
    getUserMedia: getUserMedia as unknown as VoiceEnv['getUserMedia'],
    secure,
    AudioContext: undefined,
    createAudio: () => document.createElement('audio'),
  };
}

const ROOM = roomState({ seats: [human('p1', 'Оля'), human('p2', 'Петро')], you: 'p1' });

/** Клієнт у кімнаті з голосом; сервер відповідає на voice:join списком `peers`. */
function setup(peers: string[] = ['p2'], secure = true) {
  const connection = new FakeConnection();
  connection.on('voice:join', () => ({ ok: true, data: { peers } }));
  const client = new PokerClient(connection);
  const voice = new VoiceChat(client, env(secure));
  voice.start();
  const signals = () =>
    connection.requests
      .filter((r) => r.event === 'voice:signal')
      .map((r) => r.payload as { to: string; signal: VoiceSignal });
  const joins = () => connection.requests.filter((r) => r.event === 'voice:join').length;
  return { connection, client, voice, signals, joins };
}

/** Дає відпрацювати промісам (запити, WebRTC). */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function renderControls(voice: VoiceChat | null, client = new PokerClient(new FakeConnection())) {
  const user = userEvent.setup();
  render(
    <ClientProvider client={client}>
      <VoiceProvider voice={voice}>
        <VoiceControls />
      </VoiceProvider>
    </ClientProvider>,
  );
  return { user };
}

afterEach(() => {
  FakePeerConnection.all = [];
  getUserMedia.mockClear();
  micTrack.stop.mockClear();
});

describe('голосовий чат (T63)', () => {
  it('у кімнаті клієнт входить у голос і пропонує зʼєднання тим, хто вже там', async () => {
    const { connection, signals, joins } = setup(['p2']);
    expect(joins()).toBe(0);
    connection.pushStatus('online');
    connection.pushRoom(ROOM);
    await flush();
    expect(joins()).toBe(1);
    expect(FakePeerConnection.all).toHaveLength(1);
    const [pc] = FakePeerConnection.all;
    // Публічний STUN для NAT.
    expect(JSON.stringify(pc?.config)).toContain('stun:');
    expect(signals()).toEqual([{ to: 'p2', signal: { type: 'offer', sdp: 'offer-sdp' } }]);

    // Відповідь і ICE-кандидат від Петра.
    connection.push({
      type: 'voice',
      message: { type: 'signal', from: 'p2', signal: { type: 'answer', sdp: 'answer-sdp' } },
    });
    const candidate = { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };
    connection.push({
      type: 'voice',
      message: { type: 'signal', from: 'p2', signal: { type: 'candidate', candidate } },
    });
    await flush();
    expect(pc?.remote).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(pc?.candidates).toEqual([candidate]);
  });

  it('на пропозицію нового учасника клієнт відповідає й надсилає свої ICE-кандидати', async () => {
    const { connection, signals } = setup([]);
    connection.pushStatus('online');
    connection.pushRoom(ROOM);
    await flush();
    connection.push({
      type: 'voice',
      message: { type: 'signal', from: 'p2', signal: { type: 'offer', sdp: 'offer-sdp' } },
    });
    await flush();
    const [pc] = FakePeerConnection.all;
    expect(pc?.transceivers[0]?.direction).toBe('sendrecv');
    pc?.onicecandidate?.({
      candidate: { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(signals()).toEqual([
      { to: 'p2', signal: { type: 'answer', sdp: 'answer-sdp' } },
      {
        to: 'p2',
        signal: {
          type: 'candidate',
          candidate: { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 },
        },
      },
    ]);
    // Петро вийшов із голосу — зʼєднання закрито.
    connection.push({ type: 'voice', message: { type: 'left', playerId: 'p2' } });
    await flush();
    expect(pc?.closed).toBe(true);
  });

  it('перепідключення після засинання чи деплою відновлює голос і мікрофон', async () => {
    const { connection, voice, joins } = setup(['p2']);
    connection.pushStatus('online');
    connection.pushRoom(ROOM);
    await flush();
    await voice.setMic(true);
    const [first] = FakePeerConnection.all;

    connection.pushStatus('offline');
    await flush();
    expect(first?.closed).toBe(true);
    // Звʼязок є, але сервер ще не повернув нас у кімнату — у голос заходити рано.
    connection.pushStatus('online');
    await flush();
    expect(joins()).toBe(1);
    // Сервер повернув у кімнату (room:state) — знову в голосі, з увімкненим мікрофоном.
    connection.pushRoom({ ...ROOM });
    await flush();
    expect(joins()).toBe(2);
    expect(FakePeerConnection.all).toHaveLength(2);
    expect(FakePeerConnection.all[1]?.transceivers[0]?.sender.track).toBe(micTrack);
    expect(voice.getState().mic).toBe('on');
  });

  it('мікрофон вимкнений за замовчуванням; кнопка вмикає його й передає звук усім', async () => {
    const { connection, client, voice } = setup(['p2']);
    connection.pushStatus('online');
    connection.pushRoom(ROOM);
    await flush();
    const { user } = renderControls(voice, client);
    const mic = screen.getByRole('button', { name: 'Мікрофон' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(FakePeerConnection.all[0]?.transceivers[0]?.sender.track).toBeNull();

    await user.click(mic);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(mic).toHaveAttribute('aria-pressed', 'true');
    expect(FakePeerConnection.all[0]?.transceivers[0]?.sender.track).toBe(micTrack);

    await user.click(mic);
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    expect(micTrack.stop).toHaveBeenCalled();
    expect(FakePeerConnection.all[0]?.transceivers[0]?.sender.track).toBeNull();
  });

  it('кнопка вимикає звук інших гравців', async () => {
    const { connection, client, voice } = setup(['p2']);
    connection.pushStatus('online');
    connection.pushRoom(ROOM);
    await flush();
    const { user } = renderControls(voice, client);
    const mute = screen.getByRole('button', { name: 'Вимкнути звук інших' });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    await user.click(mute);
    expect(mute).toHaveAttribute('aria-pressed', 'true');
    expect(voice.getState().othersMuted).toBe(true);
  });

  it('на HTTP кнопка мікрофона пояснює, що голос працює лише через HTTPS', async () => {
    const { client, voice } = setup(['p2'], false);
    const { user } = renderControls(voice, client);
    await user.click(screen.getByRole('button', { name: 'Мікрофон' }));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Голосовий чат працює лише через HTTPS');
  });

  it('без WebRTC керування голосом не показується', () => {
    renderControls(null);
    expect(screen.queryByRole('button', { name: 'Мікрофон' })).toBeNull();
  });

  it('гравцеві відмовили в доступі до мікрофона — пояснення, мікрофон вимкнений', async () => {
    const { client, voice } = setup([]);
    getUserMedia.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    const { user } = renderControls(voice, client);
    await user.click(screen.getByRole('button', { name: 'Мікрофон' }));
    await act(flush);
    expect(screen.getByRole('button', { name: 'Мікрофон' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Немає доступу до мікрофона');
  });
});
