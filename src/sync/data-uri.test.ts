import { describe, expect, it } from 'vitest';

import { decodeDataUri, isDataUri } from './data-uri';

describe('decodeDataUri', () => {
  it('reads base64 bytes and the real content type', () => {
    const { bytes, contentType } = decodeDataUri('data:image/jpeg;base64,/9j/4A==');
    expect(contentType).toBe('image/jpeg');
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('reads percent-encoded text', () => {
    const { bytes, contentType } = decodeDataUri('data:text/plain;utf8,a%20b');
    expect(contentType).toBe('text/plain');
    expect(new TextDecoder().decode(bytes)).toBe('a b');
  });

  it('refuses anything that is not a data URI', () => {
    expect(isDataUri('file:///x.jpg')).toBe(false);
    expect(() => decodeDataUri('file:///x.jpg')).toThrow();
  });
});
