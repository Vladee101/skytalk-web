import { describe, expect, it } from 'vitest';

import { redactUrl } from '../src/logger';

describe('redactUrl', () => {
  it('redacts the token query parameter', () => {
    expect(redactUrl('/ws/rooms/abc?token=0123456789abcdef')).toBe('/ws/rooms/abc?token=REDACTED');
  });

  it('keeps other parameters around the token', () => {
    expect(redactUrl('/api/rooms/abc?x=1&token=secret&y=2')).toBe('/api/rooms/abc?x=1&token=REDACTED&y=2');
  });

  it('leaves URLs without a token unchanged', () => {
    expect(redactUrl('/api/health')).toBe('/api/health');
    expect(redactUrl('/api/rooms?mytoken=1')).toBe('/api/rooms?mytoken=1');
  });
});
