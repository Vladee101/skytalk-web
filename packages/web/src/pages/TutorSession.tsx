import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Step } from '@skytalk/core';
import { RadioAudioEngine } from '../audio/RadioAudioEngine';
import AudioUnlockOverlay from '../components/AudioUnlockOverlay';
import PttButton from '../components/PttButton';
import { useAudioUnlock } from '../hooks/useAudioUnlock';
import { usePeer } from '../hooks/usePeer';
import { usePTT } from '../hooks/usePTT';
import { useWebSocket } from '../hooks/useWebSocket';
import { removeRoomFromStorage } from '../hooks/useRooms';
import type { ServerMessage, StateSnapshot } from '../types/ws';

type CardStatus = 'pending' | 'active' | 'correct' | 'wrong';
interface CardState {
  status: CardStatus;
  submittedValue?: string;
}

const STATE_LABELS: Record<string, string> = {
  IDLE: 'Idle',
  LISTENING: 'Listening',
  INPUT_REQUIRED: 'Input required',
  INPUT_NOT_REQUIRED: 'No input',
  READY_TO_ADVANCE: 'Ready',
  COMPLETED: 'Completed',
  ENDED: 'Ended',
};

const STATE_COLORS: Record<string, string> = {
  IDLE: 'bg-gray-700 text-gray-300',
  LISTENING: 'bg-sky-800 text-sky-200',
  INPUT_REQUIRED: 'bg-amber-800 text-amber-200',
  INPUT_NOT_REQUIRED: 'bg-sky-800 text-sky-200',
  READY_TO_ADVANCE: 'bg-green-800 text-green-200',
  COMPLETED: 'bg-green-800 text-green-200',
  ENDED: 'bg-gray-700 text-gray-300',
};

const INPUT_LABELS: Record<string, string> = {
  com_frequency: 'COM Freq',
  squawk: 'Squawk',
  heading: 'Heading',
  altitude: 'Altitude',
};

function initCards(snapshot: StateSnapshot): CardState[] {
  const step = snapshot.current_step_data as Step | undefined;
  const count = step?.required_inputs?.length ?? 0;
  if (count === 0) return [];

  const idx = snapshot.current_input_index;
  const state = snapshot.state;

  return Array.from({ length: count }, (_, i) => {
    if (state === 'IDLE' || state === 'LISTENING' || state === 'ENDED') {
      return { status: 'pending' };
    }
    if (i < idx) {
      return { status: 'correct' };
    }
    if (i === idx) {
      if (snapshot.last_input_result?.correct === false) {
        return {
          status: 'wrong',
          ...(snapshot.last_input_result.value !== undefined && {
            submittedValue: snapshot.last_input_result.value,
          }),
        };
      }
      return { status: 'active' };
    }
    return { status: 'pending' };
  });
}

