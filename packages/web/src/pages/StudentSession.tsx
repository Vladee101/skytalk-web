import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { FlightLesson, StepView } from '@skytalk/core';

function applyInputToStore(pending: { value: string; type: string } | null): void {
  if (!pending) return;
  if (pending.type === 'com_frequency') {
    useFlightStore.setState((s) => ({ radio: { ...s.radio, com1: pending.value } }));
  } else if (pending.type === 'squawk') {
    useFlightStore.setState((s) => ({ radio: { ...s.radio, transponder: pending.value } }));
  } else if (pending.type === 'heading') {
    const hdg = parseFloat(pending.value);
    if (!isNaN(hdg)) useFlightStore.setState((s) => ({ pfd: { ...s.pfd, heading: hdg } }));
  } else if (pending.type === 'altitude') {
    const alt = parseFloat(pending.value);
    if (!isNaN(alt)) useFlightStore.setState((s) => ({ pfd: { ...s.pfd, altitude: alt } }));
  }
}
import { RadioAudioEngine } from '../audio/RadioAudioEngine';
import AudioUnlockOverlay from '../components/AudioUnlockOverlay';
import PttButton from '../components/PttButton';
import { useAudioUnlock } from '../hooks/useAudioUnlock';
import { usePTT } from '../hooks/usePTT';
import { useRadioIntensity } from '../hooks/useRadioIntensity';
import { usePeer } from '../hooks/usePeer';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ServerMessage } from '../types/ws';
import PFD from '../components/pfd/PFD';
import { useFlightStore } from '../store/flightStore';

type InputVariant = 'idle' | 'blue' | 'red' | 'green';

// Numeric keypads on phones; frequency needs the decimal point
const INPUT_MODES: Record<string, 'decimal' | 'numeric'> = {
  com_frequency: 'decimal',
  squawk: 'numeric',
  heading: 'numeric',
  altitude: 'numeric',
};

const INPUT_LABELS: Record<string, string> = {
  com_frequency: 'COM Frequency',
  squawk: 'Squawk',
  heading: 'Heading',
  altitude: 'Altitude',
};

interface HudInfo {
  callsign: string;
  aircraft_type: string;
  route: string;
}

