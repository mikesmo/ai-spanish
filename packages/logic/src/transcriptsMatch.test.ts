import { describe, expect, it } from 'vitest';
import { transcriptsMatch } from './transcriptsMatch';

describe('transcriptsMatch', () => {
  it('matches despite punctuation casing', () => {
    expect(transcriptsMatch('Hello, world!', 'hello world', 'en')).toBe(true);
  });

  it('matches Spanish punctuation', () => {
    expect(transcriptsMatch('¿Hola?', 'hola', 'es')).toBe(true);
  });
});
