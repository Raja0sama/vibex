import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const TTL_MS = 1000 * 60 * 60 * 12;

@Injectable()
export class SessionService {
  private readonly store = new Map<string, { userId: string; expires: number }>();

  issue(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.store.set(token, { userId, expires: Date.now() + TTL_MS });
    return token;
  }

  verify(token: string): string | null {
    const row = this.store.get(token);
    if (!row) return null;
    if (row.expires < Date.now()) {
      this.store.delete(token);
      return null;
    }
    return row.userId;
  }

  revoke(token: string): void {
    this.store.delete(token);
  }
}
