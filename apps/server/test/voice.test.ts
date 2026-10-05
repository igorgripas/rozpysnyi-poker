import type { VoiceSignal } from '@poker/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PokerServer, createPokerServer } from '../src/server.js';
import { TestClient } from './client.js';
import { errorCode, testRandom, unwrap } from './support.js';

// Сигналінг голосового чату (T63): сервер лише знає, хто в голосі, і пересилає сигнали WebRTC.

let server: PokerServer;
let url: string;
const clients: TestClient[] = [];

function client(): TestClient {
  const created = new TestClient(url);
  clients.push(created);
  return created;
}

const OFFER: VoiceSignal = { type: 'offer', sdp: 'v=0\r\n' };

beforeEach(async () => {
  server = createPokerServer({ random: testRandom(), publicUrl: 'https://poker.test' });
  url = await server.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.close();
});

/** Кімната з гравцями; повертає клієнтів і їхні id. */
async function room(names: string[]) {
  const [hostName, ...guestNames] = names;
  const host = client();
  const session = unwrap(await host.request('room:create', { name: hostName ?? 'Оля' }));
  const players = [{ client: host, id: session.playerId, token: session.token }];
  for (const name of guestNames) {
    const guest = client();
    const joined = unwrap(await guest.request('room:join', { code: session.code, name }));
    players.push({ client: guest, id: joined.playerId, token: joined.token });
  }
  return { code: session.code, players };
}

describe('голосовий чат: сигналінг', () => {
  it('без кімнати увійти в голос не можна', async () => {
    expect(errorCode(await client().request('voice:join', {}))).toBe('notInRoom');
  });

  it('вхід у голос: відповідь — хто вже в голосі, решта отримує voice:joined', async () => {
    const {
      players: [a, b, c],
    } = await room(['Оля', 'Петро', 'Іра']);
    if (!a || !b || !c) throw new Error('немає гравців');
    expect(unwrap(await a.client.request('voice:join', {}))).toEqual({ peers: [] });
    expect(unwrap(await b.client.request('voice:join', {}))).toEqual({ peers: [a.id] });
    await a.client.until((x) => x.voice.length === 1);
    expect(a.client.voice).toEqual([{ type: 'joined', playerId: b.id }]);
    // Хто не в голосі, подій голосу не отримує.
    expect(c.client.voice).toEqual([]);
    const third = unwrap(await c.client.request('voice:join', {}));
    expect([...third.peers].sort()).toEqual([a.id, b.id].sort());
  });

  it('сигнал пересилається лише адресатові з позначкою відправника', async () => {
    const {
      players: [a, b, c],
    } = await room(['Оля', 'Петро', 'Іра']);
    if (!a || !b || !c) throw new Error('немає гравців');
    for (const p of [a, b, c]) unwrap(await p.client.request('voice:join', {}));
    await a.client.until((x) => x.voice.length === 2);
    expect(unwrap(await a.client.request('voice:signal', { to: b.id, signal: OFFER }))).toBeNull();
    await b.client.until((x) => x.voice.some((e) => e.type === 'signal'));
    expect(b.client.voice.filter((e) => e.type === 'signal')).toEqual([
      { type: 'signal', from: a.id, signal: OFFER },
    ]);
    // Третій гравець чужих сигналів не бачить.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(c.client.voice.some((e) => e.type === 'signal')).toBe(false);
  });

  it('сигнал гравцеві, якого немає в голосі (чи з іншої кімнати), відхиляється', async () => {
    const {
      players: [a, b],
    } = await room(['Оля', 'Петро']);
    const other = await room(['Чужий']);
    const stranger = other.players[0];
    if (!a || !b || !stranger) throw new Error('немає гравців');
    unwrap(await a.client.request('voice:join', {}));
    unwrap(await stranger.client.request('voice:join', {}));
    // Петро в кімнаті, але не в голосі.
    expect(errorCode(await a.client.request('voice:signal', { to: b.id, signal: OFFER }))).toBe(
      'notInRoom',
    );
    // Гравець з іншої кімнати недосяжний.
    expect(
      errorCode(await a.client.request('voice:signal', { to: stranger.id, signal: OFFER })),
    ).toBe('notInRoom');
    // Не з голосу сигнал не надіслати.
    unwrap(await a.client.request('voice:leave', {}));
    unwrap(await b.client.request('voice:join', {}));
    expect(errorCode(await a.client.request('voice:signal', { to: b.id, signal: OFFER }))).toBe(
      'notInRoom',
    );
    expect(errorCode(await b.client.request('voice:signal', { to: b.id, signal: OFFER }))).toBe(
      'badRequest',
    );
  });

  it('вихід із голосу й відключення повідомляють інших (voice:left)', async () => {
    const {
      players: [a, b, c],
    } = await room(['Оля', 'Петро', 'Іра']);
    if (!a || !b || !c) throw new Error('немає гравців');
    for (const p of [a, b, c]) unwrap(await p.client.request('voice:join', {}));
    await a.client.until((x) => x.voice.length === 2);
    unwrap(await b.client.request('voice:leave', {}));
    await a.client.until((x) => x.voice.some((e) => e.type === 'left'));
    expect(a.client.voice.at(-1)).toEqual({ type: 'left', playerId: b.id });

    c.client.close();
    await a.client.until((x) => x.voice.filter((e) => e.type === 'left').length === 2);
    expect(a.client.voice.at(-1)).toEqual({ type: 'left', playerId: c.id });
    expect(unwrap(await b.client.request('voice:join', {}))).toEqual({ peers: [a.id] });
  });

  it('перепідключення: гравець повертається в кімнату й заново входить у голос', async () => {
    const { code, players } = await room(['Оля', 'Петро']);
    const [a, b] = players;
    if (!a || !b) throw new Error('немає гравців');
    unwrap(await a.client.request('voice:join', {}));
    unwrap(await b.client.request('voice:join', {}));
    await a.client.until((x) => x.voice.length === 1);

    // Петро «заснув»: зʼєднання обірвалося, потім він повернувся за токеном у новому.
    b.client.close();
    await a.client.until((x) => x.voice.some((e) => e.type === 'left'));
    const again = client();
    unwrap(await again.request('room:resume', { code, token: b.token }));
    expect(unwrap(await again.request('voice:join', {}))).toEqual({ peers: [a.id] });
    await a.client.until((x) => x.voice.at(-1)?.type === 'joined');
    expect(a.client.voice.map((e) => e.type)).toEqual(['joined', 'left', 'joined']);
    unwrap(await a.client.request('voice:signal', { to: b.id, signal: OFFER }));
    await again.until((x) => x.voice.some((e) => e.type === 'signal'));
  });

  it('друга вкладка того самого гравця замінює першу в голосі', async () => {
    const { code, players } = await room(['Оля', 'Петро']);
    const [a, b] = players;
    if (!a || !b) throw new Error('немає гравців');
    unwrap(await a.client.request('voice:join', {}));
    unwrap(await b.client.request('voice:join', {}));
    const second = client();
    unwrap(await second.request('room:resume', { code, token: b.token }));
    expect(unwrap(await second.request('voice:join', {}))).toEqual({ peers: [a.id] });
    unwrap(await a.client.request('voice:signal', { to: b.id, signal: OFFER }));
    await second.until((x) => x.voice.some((e) => e.type === 'signal'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.client.voice.some((e) => e.type === 'signal')).toBe(false);
  });
});
