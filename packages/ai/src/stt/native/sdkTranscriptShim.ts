/**
 * Reproduces `react-native-deepgram`'s `emitTranscript` contract so the
 * existing native caption reducer can stay unchanged:
 *   - drop non-strings and empty/whitespace transcripts
 *   - `isFinal = is_final || speech_final`
 *   - dedupe identical consecutive partial / final text
 */

export type SdkTranscriptEvent = { isFinal?: boolean; raw?: unknown };

export function createSdkTranscriptShim(
  onTranscript: (text: string, event: SdkTranscriptEvent) => void,
): {
  emit: (transcript: unknown, isFinal: boolean, raw: unknown) => void;
  reset: () => void;
} {
  let lastPartial = '';
  let lastFinal = '';

  return {
    reset: () => {
      lastPartial = '';
      lastFinal = '';
    },
    emit: (transcript, isFinal, raw) => {
      if (typeof transcript !== 'string') return;
      const normalized = transcript.trim();
      if (!normalized) return;
      if (isFinal) {
        if (lastFinal === normalized) return;
        lastFinal = normalized;
        lastPartial = '';
      } else {
        if (lastPartial === normalized) return;
        lastPartial = normalized;
      }
      onTranscript(normalized, { isFinal: !!isFinal, raw });
      if (isFinal) {
        lastPartial = '';
      }
    },
  };
}

export function transcriptFromDeepgramListenMessage(raw: unknown): {
  transcript: string;
  isFinalCollapsed: boolean;
  isFinal: boolean;
  fromFinalize: boolean;
} {
  const msg = raw as {
    is_final?: boolean;
    speech_final?: boolean;
    from_finalize?: boolean;
    channel?: { alternatives?: { transcript?: string }[] };
  };
  const transcript = msg?.channel?.alternatives?.[0]?.transcript ?? '';
  const isFinal = msg?.is_final === true;
  const speechFinal = msg?.speech_final === true;
  return {
    transcript,
    isFinalCollapsed: isFinal || speechFinal,
    isFinal,
    fromFinalize: msg?.from_finalize === true,
  };
}
