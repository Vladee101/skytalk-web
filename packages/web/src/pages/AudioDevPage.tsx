import { useEffect, useRef, useState } from 'react';
import { RadioAudioEngine } from '../audio/RadioAudioEngine';

type MicStatus = 'idle' | 'requesting' | 'active' | 'error';

export default function AudioDevPage() {
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [monitoring, setMonitoring] = useState(false);
  const [intensity, setIntensity] = useState(60);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ctxState, setCtxState] = useState<AudioContextState | null>(null);
  const [pttActive, setPttActive] = useState(false);

  const engineRef = useRef<RadioAudioEngine | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      engineRef.current?.close();
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handleRequestMic() {
    setMicStatus('requesting');
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const engine = new RadioAudioEngine(intensity / 100);
      const processed = engine.processOutbound(stream);

      engineRef.current = engine;
      rawStreamRef.current = stream;
      processedStreamRef.current = processed;

      setMicStatus('active');
      setCtxState(engine.contextState);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Mic access denied');
      setMicStatus('error');
    }
  }

  function handleIntensityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setIntensity(v);
    engineRef.current?.setIntensity(v / 100);
  }

  function handleMonitorToggle() {
    if (!processedStreamRef.current || !audioRef.current) return;
    const next = !monitoring;
    setMonitoring(next);
    if (next) {
      audioRef.current.srcObject = processedStreamRef.current;
      void audioRef.current.play();
    } else {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
  }

  function handlePttToggle() {
    if (!engineRef.current) return;
    const next = !pttActive;
    setPttActive(next);
    engineRef.current.setPttActive(next);
  }

  function handleStepChange() {
    engineRef.current?.onStepChanged();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-md space-y-6">
        <h1 className="text-xl font-semibold">Audio Dev — Outbound chain</h1>

        {/* Status */}
        <p className="text-xs text-gray-500">
          Mic:{' '}
          <span
            className={
              micStatus === 'active'
                ? 'text-green-400'
                : micStatus === 'error'
                  ? 'text-red-400'
                  : 'text-gray-400'
            }
          >
            {micStatus}
          </span>
          {ctxState && (
            <>
              {' · '}AudioContext:{' '}
              <span className={ctxState === 'running' ? 'text-green-400' : 'text-amber-400'}>
                {ctxState}
              </span>
            </>
          )}
        </p>

        {/* Request mic */}
        <button
          type="button"
          onClick={() => void handleRequestMic()}
          disabled={micStatus === 'requesting' || micStatus === 'active'}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {micStatus === 'requesting' ? 'Requesting…' : micStatus === 'active' ? 'Mic active' : 'Request mic'}
        </button>

        {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

        {/* Intensity slider */}
        <div className="space-y-2">
          <label className="text-sm text-gray-300" htmlFor="intensity-slider">
            Intensity: {intensity}%
          </label>
          <input
            id="intensity-slider"
            type="range"
            min={0}
            max={100}
            value={intensity}
            onChange={handleIntensityChange}
            className="w-full accent-sky-500"
          />
          <p className="text-xs text-gray-500">
            Controls compression ratio (1→4), saturation depth (k: 0→5), and inbound static level
          </p>
        </div>

        {/* Feedback warning — must be visible text directly above Monitor toggle */}
        <p className="text-amber-400 text-sm">
          ⚠️ Use headphones — monitoring your own mic causes feedback
        </p>

        {/* Monitor toggle */}
        <button
          type="button"
          onClick={handleMonitorToggle}
          disabled={micStatus !== 'active'}
          className={[
            'rounded border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            monitoring
              ? 'border-green-600 bg-green-900 text-green-300'
              : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500 hover:text-white',
          ].join(' ')}
        >
          {monitoring ? 'Monitoring ON' : 'Monitor processed output'}
        </button>

        {/* Hidden audio element for monitoring */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} />

        {/* Inbound chain test */}
        <div className="border-t border-gray-800 pt-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-200">Inbound chain — effects test</h2>
          <p className="text-xs text-gray-500">
            Simulates incoming peer_ptt and step_changed events. Audio plays to default output.
            Requires mic to be active (AudioContext must be running).
          </p>

          <div className="flex gap-3">
            {/* Simulated peer PTT */}
            <button
              type="button"
              onClick={handlePttToggle}
              disabled={micStatus !== 'active'}
              className={[
                'rounded border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                pttActive
                  ? 'border-sky-500 bg-sky-900 text-sky-300'
                  : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500 hover:text-white',
              ].join(' ')}
            >
              {pttActive ? 'Peer PTT: ON' : 'Peer PTT: OFF'}
            </button>

            {/* Simulated step change */}
            <button
              type="button"
              onClick={handleStepChange}
              disabled={micStatus !== 'active'}
              className="rounded border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-400 hover:border-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Simulate step change
            </button>
          </div>

          <p className="text-xs text-gray-500">
            PTT ON: click + static at {intensity * 0.15 / 100 * 100 | 0}% gain · PTT OFF: click + squelch tail · Step change: 900→1400 Hz sweep
          </p>
        </div>
      </div>
    </div>
  );
}
