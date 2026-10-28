import type { WebSocket } from 'ws';

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

interface Slot {
  socket: WebSocket;
  lastSeen: number;
}

interface Room {
  tutor: Slot | null;
  student: Slot | null;
}

class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private sweepTimer: NodeJS.Timeout | null = null;

  join(roomId: string, role: 'tutor' | 'student', socket: WebSocket): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { tutor: null, student: null };
      this.rooms.set(roomId, room);
    }
    const existing = room[role];
    if (existing) {
      existing.socket.close(1001, 'replaced by new connection');
    }
    room[role] = { socket, lastSeen: Date.now() };
    this.ensureSweep();
  }

  leave(roomId: string, role: 'tutor' | 'student', socket: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    // A replaced or swept socket closes asynchronously — by then the slot may
    // already hold a newer connection, which must not be evicted.
    if (room[role]?.socket !== socket) return;
    room[role] = null;
    if (room.tutor === null && room.student === null) {
      this.rooms.delete(roomId);
    }
    if (this.rooms.size === 0) this.stopSweep();
  }

  touch(roomId: string, role: 'tutor' | 'student'): void {
    const slot = this.rooms.get(roomId)?.[role];
    if (slot) slot.lastSeen = Date.now();
  }

  broadcast(roomId: string, message: unknown): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const data = JSON.stringify(message);
    if (room.tutor) this.sendRaw(room.tutor.socket, data);
    if (room.student) this.sendRaw(room.student.socket, data);
  }

  sendTo(roomId: string, role: 'tutor' | 'student', message: unknown): void {
    const slot = this.rooms.get(roomId)?.[role];
    if (slot) this.sendRaw(slot.socket, JSON.stringify(message));
  }

  sendToPeer(roomId: string, senderRole: 'tutor' | 'student', message: unknown): void {
    const peerRole = senderRole === 'tutor' ? 'student' : 'tutor';
    this.sendTo(roomId, peerRole, message);
  }

  private sendRaw(socket: WebSocket, data: string): void {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }

  private ensureSweep(): void {
    if (this.sweepTimer === null) {
      this.sweepTimer = setInterval(() => this.sweep(), HEARTBEAT_INTERVAL_MS);
      this.sweepTimer.unref?.();
    }
  }

  private stopSweep(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    for (const [roomId, room] of this.rooms) {
      for (const role of ['tutor', 'student'] as const) {
        const slot = room[role];
        if (slot && slot.lastSeen < cutoff) {
          room[role] = null;
          slot.socket.close(1001, 'heartbeat timeout');
        }
      }
      if (room.tutor === null && room.student === null) {
        this.rooms.delete(roomId);
      }
    }
    if (this.rooms.size === 0) this.stopSweep();
  }

  reset(): void {
    this.stopSweep();
    for (const room of this.rooms.values()) {
      for (const role of ['tutor', 'student'] as const) {
        room[role]?.socket.close(1000, 'reset');
        room[role] = null;
      }
    }
    this.rooms.clear();
  }
}

let _manager: RoomManager | null = null;

export function getRoomManager(): RoomManager {
  if (_manager === null) _manager = new RoomManager();
  return _manager;
}

export function resetRoomManager(): void {
  _manager?.reset();
  _manager = null;
}
