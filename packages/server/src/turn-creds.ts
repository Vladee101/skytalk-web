import { createHmac } from 'node:crypto';

export interface TurnCredentials {
  username: string;
  password: string;
}

export function generateTurnCredentials(secret: string, roomId: string): TurnCredentials {
  const expiry = Math.floor(Date.now() / 1000) + 86400; // 24 h
  const username = `${expiry}:${roomId}`;
  const password = createHmac('sha1', secret).update(username).digest('base64');
  return { username, password };
}