export default function TutorSession() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();

  const [cardStates, setCardStates] = useState<CardState[]>([]);
  const [studentTransmitting, setStudentTransmitting] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showSkipModal, setShowSkipModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [arrowFlash, setArrowFlash] = useState(false);

  const engineRef = useRef<RadioAudioEngine | null>(null);
  const triggerCallRef = useRef<((remotePeerId: string) => void) | null>(null);
  const arrowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const engine = new RadioAudioEngine(0.6);
    engineRef.current = engine;
    return () => {
      engine.close();
      engineRef.current = null;
    };
  }, []);

  const { needsUnlock, unlock } = useAudioUnlock(engineRef);

  const modalOpen = showEndModal || showSkipModal || showResetModal;

  const onEvent = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === 'state_snapshot') {
        setCardStates(initCards(msg as unknown as StateSnapshot));
      } else if (msg.type === 'step_changed') {
        setCardStates((prev) =>
          prev.length === 0
            ? prev
            : prev.map((_, i) => (i === 0 ? { status: 'active' } : { status: 'pending' })),
        );
        engineRef.current?.onStepChanged();
      } else if (msg.type === 'input_result') {
        setCardStates((prev) => {
          const next = [...prev];
          if (msg.correct) {
            next[msg.input_index] = {
              status: 'correct',
              ...(msg.submitted_value !== undefined && { submittedValue: msg.submitted_value }),
            };
            if (msg.more_inputs && next[msg.input_index + 1]) {
              next[msg.input_index + 1] = { status: 'active' };
            }
          } else {
            next[msg.input_index] = {
              status: 'wrong',
              ...(msg.submitted_value !== undefined && { submittedValue: msg.submitted_value }),
            };
          }
          return next;
        });
      } else if (msg.type === 'peer_ptt') {
        if (msg.by === 'student') {
          setStudentTransmitting(msg.pressed);
        }
      } else if (msg.type === 'peer_ready') {
        // Fallback id: students on a cached pre-update page register a fixed id
        const fallbackId = `${(roomId ?? '').replace(/[^a-zA-Z0-9]/g, '')}student`;
        triggerCallRef.current?.(msg.peer_id ?? fallbackId);
      } else if (msg.type === 'lesson_ended') {
        if (roomId) removeRoomFromStorage(roomId);
        navigate('/tutor/dashboard');
      } else if (msg.type === 'error' && msg.code === 'invalid_action') {
        if (arrowTimerRef.current) clearTimeout(arrowTimerRef.current);
        setArrowFlash(true);
        arrowTimerRef.current = setTimeout(() => setArrowFlash(false), 400);
      }
    },
    [navigate],
  );

  const { snapshot, send, status } = useWebSocket({
    roomId: roomId ?? '',
    token,
    onEvent,
  });

  const { peerStatus, triggerCall, localStream, remoteStream } = usePeer({
    roomId: roomId ?? '',
    role: 'tutor',
    token,
    processStream: (stream) => engineRef.current?.processOutbound(stream) ?? stream,
  });
  triggerCallRef.current = triggerCall;

  const { pttPressed, press, release } = usePTT(send, {
    onFirstGesture: () => engineRef.current?.resume(),
    onPttChange: (pressed) => localStream?.getAudioTracks().forEach((t) => { t.enabled = pressed; }),
  });

  useEffect(() => {
    if (!remoteStream || !engineRef.current) return;
    engineRef.current.processInbound(remoteStream);
  }, [remoteStream]);

  // Re-initialize cards when step data changes (e.g. after lesson_reset step_changed
  // delivers new current_step_data via snapshot update — useEffect covers the gap)
  useEffect(() => {
    if (!snapshot) return;
    const step = snapshot.current_step_data as Step | undefined;
    const count = step?.required_inputs?.length ?? 0;
    setCardStates((prev) => {
      // Only reinitialize if card count changed (new step) — avoids stomping event-driven updates
      if (prev.length !== count) return initCards(snapshot);
      return prev;
    });
  }, [snapshot?.current_step_index, snapshot?.current_step_data]);

  // Keyboard shortcuts
  useEffect(() => {
    if (modalOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      const state = snapshot?.state;
      if (e.code === 'Enter') {
        if (state === 'IDLE') {
          e.preventDefault();
          send({ type: 'start_lesson' });
        }
      } else if (e.code === 'ArrowRight') {
        if (state === 'READY_TO_ADVANCE' || state === 'INPUT_NOT_REQUIRED') {
          e.preventDefault();
          send({ type: 'right_arrow' });
        } else if (state && state !== 'IDLE' && state !== 'ENDED') {
          e.preventDefault();
          setShowSkipModal(true);
        }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        setShowEndModal(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, send, snapshot?.state]);

  function confirmSkip() {
    send({ type: 'skip_step' });
    setShowSkipModal(false);
  }

  function confirmEnd() {
    send({ type: 'end_lesson' });
    if (roomId) removeRoomFromStorage(roomId);
    navigate('/tutor/dashboard');
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <p className="text-gray-400">Invalid session link.</p>
      </div>
    );
  }

  const stepData = snapshot?.current_step_data as Step | undefined;
  const stepNum = snapshot?.current_step_index != null ? snapshot.current_step_index + 1 : null;
  const totalSteps = snapshot?.total_steps ?? null;
  const lessonState = snapshot?.state ?? null;
  const activeState = lessonState && lessonState !== 'IDLE' && lessonState !== 'ENDED';

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {needsUnlock && <AudioUnlockOverlay onUnlock={unlock} />}
      {/* Top bar */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {lessonState && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE_COLORS[lessonState] ?? 'bg-gray-700 text-gray-300'}`}
            >
              {STATE_LABELS[lessonState] ?? lessonState}
            </span>
          )}
          {stepNum !== null && totalSteps !== null && (
            <span className="text-xs text-gray-500">Step: {stepNum}/{totalSteps}</span>
          )}
        </div>

        {/* Student status */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {studentTransmitting && (
            <span className="text-sky-400 font-medium animate-pulse">Student transmitting</span>
          )}
          {(snapshot?.attempt_count ?? 0) > 0 && (
            <span>Attempts: {snapshot!.attempt_count}</span>
          )}
          <div className="flex items-center gap-1.5">
            {status !== 'open' && (
              <span>{status === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}</span>
            )}
            <span
              title={`Peer: ${peerStatus}`}
              className={
                peerStatus === 'connected'
                  ? 'text-green-500'
                  : peerStatus === 'error'
                    ? 'text-red-500'
                    : 'text-amber-500'
              }
            >
              {peerStatus === 'connected'
                ? 'Voice connected'
                : peerStatus === 'error'
                  ? 'Voice error'
                  : peerStatus === 'requesting_mic'
                    ? 'Allow microphone'
                    : 'Waiting for student voice…'}
            </span>
            <span
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
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 max-w-3xl mx-auto w-full">
        {!snapshot && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{status === 'closed' ? 'Connection lost.' : 'Connecting…'}</span>
            {status === 'closed' && (
              <button
                type="button"
                onClick={() => navigate('/tutor/dashboard')}
                className="text-sky-400 hover:text-sky-300 underline"
              >
                Back to dashboard
              </button>
            )}
          </div>
        )}

        {/* Step content */}
        {stepData && (
          <section className="space-y-4">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">
              {stepData.phase?.replace(/-/g, ' ')}
            </p>

            {/* ATC instruction */}
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">ATC</p>
              <p className="text-sm text-white leading-relaxed">{stepData.atc}</p>
            </div>

            {/* Expected readback */}
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Expected readback</p>
              <p className="text-sm text-gray-300 leading-relaxed">{stepData.expected_readback}</p>
            </div>

            {/* Notes */}
            {stepData.notes && (
              <div className="rounded-lg border border-gray-700 bg-gray-900 px-5 py-3">
                <p className="text-xs text-gray-500">{stepData.notes}</p>
              </div>
            )}
          </section>
        )}

        {/* Required input cards */}
        {cardStates.length > 0 && stepData?.required_inputs && (
          <section className="space-y-3">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase">
              Required inputs
            </p>
            <div
              className={`grid gap-3 ${
                cardStates.length === 1
                  ? 'grid-cols-1'
                  : cardStates.length === 2
                    ? 'grid-cols-2'
                    : 'grid-cols-2'
              }`}
            >
              {cardStates.map((card, i) => {
                const input = stepData.required_inputs[i];
                if (!input) return null;

                const borderClass =
                  card.status === 'active'
                    ? 'border-amber-500 animate-pulse'
                    : card.status === 'correct'
                      ? 'border-green-500'
                      : card.status === 'wrong'
                        ? 'border-red-500'
                        : 'border-gray-700';

                const labelClass =
                  card.status === 'correct'
                    ? 'text-green-400'
                    : card.status === 'wrong'
                      ? 'text-red-400'
                      : card.status === 'active'
                        ? 'text-amber-400'
                        : 'text-gray-500';

                return (
                  <div
                    key={i}
                    className={`rounded-lg border bg-gray-900 px-4 py-3 space-y-1.5 transition-colors ${borderClass}`}
                  >
                    <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>
                      {INPUT_LABELS[input.type] ?? input.type}
                    </p>
                    <p className="text-sm text-white font-mono">{input.value}</p>
                    {card.submittedValue !== undefined && (
                      <p
                        className={`text-xs font-mono ${card.status === 'correct' ? 'text-green-400' : 'text-red-400'}`}
                      >
                        → {card.submittedValue}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* PTT — hold Space or the button */}
        {snapshot && (
          <PttButton pressed={pttPressed} onPress={press} onRelease={release} className="w-full py-3 text-sm" />
        )}

        {/* Start lesson button (IDLE state) */}
        {lessonState === 'IDLE' && (
          <button
            type="button"
            onClick={() => send({ type: 'start_lesson' })}
            className="w-full rounded-lg bg-sky-700 px-4 py-3 text-sm font-medium text-white hover:bg-sky-600"
          >
            Start lesson (Enter)
          </button>
        )}

        {/* Tutor controls */}
        {activeState && (
          <div className="flex gap-3">
            {(lessonState === 'READY_TO_ADVANCE' || lessonState === 'INPUT_NOT_REQUIRED') && (
              <button
                type="button"
                onClick={() => send({ type: 'right_arrow' })}
                className={[
                  'flex items-center gap-2 rounded border px-4 py-2 text-xs font-medium transition-colors',
                  arrowFlash
                    ? 'border-red-600 bg-red-950 text-red-400'
                    : 'border-green-700 bg-green-950 text-green-400 hover:border-green-500 hover:text-green-300',
                ].join(' ')}
              >
                Continue (→)
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSkipModal(true)}
              className="rounded border border-gray-700 px-4 py-2 text-xs text-gray-400 hover:border-gray-500 hover:text-white"
            >
              Skip step
            </button>
            <button
              type="button"
              onClick={() => setShowResetModal(true)}
              className="rounded border border-amber-900 px-4 py-2 text-xs text-amber-400 hover:border-amber-700 hover:text-amber-300"
            >
              Reset lesson
            </button>
            <button
              type="button"
              onClick={() => setShowEndModal(true)}
              className="ml-auto rounded border border-red-900 px-4 py-2 text-xs text-red-400 hover:border-red-700 hover:text-red-300"
            >
              End session (Esc)
            </button>
          </div>
        )}
      </div>

      {/* Reset lesson confirmation modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-5 space-y-4 max-w-xs w-full mx-4">
            <p className="text-sm text-white font-medium">Reset lesson?</p>
            <p className="text-xs text-gray-400">Restarts from step 1 for both tutor and student.</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { send({ type: 'reset_lesson' }); setShowResetModal(false); }}
                className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip confirmation modal */}
      {showSkipModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-5 space-y-4 max-w-xs w-full mx-4">
            <p className="text-sm text-white font-medium">Skip this step?</p>
            <p className="text-xs text-gray-400">Student will not complete this step.</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowSkipModal(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSkip}
                className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End session confirmation modal */}
      {showEndModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-5 space-y-4 max-w-xs w-full mx-4">
            <p className="text-sm text-white font-medium">End session?</p>
            <p className="text-xs text-gray-400">This will close the room for both parties.</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowEndModal(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmEnd}
                className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                End
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}