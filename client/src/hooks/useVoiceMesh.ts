import { useCallback, useEffect, useRef, useState } from "react";
import type { DuskSocket } from "../socket";

export type VoiceRosterUser = {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
};

type SignalPayload =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

function isSignalPayload(x: unknown): x is SignalPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as { type?: string };
  if (o.type === "offer" || o.type === "answer") return "sdp" in (x as object);
  if (o.type === "ice") return "candidate" in (x as object);
  return false;
}

export function useVoiceMesh(
  socket: DuskSocket | null,
  channelId: string | undefined,
  myUserId: string | undefined,
  enabled: boolean,
): {
  roster: VoiceRosterUser[];
  remoteStreams: Map<string, MediaStream>;
  localStream: MediaStream | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
} {
  const [roster, setRoster] = useState<VoiceRosterUser[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(() => new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const teardownPeers = useCallback(() => {
    for (const pc of peers.current.values()) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.close();
    }
    peers.current.clear();
    setRemoteStreams(new Map());
  }, []);

  const disconnect = useCallback(() => {
    if (channelId) socket?.emit("voice:leave", channelId);
    teardownPeers();
    for (const t of localStreamRef.current?.getTracks() ?? []) t.stop();
    localStreamRef.current = null;
    setLocalStream(null);
    setRoster([]);
    setError(null);
  }, [channelId, socket, teardownPeers]);

  const ensurePeer = useCallback(
    (remoteId: string, stream: MediaStream, initiator: boolean) => {
      if (!socket || !channelId || remoteId === myUserId) return;
      if (peers.current.has(remoteId)) return;
      const pc = new RTCPeerConnection({ iceServers: ICE });
      peers.current.set(remoteId, pc);
      for (const t of stream.getTracks()) pc.addTrack(t, stream);
      pc.onicecandidate = (e) => {
        if (e.candidate && channelId) {
          socket.emit("voice:signal", {
            channelId,
            to: remoteId,
            data: { type: "ice", candidate: e.candidate.toJSON() } satisfies SignalPayload,
          });
        }
      };
      pc.ontrack = (ev) => {
        const [ms] = ev.streams;
        if (ms) {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.set(remoteId, ms);
            return next;
          });
        }
      };
      if (initiator) {
        void pc
          .createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            const sdp = pc.localDescription;
            if (sdp && channelId) {
              socket.emit("voice:signal", {
                channelId,
                to: remoteId,
                data: { type: "offer", sdp: { type: sdp.type, sdp: sdp.sdp } } satisfies SignalPayload,
              });
            }
          })
          .catch(() => setError("webrtc offer failed"));
      }
    },
    [channelId, myUserId, socket],
  );

  const syncPeersToRoster = useCallback(
    (list: VoiceRosterUser[], stream: MediaStream) => {
      if (!myUserId) return;
      const ids = new Set(list.map((u) => u.id));
      for (const rid of peers.current.keys()) {
        if (!ids.has(rid)) {
          const pc = peers.current.get(rid);
          pc?.close();
          peers.current.delete(rid);
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(rid);
            return next;
          });
        }
      }
      for (const u of list) {
        if (u.id === myUserId) continue;
        const initiator = myUserId < u.id;
        ensurePeer(u.id, stream, initiator);
      }
    },
    [ensurePeer, myUserId],
  );

  useEffect(() => {
    if (!socket || !channelId || !enabled || !localStream) return;
    const stream = localStream;

    const onRoster = (payload: { channelId: string; roster: VoiceRosterUser[] }) => {
      if (payload.channelId !== channelId) return;
      setRoster(payload.roster);
      syncPeersToRoster(payload.roster, stream);
    };

    const onSignal = async ({ from, data }: { from: string; data: unknown }) => {
      if (!channelId || from === myUserId || !isSignalPayload(data)) return;
      let pc = peers.current.get(from);
      if (data.type === "offer") {
        if (!pc) {
          ensurePeer(from, stream, false);
          pc = peers.current.get(from);
        }
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const loc = pc.localDescription;
          if (loc) {
            socket.emit("voice:signal", {
              channelId,
              to: from,
              data: { type: "answer", sdp: { type: loc.type, sdp: loc.sdp } } satisfies SignalPayload,
            });
          }
        } catch {
          setError("webrtc answer failed");
        }
      } else if (data.type === "answer" && pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch {
          setError("webrtc remote answer failed");
        }
      } else if (data.type === "ice" && pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch {
          /* ignore stale ice */
        }
      }
    };

    socket.on("voice:roster", onRoster);
    socket.on("voice:signal", onSignal);
    return () => {
      socket.off("voice:roster", onRoster);
      socket.off("voice:signal", onSignal);
    };
  }, [channelId, enabled, ensurePeer, localStream, myUserId, socket, syncPeersToRoster]);

  const connect = useCallback(async () => {
    if (!socket || !channelId) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setLocalStream(stream);
      await new Promise<void>((resolve, reject) => {
        socket.emit("voice:join", channelId, (err?: string) => (err ? reject(new Error(err)) : resolve()));
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "mic denied or join failed";
      setError(msg);
      for (const t of localStreamRef.current?.getTracks() ?? []) t.stop();
      localStreamRef.current = null;
      setLocalStream(null);
      throw new Error(msg);
    }
  }, [channelId, socket]);

  return { roster, remoteStreams, localStream, error, connect, disconnect };
}
