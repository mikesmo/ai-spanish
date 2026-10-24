import { describe, expect, it } from 'vitest';
import {
  bumpSttEpoch,
  createSttAudioRingBuffer,
  isCurrentSttEpoch,
  keywordsMatch,
  reduceAcceptGate,
  selectSttStartPath,
  STT_AUDIO_BUFFER_MAX_BYTES,
} from '../sttSessionMachine';

describe('selectSttStartPath', () => {
  it('returns warm when the socket is open with the same keywords', () => {
    expect(
      selectSttStartPath({
        connectionState: 'open',
        connectedKeywords: ['hola:2'],
        requestedKeywords: ['hola:2'],
      }),
    ).toBe('warm');
  });

  it('returns keyword-mismatch when the open socket has different keywords', () => {
    expect(
      selectSttStartPath({
        connectionState: 'open',
        connectedKeywords: ['hola:2'],
        requestedKeywords: ['adiós:2'],
      }),
    ).toBe('keyword-mismatch');
  });

  it('returns connect when the socket is closed or connecting', () => {
    expect(
      selectSttStartPath({
        connectionState: 'closed',
        connectedKeywords: [],
        requestedKeywords: ['hola:2'],
      }),
    ).toBe('connect');
    expect(
      selectSttStartPath({
        connectionState: 'connecting',
        connectedKeywords: ['hola:2'],
        requestedKeywords: ['hola:2'],
      }),
    ).toBe('connect');
  });
});

describe('keywordsMatch', () => {
  it('ignores order', () => {
    expect(keywordsMatch(['b:2', 'a:2'], ['a:2', 'b:2'])).toBe(true);
  });
});

describe('reduceAcceptGate', () => {
  it('closes on clear and drops the event', () => {
    expect(reduceAcceptGate({ accepting: true }, { type: 'close' })).toEqual({
      accepting: false,
      acceptEvent: false,
    });
  });

  it('reopens unconditionally after a stopped mic', () => {
    expect(
      reduceAcceptGate({ accepting: false }, { type: 'openAfterStoppedMic' }),
    ).toEqual({ accepting: true, acceptEvent: false });
  });

  it('drops interims while closed', () => {
    expect(
      reduceAcceptGate(
        { accepting: false },
        { type: 'transcript', isFinal: false, fromFinalize: false },
      ),
    ).toEqual({ accepting: false, acceptEvent: false });
  });

  it('drops a from_finalize flush and reopens', () => {
    expect(
      reduceAcceptGate(
        { accepting: false },
        { type: 'transcript', isFinal: true, fromFinalize: true },
      ),
    ).toEqual({ accepting: true, acceptEvent: false });
  });

  it('accepts a new is_final that is not from_finalize', () => {
    expect(
      reduceAcceptGate(
        { accepting: false },
        { type: 'transcript', isFinal: true, fromFinalize: false },
      ),
    ).toEqual({ accepting: true, acceptEvent: true });
  });

  it('accepts events while already open', () => {
    expect(
      reduceAcceptGate(
        { accepting: true },
        { type: 'transcript', isFinal: false, fromFinalize: false },
      ),
    ).toEqual({ accepting: true, acceptEvent: true });
  });
});

describe('epoch', () => {
  it('invalidates a superseded start', () => {
    const first = 1;
    const next = bumpSttEpoch(first);
    expect(isCurrentSttEpoch(next, first)).toBe(false);
    expect(isCurrentSttEpoch(next, next)).toBe(true);
  });
});

describe('createSttAudioRingBuffer', () => {
  it('flushes in insertion order', () => {
    const buf = createSttAudioRingBuffer<ArrayBuffer>((c) => c.byteLength);
    const a = new Uint8Array([1]).buffer;
    const b = new Uint8Array([2]).buffer;
    buf.push(a);
    buf.push(b);
    expect(buf.flush()).toEqual([a, b]);
    expect(buf.length).toBe(0);
  });

  it('drops oldest when over the cap', () => {
    const buf = createSttAudioRingBuffer<ArrayBuffer>(
      (c) => c.byteLength,
      4,
    );
    const first = new Uint8Array([1, 2, 3]).buffer;
    const second = new Uint8Array([4, 5, 6]).buffer;
    buf.push(first);
    buf.push(second);
    expect(buf.dropped).toBe(1);
    expect(buf.flush()).toEqual([second]);
  });

  it('caps at the default 5 s PCM budget', () => {
    const buf = createSttAudioRingBuffer<ArrayBuffer>((c) => c.byteLength);
    buf.push(new ArrayBuffer(STT_AUDIO_BUFFER_MAX_BYTES));
    buf.push(new ArrayBuffer(1));
    expect(buf.dropped).toBe(1);
    expect(buf.bytes).toBe(1);
  });
});
