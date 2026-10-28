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
import { usePTT } from '../hooks/usePTT';
import { useRadioIntensity } from '../hooks/useRadioIntensity';
import { usePeer } from '../hooks/usePeer';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ServerMessage } from '../types/ws';
import PFD from '../components/pfd/PFD';
import { useFlightStore } from '../store/flightStore';

type InputVariant = 'idle' | 'blue' | 'red' | 'green';

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

  const { peerStatus, peerRegistered, localStream, remoteStream } = usePeer({
    roomId: roomId ?? '',
    role: 'student',
    token,
  });

  const { pttPressed } = usePTT(send, {
    onFirstGesture: () => engineRef.current?.resume(),
    onPttChange: (pressed) => {
      localStream?.getAudioTracks().forEach((t) => { t.enabled = pressed; });
    },
  });

  // Retry peer_ready every 5 s until the WebRTC peer is connected.
  // A single fire is not reliable: the first message can be lost if the tutor's
  // call machinery isn't ready yet, leaving no way to re-initiate the call.
  useEffect(() => {
    if (!peerRegistered || status !== 'open' || peerStatus === 'connected') return;
    send({ type: 'peer_ready' });
    const timer = setInterval(() => send({ type: 'peer_ready' }), 5000);
    return () => clearInterval(timer);
  }, [peerRegistered, status, peerStatus, send]);

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

  return (
    <div className="relative min-h-screen bg-black overflow-hidden text-white">
      {/* Layer z-0: PFD as full-screen background */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <PFD />
      </div>

      {/* Top HUD bar: callsign/aircraft/route left · radio/status right */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-start justify-between px-4 pt-3 font-mono text-xs leading-5 pointer-events-none select-none">
        {/* Left: callsign · aircraft type · route */}
        <div>
          {hudInfo ? (
            <>
              <div className="text-green-400 font-bold">{hudInfo.callsign}</div>
              <div className="text-green-400">{hudInfo.aircraft_type}</div>
              <div className="text-green-400">{hudInfo.route}</div>
            </>
          ) : (
            <div className="text-green-900">—</div>
          )}
        </div>

        {/* Right: radio frequencies + connection status */}
        <div className="text-right">
          <div className="text-green-400">COM1 {radio.com1}</div>
          <div className="text-green-400">XPDR {radio.transponder}</div>
          <div className="flex items-center gap-2 justify-end mt-1">
            <span
              title={`WS: ${status}`}
              className={
                status === 'open'
                  ? 'text-green-500'
                  : status === 'closed'
                    ? 'text-red-500'
                    : 'text-amber-500'
              }
            >
              ●
            </span>
            <span
              title={`Peer: ${peerStatus}`}
              className={
                peerStatus === 'connected'
                  ? 'text-sky-500'
                  : peerStatus === 'error'
                    ? 'text-red-500'
                    : 'text-gray-700'
              }
            >
              ◆
            </span>
          </div>
        </div>
      </div>

      {/* Bottom overlay: PTT left · input center · step counter right */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/80 border-t border-gray-800 px-6 py-2">

        {/* Radio intensity — absolute bottom-left corner, independent of the main row */}
        <div className="absolute bottom-2 left-4 flex items-center gap-2 select-none">
          <label htmlFor="radio-intensity" className="text-[10px] text-gray-700 whitespace-nowrap">
            Radio {intensity}%
          </label>
          <input
            id="radio-intensity"
            type="range"
            min={0}
            max={100}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="accent-sky-700 w-24"
          />
        </div>

        <div className="flex items-center gap-4 max-w-3xl mx-auto">

          {/* Left: PTT indicator */}
          <div className="w-44 shrink-0">
            {snapshot ? (
              <div
                className={[
                  'rounded py-1.5 px-3 text-center text-xs font-medium tracking-widest transition-colors select-none',
                  pttPressed
                    ? 'bg-sky-700 text-white'
                    : 'bg-transparent border border-gray-800 text-gray-600',
                ].join(' ')}
              >
                {pttPressed ? 'TRANSMITTING' : 'HOLD SPACE'}
              </div>
            ) : (
              <div className="text-xs text-center text-gray-600 select-none">
                {status === 'closed' ? 'Connection lost.' : 'Connecting…'}
              </div>
            )}
          </div>

          {/* Center: input field with floating label */}
          <div className={`flex-1 flex items-center gap-2 transition-opacity ${inputVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="relative flex-1">
              {inputLabel && (
                <span
                  className={[
                    'absolute -top-4 left-0 text-[10px] font-semibold tracking-widest uppercase transition-colors select-none',
                    labelColorClass,
                  ].join(' ')}
                >
                  {inputLabel}
                </span>
              )}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.code === 'Enter') {
                    e.preventDefault();
                    submitInput();
                  }
                }}
                disabled={inputDisabled}
                placeholder="Type readback…"
                className={[
                  'w-full rounded border bg-gray-900/90 px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors',
                  inputBorderClass,
                  inputDisabled ? 'opacity-40' : '',
                ].join(' ')}
              />
            </div>
          </div>

          {/* Right: step counter / phase */}
          <div className="w-44 shrink-0 flex items-center justify-end select-none">
            <span className="text-xs text-green-400 font-mono text-right">
              {stepNum !== null && totalSteps !== null ? `${stepNum} / ${totalSteps}` : ''}
              {stepView ? `  ${stepView.phase.replace(/-/g, ' ')}` : ''}
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}