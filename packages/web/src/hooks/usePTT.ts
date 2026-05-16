import { useEffect, useRef, useState } from 'react';
import type { SendMessage } from '../types/ws';

export function usePTT(
  send: (msg: SendMessage) => void,
  opts?: {
    onFirstGesture?: () => void;
    onPttChange?: (pressed: boolean) => void;
  },
): {
  pttPressed: boolean;
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!firstGestureRef.current) {
        firstGestureRef.current = true;
        onFirstGestureRef.current?.();
      }
      if (pressedRef.current) return; // suppress browser auto-repeat
      pressedRef.current = true;
      setPttPressed(true);
      sendRef.current({ type: 'ptt', pressed: true });
      onPttChangeRef.current?.(true);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      e.preventDefault();
      pressedRef.current = false;
      setPttPressed(false);
      sendRef.current({ type: 'ptt', pressed: false });
      onPttChangeRef.current?.(false);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return { pttPressed };
}
