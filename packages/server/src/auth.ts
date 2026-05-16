import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

let _passwordHash: string | null = null;
let _jwtSecret: string | null = null;

export function initAuth(plainPassword: string, jwtSecret: string, saltRounds = 12): void {
  _passwordHash = bcrypt.hashSync(plainPassword, saltRounds);
  _jwtSecret = jwtSecret;
}

export async function verifyPassword(submitted: string): Promise<boolean> {
  if (_passwordHash === null) throw new Error('auth not initialized — call initAuth first');
  return bcrypt.compare(submitted, _passwordHash);
}

export function signToken(): string {
  if (_jwtSecret === null) throw new Error('auth not initialized — call initAuth first');
  return jwt.sign({ sub: 'tutor', role: 'tutor' }, _jwtSecret, { expiresIn: '1h' });
}

export function verifyToken(token: string): jwt.JwtPayload {
  if (_jwtSecret === null) throw new Error('auth not initialized — call initAuth first');
  return jwt.verify(token, _jwtSecret) as jwt.JwtPayload;
}
