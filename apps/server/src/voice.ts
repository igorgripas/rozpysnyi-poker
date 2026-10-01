/**
 * Хто в голосовому чаті кожної кімнати (T63). Сервер не обробляє звук: він лише знає
 * учасників і пересилає сигнали WebRTC між ними. На гравця — одне зʼєднання (остання вкладка).
 */
export class VoiceRooms<S> {
  /** Код кімнати → гравець → його зʼєднання в голосі. */
  private readonly rooms = new Map<string, Map<string, S>>();

  /**
   * Додає гравця в голос. Повертає інших учасників і попереднє зʼєднання гравця,
   * якщо він уже був у голосі з іншої вкладки.
   */
  join(code: string, playerId: string, socket: S): { peers: string[]; replaced: S | null } {
    const members = this.rooms.get(code) ?? new Map<string, S>();
    this.rooms.set(code, members);
    const previous = members.get(playerId);
    members.set(playerId, socket);
    const peers = [...members.keys()].filter((id) => id !== playerId);
    return { peers, replaced: previous === undefined || previous === socket ? null : previous };
  }

  /** Прибирає гравця з голосу, якщо в голосі саме це зʼєднання. Повертає, чи прибрали. */
  leave(code: string, playerId: string, socket: S): boolean {
    const members = this.rooms.get(code);
    if (members?.get(playerId) !== socket) return false;
    members.delete(playerId);
    if (members.size === 0) this.rooms.delete(code);
    return true;
  }

  /** Зʼєднання гравця в голосі кімнати або `null`. */
  socketOf(code: string, playerId: string): S | null {
    return this.rooms.get(code)?.get(playerId) ?? null;
  }

  /** Інші учасники голосу кімнати: id і зʼєднання. */
  others(code: string, playerId: string): [string, S][] {
    return [...(this.rooms.get(code) ?? [])].filter(([id]) => id !== playerId);
  }
}