export default function StudentSession() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [inputValue, setInputValue] = useState('');
  const [variant, setVariant] = useState<InputVariant>('idle');
  const [hudInfo, setHudInfo] = useState<HudInfo | null>(null);

  const [intensity, setIntensity] = useRadioIntensity();

  const { updateSimulation, radio } = useFlightStore();

  const engineRef = useRef<RadioAudioEngine | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const variantRef = useRef<InputVariant>('idle');
  const redTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const pendingInputRef = useRef<{ value: string; type: string } | null>(null);

  useEffect(() => {
    variantRef.current = variant;
  });

  useEffect(() => {
    return () => {
      if (redTimerRef.current) clearTimeout(redTimerRef.current);
    };
  }, []);

  // Create engine once on mount using persisted intensity
  useEffect(() => {
    const engine = new RadioAudioEngine(intensity / 100);
    engineRef.current = engine;
    return () => {
      engine.close();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep engine in sync whenever slider moves
  useEffect(() => {
    engineRef.current?.setIntensity(intensity / 100);
  }, [intensity]);

  const { needsUnlock, unlock } = useAudioUnlock(engineRef);

  // RAF simulation loop — drives PFD instruments
  useEffect(() => {
    function tick(time: number) {
      if (lastTimeRef.current) {
        const dt = (time - lastTimeRef.current) / 1000;
        updateSimulation(dt);
      }
      lastTimeRef.current = time;
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [updateSimulation]);

  // Fetch HUD info once on mount (callsign, aircraft type, route) and seed flightStore
  useEffect(() => {
    if (!roomId || !token) return;
    fetch(`/api/rooms/${roomId}?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {
        lesson?: { callsign?: string; aircraft_type?: string; route?: string; difficulty?: string; name?: string };
        total_steps?: number;
        current_step_data?: { phase?: string };
      } | null) => {
        if (!data?.lesson) return;
        setHudInfo({
          callsign: data.lesson.callsign ?? '',
          aircraft_type: data.lesson.aircraft_type ?? '',
          route: data.lesson.route ?? '',
        });

        // Seed flightStore with a synthetic FlightLesson so updateSimulation can run.
        // We bypass loadLesson/validateFlightJson because the API returns partial metadata.
        const initPhase = (data.current_step_data?.phase ?? 'PREFLIGHT') as FlightLesson['steps'][number]['phase'];
        const totalSteps = data.total_steps ?? 1;
        const syntheticLesson = {
          schema_version: '1.0' as const,
          lesson: {
            name: data.lesson.name ?? '',
            callsign: data.lesson.callsign ?? '',
            aircraft_type: data.lesson.aircraft_type ?? '',
            route: data.lesson.route ?? '',
            difficulty: (data.lesson.difficulty ?? 'beginner') as FlightLesson['lesson']['difficulty'],
          },
          steps: Array.from({ length: totalSteps }, (_, i) => ({
            step: i + 1,
            phase: (i === 0 ? initPhase : 'PREFLIGHT') as FlightLesson['steps'][number]['phase'],
            atc: '',
            expected_readback: '',
            required_inputs: [],
          })),
        } as unknown as FlightLesson;

        useFlightStore.setState({ lesson: syntheticLesson, currentStepIndex: 0 });
      })
      .catch(() => undefined);
  }, [roomId, token]);

  const onEvent = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === 'state_snapshot' || msg.type === 'state_changed') {
        const state = msg.state;
        if (state === 'INPUT_REQUIRED' && variantRef.current !== 'green') {
          setVariant('blue');
        } else if (state !== 'INPUT_REQUIRED' && variantRef.current !== 'green') {
          setVariant('idle');
        }
      } else if (msg.type === 'step_changed') {
        if (redTimerRef.current) clearTimeout(redTimerRef.current);
        setInputValue('');
        setVariant('idle');
        engineRef.current?.onStepChanged();
      } else if (msg.type === 'peer_ptt') {
        if (msg.by === 'tutor') engineRef.current?.setPttActive(msg.pressed);
      } else if (msg.type === 'input_result') {
        if (msg.correct && msg.more_inputs) {
          applyInputToStore(pendingInputRef.current);
          pendingInputRef.current = null;
          setInputValue('');
          setVariant('blue');
        } else if (msg.correct) {
          applyInputToStore(pendingInputRef.current);
          pendingInputRef.current = null;
          setVariant('green');
        } else {
          if (redTimerRef.current) clearTimeout(redTimerRef.current);
          setVariant('red');
          redTimerRef.current = setTimeout(() => {
            setInputValue('');
            setVariant('blue');
          }, 600);
        }
      } else if (msg.type === 'lesson_ended') {
        navigate('/ended');
      }
    },
    [navigate],
  );

  const { snapshot, send, status } = useWebSocket({
    roomId: roomId ?? '',
    token,
    onEvent,
  });

  // Sync flightStore step index and phase when the lesson advances
  useEffect(() => {
    const idx = snapshot?.current_step_index;
    if (idx == null) return;
    const phase = (snapshot?.current_step_data as { phase?: string } | undefined)?.phase;
    useFlightStore.setState((state) => {
      if (!state.lesson) return {};
      const steps = state.lesson.steps.map((s, i) =>
        i === idx && phase ? { ...s, phase: phase as FlightLesson['steps'][number]['phase'] } : s,
      );
      return { currentStepIndex: idx, lesson: { ...state.lesson, steps } };
    });
  }, [snapshot?.current_step_index]);

  const { peerStatus, peerRegistered, localPeerId, localStream, remoteStream, micError } = usePeer({
    roomId: roomId ?? '',
    role: 'student',
    token,
  });

  const { pttPressed, press, release } = usePTT(send, {
    onFirstGesture: () => engineRef.current?.resume(),
    onPttChange: (pressed) => {
      localStream?.getAudioTracks().forEach((t) => { t.enabled = pressed; });
    },
  });

  // Retry peer_ready every 5 s until the WebRTC peer is connected.
  // A single fire is not reliable: the first message can be lost if the tutor's
  // call machinery isn't ready yet, leaving no way to re-initiate the call.
  // Also resumes after a dropped call: peerStatus leaves 'connected' and the tutor calls again.
  useEffect(() => {
    if (!peerRegistered || !localPeerId || status !== 'open' || peerStatus === 'connected') return;
    send({ type: 'peer_ready', peer_id: localPeerId });
    const timer = setInterval(() => send({ type: 'peer_ready', peer_id: localPeerId }), 5000);
    return () => clearInterval(timer);
  }, [peerRegistered, localPeerId, status, peerStatus, send]);

  useEffect(() => {
    if (!remoteStream || !engineRef.current) return;
    engineRef.current.processInbound(remoteStream);
  }, [remoteStream]);

  // Focus restoration — exact conditions from spec
  useEffect(() => {
    if (!pttPressed && snapshot?.state === 'INPUT_REQUIRED' && variant !== 'green') {
      inputRef.current?.focus();
    } else if (pttPressed && variant !== 'green') {
      inputRef.current?.blur();
    }
  }, [pttPressed, snapshot?.state, variant]);


  function submitInput() {
    if (!inputValue.trim() || variant === 'green' || pttPressed) return;
    const val = inputValue.trim();
    const sv = snapshot?.current_step_data as StepView | undefined;
    const ci = sv?.required_inputs[snapshot?.current_input_index ?? 0];
    pendingInputRef.current = { value: val, type: ci?.type ?? '' };
    send({ type: 'submit_input', value: val });
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <p className="text-gray-400">Invalid session link.</p>
      </div>
    );
  }

  const stepView = snapshot?.current_step_data as StepView | undefined;
  const currentInput = stepView?.required_inputs[snapshot?.current_input_index ?? 0];
  const inputLabel = currentInput ? (INPUT_LABELS[currentInput.type] ?? currentInput.type) : null;
  const stepNum = snapshot?.current_step_index != null ? snapshot.current_step_index + 1 : null;
  const totalSteps = snapshot?.total_steps ?? null;

  // Show input while INPUT_REQUIRED or while green lock (stays visible until step advances)
  const inputVisible = snapshot?.state === 'INPUT_REQUIRED' || variant === 'green';
  const inputDisabled = pttPressed || variant === 'green';

  const inputBorderClass =
    variant === 'blue'
      ? 'border-sky-500 animate-pulse'
      : variant === 'red'
        ? 'border-red-500'
        : variant === 'green'
          ? 'border-green-500'
          : 'border-gray-700';

  const labelColorClass =
    variant === 'blue'
      ? 'text-sky-400'
      : variant === 'red'
        ? 'text-red-400'
        : variant === 'green'
          ? 'text-green-400'
          : 'text-gray-500';

  const connection = describeConnection(status, peerStatus, micError);

  return (
    <div className="relative h-[100dvh] bg-black overflow-hidden text-white flex flex-col">
      {needsUnlock && <AudioUnlockOverlay onUnlock={unlock} />}

      {/* Top HUD: callsign/aircraft/route left · radio right */}
      <div className="flex-none flex items-start justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 font-mono text-xs leading-5 select-none">
        <div className="min-w-0">
          {hudInfo ? (
            <>
              <div className="text-green-400 font-bold">{hudInfo.callsign}</div>
              <div className="text-green-400 truncate">
                {hudInfo.aircraft_type} · {hudInfo.route}
              </div>
            </>
          ) : (
            <div className="text-green-900">—</div>
          )}
        </div>

        <div className="text-right shrink-0">
          <div className="text-green-400">COM1 {radio.com1}</div>
          <div className="text-green-400">XPDR {radio.transponder}</div>
        </div>
      </div>

      {/* Connection status + radio effect intensity */}
      <div className="flex-none flex items-center justify-between gap-3 px-4 pb-2 text-[11px] select-none">
        <span
          className={`flex items-center gap-1.5 min-w-0 truncate ${connection.color}`}
          title={`WS: ${status} · Peer: ${peerStatus}`}
        >
          <span aria-hidden>●</span>
          {connection.label}
        </span>
        <label className="flex items-center gap-2 shrink-0 text-gray-600">
          Radio {intensity}%
          <input
            type="range"
            min={0}
            max={100}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="accent-sky-700 w-20"
          />
        </label>
      </div>

      {/* PFD — square fitted into the remaining space */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 pointer-events-none [container-type:size]">
        <div className="w-[min(100cqw,100cqh)] h-[min(100cqw,100cqh)]">
          <PFD />
        </div>
      </div>

      {/* Bottom panel: input row (when required) · PTT + step counter */}
      <div className="flex-none bg-black/80 border-t border-gray-800 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto space-y-3">
          {inputVisible && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submitInput();
              }}
            >
              <label className="flex-1 min-w-0">
                <span
                  className={[
                    'block mb-1 text-[10px] font-semibold tracking-widest uppercase transition-colors select-none',
                    labelColorClass,
                  ].join(' ')}
                >
                  {inputLabel ?? 'Readback'}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode={currentInput ? INPUT_MODES[currentInput.type] : undefined}
                  enterKeyHint="send"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={inputValue}
                  onChange={(e) => setInputValue(sanitizeInput(e.target.value, currentInput?.type))}
                  disabled={inputDisabled}
                  placeholder="Type value…"
                  className={[
                    // text-base (16px) keeps iOS Safari from zooming in on focus
                    'w-full rounded-lg border bg-gray-900/90 px-3 py-2.5 text-base font-mono text-white placeholder-gray-600 focus:outline-none transition-colors',
                    inputBorderClass,
                    inputDisabled ? 'opacity-40' : '',
                  ].join(' ')}
                />
              </label>
              <button
                type="submit"
                disabled={inputDisabled || !inputValue.trim()}
                className="shrink-0 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
              >
                Send
              </button>
            </form>
          )}

          <div className="flex items-center gap-3">
            {snapshot ? (
              <PttButton
                pressed={pttPressed}
                onPress={press}
                onRelease={release}
                className="flex-1 py-5 sm:py-3 text-sm"
              />
            ) : (
              <div className="flex-1 py-3 text-xs text-center text-gray-600 select-none">
                {status === 'closed' ? 'Connection lost.' : 'Connecting…'}
              </div>
            )}

            {/* Step counter / phase */}
            <div className="shrink-0 text-right font-mono text-xs leading-5 text-green-400 select-none">
              {stepNum !== null && totalSteps !== null && (
                <div>
                  {stepNum} / {totalSteps}
                </div>
              )}
              {stepView && <div>{stepView.phase.replace(/-/g, ' ')}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Russian-locale iOS decimal keypads type ',' — a frequency's only separator is '.'. */
function sanitizeInput(value: string, type: string | undefined): string {
  return type === 'com_frequency' ? value.replace(/,/g, '.') : value;
}

function describeConnection(
  status: string,
  peerStatus: string,
  micError: string | null,
): { label: string; color: string } {
  if (status === 'closed') return { label: 'Server disconnected', color: 'text-red-500' };
  if (status !== 'open') return { label: 'Reconnecting to server…', color: 'text-amber-500' };
  switch (peerStatus) {
    case 'connected':
      return { label: 'Voice connected', color: 'text-green-500' };
    case 'requesting_mic':
      return { label: 'Allow microphone access', color: 'text-amber-500' };
    case 'error':
      return { label: `Voice error${micError ? `: ${micError}` : ''}`, color: 'text-red-500' };
    default:
      return { label: 'Connecting voice…', color: 'text-amber-500' };
  }
}
