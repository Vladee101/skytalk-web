import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';

export type PeerStatus = 'idle' | 'requesting_mic' | 'connecting' | 'connected' | 'error';

export function usePeer(opts: {
  roomId: string;
  role: 'tutor' | 'student';
  iceServers?: RTCIceServer[];
  /** Tutor only — transform the local mic stream before passing it to peer.call(). */
  processStream?: (stream: MediaStream) => MediaStream;
}): {
  peerStatus: PeerStatus;
  /** True once the local PeerJS peer has registered on the PeerServer (peer 'open' event). */
  peerRegistered: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micError: string | null;
  /** Tutor only — call this when peer_ready arrives from server to initiate the WebRTC call. */
  triggerCall: () => void;
} {
  const { roomId, role } = opts;

  const [peerStatus, setPeerStatus] = useState<PeerStatus>('idle');
  const [peerRegistered, setPeerRegistered] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<MediaConnection | null>(null);
  // Captured once at effect creation; changes mid-session are not supported.
  const iceServersRef = useRef(opts.iceServers);
  const processStreamRef = useRef(opts.processStream);

  // Tutor: set inside the effect once peer is open, called by triggerCall().
  const attemptCallRef = useRef<(() => void) | null>(null);
  // True if triggerCall() fired before the peer was open.
  const callPendingRef = useRef(false);

  const triggerCall = useCallback(() => {
    if (attemptCallRef.current) {
      attemptCallRef.current();
    } else {
      callPendingRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!roomId) return;

    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, '');
    const peerId = `${safeRoomId}${role}`;
    const remoteId = `${safeRoomId}${role === 'tutor' ? 'student' : 'tutor'}`;
    const secure = window.location.protocol === 'https:';

    const resolvedIceServers: RTCIceServer[] = iceServersRef.current ?? [
      { urls: `stun:${window.location.hostname}:3478` },
    ];

    const MIC_CONSTRAINTS: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        sampleRate: 16000, // Hint only — browser may ignore sampleRate constraint
        channelCount: 1,
      },
      video: false,
    };

    function makePeer(): Peer {
      const peer = new Peer(peerId, {
        host: window.location.hostname,
        port: secure ? 443 : 80,
        path: '/peerjs',
        secure,
        config: { iceServers: resolvedIceServers, iceTransportPolicy: 'all' },
      });
      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (!destroyed) {
          setMicError(err.message);
          setPeerStatus('error');
        }
      });
      return peer;
    }

    function onRemoteStream(remoteMediaStream: MediaStream) {
      if (!destroyed) {
        setRemoteStream(remoteMediaStream);
        setPeerStatus('connected');
      }
    }

    function onCallError(err: Error) {
      if (!destroyed) {
        setMicError(err.message);
        setPeerStatus('error');
      }
    }

    setMicError(null);

    if (role === 'student') {
      // Create peer immediately so call handler is registered before tutor calls.
      setPeerStatus('connecting');
      const peer = makePeer();
      peerRef.current = peer;

      let pendingCall: MediaConnection | null = null;
      let localStreamReady: MediaStream | null = null;

      // Only signal readiness (setPeerRegistered) when BOTH the signaling peer is open
      // AND the mic stream is ready. This prevents peer_ready being sent before the
      // student can answer, which would cause the tutor's ICE to time out on first load
      // while the browser permission dialog is still showing.
      let peerOpen = false;
      let streamReady = false;
      function checkBothReady() {
        if (peerOpen && streamReady && !destroyed) setPeerRegistered(true);
      }

      peer.on('open', () => {
        if (!destroyed) { peerOpen = true; checkBothReady(); }
      });

      peer.on('call', (call) => {
        if (destroyed) return;
        activeCallRef.current?.close();
        activeCallRef.current = call;
        call.on('stream', onRemoteStream);
        call.on('error', onCallError);
        if (localStreamReady) {
          call.answer(localStreamReady);
        } else {
          pendingCall = call;
        }
      });

      setPeerStatus('requesting_mic');
      navigator.mediaDevices
        .getUserMedia(MIC_CONSTRAINTS)
        .then((stream) => {
          if (destroyed) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamReady = stream;
          localStreamRef.current = stream;
          setLocalStream(stream);
          setPeerStatus('connecting');
          if (pendingCall) {
            pendingCall.answer(stream);
            pendingCall = null;
          }
          streamReady = true;
          checkBothReady();
        })
        .catch((err: Error) => {
          if (!destroyed) {
            setMicError(err.message);
            setPeerStatus('error');
          }
        });
    } else {
      // Tutor: get mic first, then create peer and call student on open.
      setPeerStatus('requesting_mic');
      navigator.mediaDevices
        .getUserMedia(MIC_CONSTRAINTS)
        .then((stream) => {
          if (destroyed) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          setLocalStream(stream);
          setPeerStatus('connecting');

          const peer = makePeer();
          peerRef.current = peer;

          let callAttempts = 0;
          const MAX_ATTEMPTS = 5;
          const CLOSE_GRACE_MS = 2000;
          const RETRY_DELAY_MS = 2000;

          function attemptCall() {
            if (destroyed) return;
            callAttempts += 1;

            const txStream = processStreamRef.current ? processStreamRef.current(stream) : stream;
            const call = peer.call(remoteId, txStream);
            activeCallRef.current = call;
            const callStartedAt = Date.now();

            call.on('stream', onRemoteStream);
            call.on('error', (e) => {
              console.error('Call error:', e);
              onCallError(e);
            });
            call.on('close', () => {
              const elapsed = Date.now() - callStartedAt;
              if (elapsed < CLOSE_GRACE_MS && callAttempts < MAX_ATTEMPTS) {
                retryTimer = setTimeout(attemptCall, RETRY_DELAY_MS);
              }
            });
          }

          peer.on('open', () => {
            if (destroyed) return;
            // Expose attemptCall so triggerCall() can fire it at the right moment.
            attemptCallRef.current = () => {
              if (destroyed) return;
              if (retryTimer) clearTimeout(retryTimer);
              // Close any existing call before starting a fresh attempt.
              activeCallRef.current?.close();
              activeCallRef.current = null;
              callAttempts = 0;
              attemptCall();
            };
            // If triggerCall() already fired while peer was connecting, call now.
            if (callPendingRef.current) {
              callPendingRef.current = false;
              attemptCallRef.current();
            }
          });
        })
        .catch((err: Error) => {
          if (!destroyed) {
            setMicError(err.message);
            setPeerStatus('error');
          }
        });
    }

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      attemptCallRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      activeCallRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [roomId, role]);

  return { peerStatus, peerRegistered, localStream, remoteStream, micError, triggerCall };
}
