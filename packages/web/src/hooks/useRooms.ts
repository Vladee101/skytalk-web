import { useState } from 'react';
import { getStoredToken } from './useAuth';

const STORAGE_KEY = 'skytalk_rooms';

export interface CreatedRoom {
  room_id: string;
  lesson_name: string;
  tutor_url: string;
  student_url: string;
  expires_at: string;
}

export interface RoomValidationError {
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

function loadRooms(): CreatedRoom[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as CreatedRoom[];
  } catch {
    return [];
  }
}

function saveRooms(rooms: CreatedRoom[]): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

export function removeRoomFromStorage(roomId: string): void {
  saveRooms(loadRooms().filter((r) => r.room_id !== roomId));
}

export function useRooms() {
  const [rooms, setRooms] = useState<CreatedRoom[]>(loadRooms);

  async function createRoom(
    file: File,
    studentName?: string,
  ): Promise<{ ok: true; room: CreatedRoom } | { ok: false; errors: RoomValidationError[]; message: string }> {
    const token = getStoredToken();
    if (!token) {
      return { ok: false, errors: [], message: 'Not authenticated.' };
    }

    const body = new FormData();
    body.append('flight_json', file);
    if (studentName?.trim()) body.append('student_name', studentName.trim());

    let res: Response;
    try {
      res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
    } catch {
      return { ok: false, errors: [], message: 'Network error. Check your connection.' };
    }

    if (res.status === 422) {
      const data = (await res.json()) as { errors?: RoomValidationError[]; error?: string };
      return {
        ok: false,
        errors: data.errors ?? [],
        message: data.error ?? 'Validation failed.',
      };
    }

    if (res.status === 413) {
      return { ok: false, errors: [], message: 'File exceeds 256 KB limit.' };
    }

    if (res.status === 401) {
      return { ok: false, errors: [], message: 'Session expired. Please log in again.' };
    }

    if (!res.ok) {
      return { ok: false, errors: [], message: `Server error (${res.status}).` };
    }

    const data = (await res.json()) as {
      room_id: string;
      lesson_name: string;
      tutor_url: string;
      student_url: string;
      expires_at: string;
    };

    const room: CreatedRoom = {
      room_id: data.room_id,
      lesson_name: data.lesson_name,
      tutor_url: data.tutor_url,
      student_url: data.student_url,
      expires_at: data.expires_at,
    };

    const updated = [room, ...rooms];
    saveRooms(updated);
    setRooms(updated);

    return { ok: true, room };
  }

  async function deleteRoom(roomId: string): Promise<boolean> {
    const token = getStoredToken();
    if (!token) return false;
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 404) return false;
    } catch {
      return false;
    }
    const updated = rooms.filter((r) => r.room_id !== roomId);
    saveRooms(updated);
    setRooms(updated);
    return true;
  }

  return { rooms, createRoom, deleteRoom };
}
