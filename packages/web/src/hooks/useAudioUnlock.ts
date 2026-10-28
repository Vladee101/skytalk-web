import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { RadioAudioEngine } from '../audio/RadioAudioEngine';

/**
 * Tracks whether the page still needs a user gesture before audio can play.
 * Must be called after the effect that creates the engine (effects run in order).
 */
export function useAudioUnlock(engineRef: RefObject<RadioAudioEngine | null>): {
  needsUnlock: boolean;
  unlock: () => void;
} {
  const [needsUnlock, setNeedsUnlock] = useState(false);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setNeedsUnlock(engine.contextState !== 'running');
    // iOS moves the context to 'interrupted' after a call or app switch — ask again
    return engine.onStateChange((state) => setNeedsUnlock(state !== 'running' && state !== 'closed'));
  }, [engineRef]);

  const unlock = useCallback(() => {
    // Synchronous call inside the click handler — required by iOS Safari
    void engineRef.current?.resume().then(() => setNeedsUnlock(false));
  }, [engineRef]);

  return { needsUnlock, unlock };
}
