import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';

export type PeerStatus = 'idle' | 'requesting_mic' | 'connecting' | 'connected' | 'error';

/** STUN plus time-limited TURN relay (coturn on the same host, see infra/coturn). */
async function fetchIceServers(roomId: string, token: string): Promise<RTCIceServer[]> {
  const host = window.location.hostname;
  const stun: RTCIceServer = { urls: `stun:${host}:3478` };
  try {
    const res = await fetch(
      `/api/rooms/${encodeURIComponent(roomId)}/turn-creds?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return [stun];
    const { username, password } = (await res.json()) as { username: string; password: string };
    return [
      stun,
      { urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential: password },
      { urls: `turns:${host}:5349?transport=tcp`, username, credential: password },
    ];
  } catch {
    // Without TURN, peers behind symmetric NAT can't connect — but STUN still covers most cases.
    return [stun];
  }
}

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// PeerJS errors that concern one call attempt, not the local peer — recoverable by calling again.
const TRANSIENT_PEER_ERRORS = new Set(['peer-unavailable', 'network', 'disconnected', 'server-error', 'socket-error']);

export function usePeer(opts: {
  roomId: string;
  role: 'tutor' | 'student';
  /** Room token — used to fetch TURN credentials. */
  token: string;
  /** Tutor only — transform the local mic stream before passing it to peer.call(). */
  processStream?: (stream: MediaStream) => MediaStream;
}): {
  peerStatus: PeerStatus;
  /** True once the local PeerJS peer has registered on the PeerServer (peer 'open' event). */
  peerRegistered: boolean;
  /** This side's PeerJS id — random per page load; student sends it in peer_ready. */
  localPeerId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micError: string | null;
  /** Tutor only — call this when peer_ready arrives from server to initiate the WebRTC call. */
  triggerCall: (remotePeerId: string) => void;
} {
  const { roomId, role, token } = opts;

  const [peerStatus, setPeerStatus] = useState<PeerStatus>('idle');
  const [peerRegistered, setPeerRegistered] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<MediaConnection | null>(null);
  // null until TURN credentials are fetched; the peer is not created before that.
  const [iceServers, setIceServers] = useState<RTCIceServer[] | null>(null);
  const processStreamRef = useRef(opts.processStream);

  // Tutor: set inside the effect once peer is open, called by triggerCall().
  const attemptCallRef = useRef<((remotePeerId: string) => void) | null>(null);
  // Remote id from a triggerCall() that fired before the peer was open.
  const callPendingRef = useRef<string | null>(null);

  const triggerCall = useCallback((remotePeerId: string) => {
    if (attemptCallRef.current) {
      attemptCallRef.current(remotePeerId);
    } else {
      callPendingRef.current = remotePeerId;
    }
  }, []);

  useEffect(() => {
    if (!roomId || !token) return;
    let cancelled = false;
    void fetchIceServers(roomId, token).then((servers) => {
      if (!cancelled) setIceServers(servers);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, token]);

  useEffect(() => {
    if (!roomId || !iceServers) return;

    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = 1000;

    const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, '');
    // Random suffix: after a reload the PeerServer may still hold the previous id for a while
    // and would reject a fixed one with 'unavailable-id'.
    const peerId = `${safeRoomId}-${role}-${randomSuffix()}`;
    const secure = window.location.protocol === 'https:';

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
        // Page port in dev (vite proxies /peerjs); empty in production → default 443/80
        port: Number(window.location.port) || (secure ? 443 : 80),
        path: '/peerjs',
        secure,
        config: { iceServers, iceTransportPolicy: 'all' },
      });
      peer.on('open', (id) => {
        reconnectDelayMs = 1000;
        if (!destroyed) setLocalPeerId(id);
      });
      // Signaling socket dropped (phone sleep, network switch) — media may survive, re-register.
      // Backoff: while the PeerServer is unreachable every reconnect fails at once.
      peer.on('disconnected', () => {
        if (destroyed || peer.destroyed || reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!destroyed && !peer.destroyed && peer.disconnected) peer.reconnect();
        }, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
      });
      peer.on('error', (err) => {
        console.error('PeerJS error:', err.type, err);
        if (destroyed) return;
        if (TRANSIENT_PEER_ERRORS.has(err.type)) {
          // The other side will announce itself again with peer_ready
          setPeerStatus((s) => (s === 'connected' ? s : 'connecting'));
          return;
        }
        setMicError(err.message);
        setPeerStatus('error');
      });
      return peer;
    }

    /** Wire stream/ICE state of one call into peerStatus. */
    function watchCall(call: MediaConnection) {
      const isCurrent = () => !destroyed && activeCallRef.current === call;

      call.on('stream', (remoteMediaStream) => {
        if (!isCurrent()) return;
        setRemoteStream(remoteMediaStream);
        setPeerStatus('connected');

        const pc = call.peerConnection;
        pc?.addEventListener('iceconnectionstatechange', () => {
          if (!isCurrent()) return;
          const ice = pc.iceConnectionState;
          if (ice === 'connected' || ice === 'completed') {
            setPeerStatus('connected');
          } else if (ice === 'disconnected') {
            // Often transient (network blip) — ICE may recover by itself
            setPeerStatus('connecting');
          } else if (ice === 'failed' || ice === 'closed') {
            setPeerStatus('connecting');
            call.close();
          }
        });
      });
      call.on('error', (e) => {
        console.error('Call error:', e);
        if (isCurrent()) setPeerStatus('connecting');
      });
      call.on('close', () => {
        if (!isCurrent()) return;
        activeCallRef.current = null;
        // Student: peerStatus leaves 'connected', so the page resumes sending peer_ready
        // and the tutor calls again.
        setPeerStatus('connecting');
      });
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
      const checkBothReady = () => {
        if (peerOpen && streamReady && !destroyed) setPeerRegistered(true);
      };

      peer.on('open', () => {
        if (!destroyed) { peerOpen = true; checkBothReady(); }
      });

      peer.on('call', (call) => {
        if (destroyed) return;
        activeCallRef.current?.close();
        activeCallRef.current = call;
        watchCall(call);
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
          // Calls closed on purpose because a newer peer_ready replaced them — must not retry
          const superseded = new WeakSet<MediaConnection>();
          const MAX_ATTEMPTS = 5;
          const CLOSE_GRACE_MS = 2000;
          const RETRY_DELAY_MS = 2000;

          const attemptCall = (remoteId: string) => {
            if (destroyed) return;
            callAttempts += 1;

            const txStream = processStreamRef.current ? processStreamRef.current(stream) : stream;
            const call = peer.call(remoteId, txStream);
            activeCallRef.current = call;
            const callStartedAt = Date.now();

            watchCall(call);
            call.on('close', () => {
              if (superseded.has(call)) return;
              const elapsed = Date.now() - callStartedAt;
              if (elapsed < CLOSE_GRACE_MS && callAttempts < MAX_ATTEMPTS) {
                retryTimer = setTimeout(() => attemptCall(remoteId), RETRY_DELAY_MS);
              }
            });
          };

          peer.on('open', () => {
            if (destroyed) return;
            // Expose attemptCall so triggerCall() can fire it at the right moment.
            attemptCallRef.current = (remoteId: string) => {
              if (destroyed) return;
              const current = activeCallRef.current;
              // Repeated peer_ready for the call that is already up — nothing to do
              if (current && current.peer === remoteId && current.open) return;
              if (retryTimer) clearTimeout(retryTimer);
              // Close any existing call before starting a fresh attempt.
              activeCallRef.current = null;
              if (current) {
                superseded.add(current);
                current.close();
              }
              callAttempts = 0;
              attemptCall(remoteId);
            };
            // If triggerCall() already fired while peer was connecting, call now.
            if (callPendingRef.current) {
              const remoteId = callPendingRef.current;
              callPendingRef.current = null;
              attemptCallRef.current(remoteId);
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      attemptCallRef.current = null;
      peerRef.current?.destroy();
      peerRef.current = null;
      activeCallRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalPeerId(null);
      setPeerRegistered(false);
    };
  }, [roomId, role, iceServers]);

  return { peerStatus, peerRegistered, localPeerId, localStream, remoteStream, micError, triggerCall };
}
