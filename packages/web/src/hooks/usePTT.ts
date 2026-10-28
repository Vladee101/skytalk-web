import { useCallback, useEffect, useRef, useState } from 'react';
import type { SendMessage } from '../types/ws';

export function usePTT(
  send: (msg: SendMessage) => void,
  opts?: {
    onFirstGesture?: () => void;
    onPttChange?: (pressed: boolean) => void;
  },
): {
  pttPressed: boolean;
  /** For on-screen PTT buttons (touch / mouse). Space key is handled internally. */
  press: () => void;
  release: () => void;
} {
  const [pttPressed, setPttPressed] = useState(false);
  const pressedRef = useRef(false);
  const sendRef = useRef(send);
  const onFirstGestureRef = useRef(opts?.onFirstGesture);
  const onPttChangeRef = useRef(opts?.onPttChange);
  const firstGestureRef = useRef(false);

  useEffect(() => {
    sendRef.current = send;
    onFirstGestureRef.current = opts?.onFirstGesture;
    onPttChangeRef.current = opts?.onPttChange;
    // Sync gate to current PTT state on every render.
    // This initializes the gate when localStream first becomes non-null
    // (which triggers a re-render) without a separate useEffect in the caller.
    opts?.onPttChange?.(pressedRef.current);
  });

  const press = useCallback(() => {
    if (!firstGestureRef.current) {
      firstGestureRef.current = true;
      onFirstGestureRef.current?.();
    }
    if (pressedRef.current) return; // suppress browser auto-repeat / double source
    pressedRef.current = true;
    setPttPressed(true);
    sendRef.current({ type: 'ptt', pressed: true });
    onPttChangeRef.current?.(true);
  }, []);

  const release = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    setPttPressed(false);
    sendRef.current({ type: 'ptt', pressed: false });
    onPttChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      e.preventDefault();
      press();
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      e.preventDefault();
      release();
    }

    // keyup / pointerup never arrive if the window loses focus mid-transmission
    // (alt-tab, phone call, app switch) — release so the mic doesn't stay open.
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') release();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [press, release]);

  return { pttPressed, press, release };
}
