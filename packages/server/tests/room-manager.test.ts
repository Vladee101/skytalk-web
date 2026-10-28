import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { getRoomManager, resetRoomManager } from '../src/ws/room-manager';

function fakeSocket(): WebSocket {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe('RoomManager', () => {
  afterEach(() => resetRoomManager());

  it('late close of a replaced socket does not evict the new connection', () => {
    const manager = getRoomManager();
    const oldSocket = fakeSocket();
    const newSocket = fakeSocket();

    manager.join('room1', 'student', oldSocket);
    manager.join('room1', 'student', newSocket);
    expect(oldSocket.close).toHaveBeenCalledWith(1001, 'replaced by new connection');

    // The old socket's 'close' event arrives after the replacement
    manager.leave('room1', 'student', oldSocket);

    manager.sendTo('room1', 'student', { type: 'pong' });
    expect(newSocket.send).toHaveBeenCalledTimes(1);
    expect(oldSocket.send).not.toHaveBeenCalled();
  });

  it('leave with the current socket frees the slot', () => {
    const manager = getRoomManager();
    const socket = fakeSocket();

    manager.join('room1', 'tutor', socket);
    manager.leave('room1', 'tutor', socket);

    manager.sendTo('room1', 'tutor', { type: 'pong' });
    expect(socket.send).not.toHaveBeenCalled();
  });
});
