import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, SendMessage, ServerMessage, StateSnapshot } from '../types/ws';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;

export function useWebSocket(opts: {
  roomId: string;
  token: string;
  onEvent?: (event: ServerMessage) => void;
}): {
  snapshot: StateSnapshot | null;
  send: (msg: SendMessage) => void;
  status: WsStatus;
} {
  const { roomId, token } = opts;

  const onEventRef = useRef(opts.onEvent);
  useEffect(() => {
    onEventRef.current = opts.onEvent;
  });

  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const [status, setStatus] = useState<WsStatus>('connecting');

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const attemptRef = useRef(0);
  const gracefulRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    gracefulRef.current = false;
    attemptRef.current = 0;
    seqRef.current = 1;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const baseUrl = `${protocol}//${window.location.host}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`;

    function connect() {
      setStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

      const ws = new WebSocket(baseUrl);
      wsRef.current = ws;
      seqRef.current = 1;

      let didOpen = false;

      ws.onopen = () => {
        didOpen = true;
        attemptRef.current = 0;
        setStatus('open');
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === 'state_snapshot') {
          setSnapshot({
            room_id: msg.room_id,
            current_step_index: msg.current_step_index,
            current_input_index: msg.current_input_index,
            total_steps: msg.total_steps,
            state: msg.state,
            current_step_data: msg.current_step_data,
            attempt_count: msg.attempt_count,
            last_input_result: msg.last_input_result,
          });
        } else if (msg.type === 'state_changed') {
          setSnapshot((s) => (s ? { ...s, state: msg.state } : s));
        } else if (msg.type === 'step_changed') {
          setSnapshot((s) =>
            s
              ? {
                  ...s,
                  current_step_index: msg.current_step_index,
                  total_steps: msg.total_steps,
                  current_step_data: msg.current_step_data,
                  current_input_index: 0,
                  attempt_count: 0,
                  last_input_result: null,
                }
              : s,
          );
        } else if (msg.type === 'input_result') {
          setSnapshot((s) => {
            if (!s) return s;
            const next: StateSnapshot = {
              ...s,
              attempt_count: msg.attempt_count,
              last_input_result:
                msg.submitted_value !== undefined
                  ? { correct: msg.correct, value: msg.submitted_value }
                  : { correct: msg.correct },
            };
            if (msg.correct && msg.more_inputs) {
              next.current_input_index = msg.input_index + 1;
            }
            return next;
          });
        } else if (msg.type === 'lesson_ended') {
          gracefulRef.current = true;
          setStatus('closed');
        }

        onEventRef.current?.(msg);
      };

      ws.onclose = () => {
        if (gracefulRef.current) return;

        // Connection was rejected before it opened (HTTP 401/404/410 etc.) — don't retry.
        if (!didOpen) {
          setStatus('closed');
          return;
        }

        const attempt = attemptRef.current;
        if (attempt >= BACKOFF_MS.length) {
          setStatus('closed');
          return;
        }

        attemptRef.current = attempt + 1;
        setStatus('reconnecting');
        timerRef.current = setTimeout(connect, BACKOFF_MS[attempt]);
      };
    }

    connect();

    return () => {
      gracefulRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [roomId, token]);

  const send = useCallback((msg: SendMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ ...msg, seq: seqRef.current++ }));
  }, []);

  return { snapshot, send, status };
}
