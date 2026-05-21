"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  LiveKitRoom,
  useLocalParticipantPermissions,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  useTracks,
  VideoTrack,
  RoomAudioRenderer,
  ConnectionStateToast,
} from "@livekit/components-react";
import { DisconnectReason, RoomEvent, Track } from "livekit-client";
import { MeetVideoStage } from "./meet/meet-video-stage";
import { ControlBar } from "./control-bar";
import { MeetSidePanel, type ChatLine } from "./meet/meet-side-panel";
import {
  deleteRoom,
  getParticipants,
  getWaitingRoom,
  respondToWaitingRoom,
  syncAdminSubscriptions,
  syncHostSubscriptions,
} from "@/lib/api";
import { isBrowserMediaPermissionDenied } from "@/lib/media-errors";
import { decodeMeetMessage, encodeMeetMessage } from "@/lib/meet-messages";
import { listStudentIdentities, micMutedMapFromParticipants } from "@/lib/meet-moderation";
import {
  attachHostSubscriptionListeners,
  ensureHostSubscribedToRemotes,
  scheduleHostSubscriptionSync,
} from "@/lib/livekit-subscriptions";

function trackSourceToProtocol(source: Track.Source): number {
  switch (source) {
    case Track.Source.Camera:
      return 1;
    case Track.Source.Microphone:
      return 2;
    case Track.Source.ScreenShare:
      return 3;
    default:
      return 0;
  }
}

type VideoRoomLocationState = {
  token: string;
  wsUrl: string;
  isAdmin?: boolean;
  participantName?: string;
};

export function VideoRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as VideoRoomLocationState | null;
  const [connectMediaError, setConnectMediaError] = useState("");

  useEffect(() => {
    if (!state?.token || !state?.wsUrl) {
      const id = roomId ?? "";
      navigate(id ? `/room/${id}` : "/", { replace: true });
    }
  }, [state, roomId, navigate]);

  if (!state?.token || !state?.wsUrl || !roomId) {
    return <div className="min-h-screen bg-[#0f0f0f]" aria-hidden />;
  }

  const meetingIsAdmin = Boolean(state.isAdmin);

  return (
    <LiveKitRoom
      token={state.token}
      serverUrl={state.wsUrl}
      connect={true}
      onError={(err) => {
        if (isBrowserMediaPermissionDenied(err)) {
          setConnectMediaError(
            "Camera or microphone was blocked. Allow access in browser settings, or use the controls when ready.",
          );
        }
      }}
      onDisconnected={(reason) => {
        if (typeof window !== "undefined" && sessionStorage.getItem("meet-voluntary-leave") === "1") {
          sessionStorage.removeItem("meet-voluntary-leave");
          return;
        }

        const isAdminUser =
          meetingIsAdmin ||
          (typeof window !== "undefined" && localStorage.getItem("isAdmin") === "true");

        if (isAdminUser) {
          navigate("/admin/dashboard");
          return;
        }

        const endedByHost =
          reason === DisconnectReason.ROOM_DELETED ||
          reason === DisconnectReason.ROOM_CLOSED ||
          reason === DisconnectReason.SERVER_SHUTDOWN ||
          reason === DisconnectReason.PARTICIPANT_REMOVED;

        if (endedByHost && roomId) {
          navigate(`/room/${roomId}`, { replace: true, state: { meetingEnded: true } });
        } else {
          navigate(roomId ? `/room/${roomId}` : "/");
        }
      }}
    >
      <MeetRoomShell
        roomId={roomId}
        meetingIsAdmin={meetingIsAdmin}
        connectMediaError={connectMediaError}
        onDismissConnectMediaError={() => setConnectMediaError("")}
      />
    </LiveKitRoom>
  );
}

function AdminSelfView({ isCameraOn }: { isCameraOn: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  const localCameraTrack = cameraTracks.find(
    (t) => t.participant.identity === localParticipant.identity,
  );

  return (
    <div className="admin-self-view">
      {isCameraOn && localCameraTrack ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
          }}
        >
          <VideoTrack
            trackRef={localCameraTrack}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#2d2e31",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              backgroundColor: "#5f6368",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
              fontWeight: 700,
              color: "white",
            }}
          >
            A
          </div>
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: "6px",
          left: "8px",
          backgroundColor: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          borderRadius: "4px",
          padding: "2px 6px",
          fontSize: "11px",
          fontWeight: 600,
          color: "white",
        }}
      >
        You
      </div>
    </div>
  );
}

function MeetRoomShell({
  roomId,
  meetingIsAdmin,
  connectMediaError,
  onDismissConnectMediaError,
}: {
  roomId: string;
  meetingIsAdmin: boolean;
  connectMediaError: string;
  onDismissConnectMediaError: () => void;
}) {
  const navigate = useNavigate();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const localPermissions = useLocalParticipantPermissions();

  const [panelTab, setPanelTab] = useState<"participants" | "chat" | null>(null);
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});
  const [handRaised, setHandRaised] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatLine[]>([]);
  const [unreadChat, setUnreadChat] = useState(false);
  const [screenShareAllowed, setScreenShareAllowed] = useState<Record<string, boolean>>({});
  const [serverMicMuted, setServerMicMuted] = useState<Record<string, boolean>>({});
  const [deviceError, setDeviceError] = useState("");
  const [endMeetingError, setEndMeetingError] = useState("");
  const [waitingList, setWaitingList] = useState<
    { identity: string; name: string; requestedAt: string }[]
  >([]);
  const [showPopup, setShowPopup] = useState(false);
  const [pendingPopup, setPendingPopup] = useState<{
    identity: string;
    name: string;
    requestedAt: string;
  } | null>(null);
  const syncServerMicMuted = useCallback(async () => {
    if (!meetingIsAdmin) return;
    try {
      const { participants: list } = await getParticipants(roomId);
      setServerMicMuted(micMutedMapFromParticipants(list));
    } catch {
      /* keep last known map */
    }
  }, [meetingIsAdmin, roomId]);

  useEffect(() => {
    const bump = () => {
      if (meetingIsAdmin) void syncServerMicMuted();
    };
    room.on(RoomEvent.TrackMuted, bump);
    room.on(RoomEvent.TrackUnmuted, bump);
    room.on(RoomEvent.TrackPublished, bump);
    room.on(RoomEvent.TrackUnpublished, bump);
    return () => {
      room.off(RoomEvent.TrackMuted, bump);
      room.off(RoomEvent.TrackUnmuted, bump);
      room.off(RoomEvent.TrackPublished, bump);
      room.off(RoomEvent.TrackUnpublished, bump);
    };
  }, [room, meetingIsAdmin, syncServerMicMuted]);

  const canPublishScreenShare =
    meetingIsAdmin ||
    (localPermissions &&
      localPermissions.canPublish &&
      (localPermissions.canPublishSources.length === 0 ||
        localPermissions.canPublishSources.includes(
          trackSourceToProtocol(Track.Source.ScreenShare),
        )));

  const screenShareDisabled =
    !meetingIsAdmin && !canPublishScreenShare && !isScreenShareEnabled;

  const syncScreenShareAllowed = useCallback(async () => {
    if (!meetingIsAdmin) return;
    try {
      const { participants: list } = await getParticipants(roomId);
      const next: Record<string, boolean> = {};
      for (const p of list) {
        if (p.identity !== "admin") {
          next[p.identity] = p.screenShareAllowed;
        }
      }
      setScreenShareAllowed(next);
    } catch {
      /* panel can still toggle manually */
    }
  }, [meetingIsAdmin, roomId]);

  useEffect(() => {
    if (!meetingIsAdmin || panelTab !== "participants") return;
    void syncScreenShareAllowed();
    void syncServerMicMuted();
    const id = window.setInterval(() => {
      void syncScreenShareAllowed();
      void syncServerMicMuted();
    }, 3000);
    return () => window.clearInterval(id);
  }, [meetingIsAdmin, panelTab, participants.length, syncScreenShareAllowed, syncServerMicMuted]);

  useEffect(() => {
    if (!meetingIsAdmin) return;

    const pollWaiting = async () => {
      try {
        const result = await getWaitingRoom(roomId);
        const newList = result.participants || [];

        setWaitingList((prev) => {
          const newRequests = newList.filter(
            (p) => !prev.find((w) => w.identity === p.identity),
          );

          if (newRequests.length === 1) {
            setShowPopup((popupOpen) => {
              if (!popupOpen) {
                setPendingPopup(newRequests[0]);
                return true;
              }
              return popupOpen;
            });
          } else if (newRequests.length > 1) {
            setShowPopup(false);
            setPendingPopup(null);
          }

          return newList;
        });
      } catch (e) {
        console.warn("Waiting room poll failed:", e instanceof Error ? e.message : e);
      }
    };

    void pollWaiting();
    const interval = window.setInterval(() => void pollWaiting(), 3000);
    return () => window.clearInterval(interval);
  }, [meetingIsAdmin, roomId]);

  const handleWaitingRespond = async (targetIdentity: string, action: "approve" | "deny") => {
    await respondToWaitingRoom(roomId, targetIdentity, action);
    setWaitingList((prev) => prev.filter((w) => w.identity !== targetIdentity));
    if (pendingPopup?.identity === targetIdentity) {
      setShowPopup(false);
      setPendingPopup(null);
    }
  };

  const runServerSubscriptionSync = useCallback(
    (full: boolean) => {
      if (meetingIsAdmin && full) {
        void syncAdminSubscriptions(roomId).catch(() => undefined);
      } else {
        void syncHostSubscriptions(roomId).catch(() => undefined);
      }
    },
    [meetingIsAdmin, roomId],
  );

  const scheduleSubscriptionSync = useCallback(
    (full: boolean) => {
      if (meetingIsAdmin) {
        ensureHostSubscribedToRemotes(room);
      }
      scheduleHostSubscriptionSync(() => runServerSubscriptionSync(full));
    },
    [meetingIsAdmin, runServerSubscriptionSync, room],
  );

  useEffect(() => {
    if (!meetingIsAdmin) return;
    return attachHostSubscriptionListeners(room, () => {
      scheduleHostSubscriptionSync(() => runServerSubscriptionSync(true));
    });
  }, [room, meetingIsAdmin, runServerSubscriptionSync]);

  const publishData = useCallback(
    async (msg: Parameters<typeof encodeMeetMessage>[0]) => {
      await localParticipant.publishData(encodeMeetMessage(msg), { reliable: true });
    },
    [localParticipant],
  );

  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      participant?: { identity?: string },
      _kind?: unknown,
      topic?: string,
    ) => {
      const msg = decodeMeetMessage(payload);
      if (!msg) return;

      if (msg.type === "RAISE_HAND") {
        setRaisedHands((prev) => ({ ...prev, [msg.identity]: msg.raised }));
        return;
      }

      if (msg.type === "LOWER_HAND_BY_ADMIN") {
        if (msg.identity === localParticipant.identity) {
          setHandRaised(false);
          void publishData({ type: "RAISE_HAND", identity: msg.identity, raised: false });
        }
        setRaisedHands((prev) => ({ ...prev, [msg.identity]: false }));
        return;
      }

      if (msg.type === "CHAT") {
        if (msg.sender === localParticipant.identity) return;
        const line: ChatLine = {
          id: `${msg.time}-${msg.sender}-${Math.random()}`,
          sender: msg.sender,
          text: msg.text,
          time: msg.time,
        };
        setChatMessages((prev) => [...prev, line]);
        if (panelTab !== "chat") setUnreadChat(true);
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, localParticipant.identity, panelTab, publishData]);

  const togglePanel = (tab: "participants" | "chat") => {
    setPanelTab((cur) => (cur === tab ? null : tab));
    if (tab === "chat") setUnreadChat(false);
  };

  const toggleRaiseHand = async () => {
    const next = !handRaised;
    setHandRaised(next);
    await publishData({
      type: "RAISE_HAND",
      identity: localParticipant.identity,
      raised: next,
    });
    setRaisedHands((prev) => ({ ...prev, [localParticipant.identity]: next }));
  };

  const sendChat = async (text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sender = localParticipant.identity;
    const line: ChatLine = {
      id: `${Date.now()}-${sender}`,
      sender,
      text,
      time,
    };
    setChatMessages((prev) => [...prev, line]);
    await publishData({ type: "CHAT", sender, text, time });
  };

  const lowerHandAsAdmin = async (identity: string) => {
    await publishData({ type: "LOWER_HAND_BY_ADMIN", identity });
    setRaisedHands((prev) => ({ ...prev, [identity]: false }));
  };

  const toggleMute = async () => {
    setDeviceError("");
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (e) {
      setDeviceError(
        isBrowserMediaPermissionDenied(e)
          ? "Microphone blocked in browser settings."
          : e instanceof Error
            ? e.message
            : "Could not change microphone",
      );
    }
  };

  const toggleCamera = async () => {
    setDeviceError("");
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (e) {
      setDeviceError(
        isBrowserMediaPermissionDenied(e)
          ? "Camera blocked in browser settings."
          : e instanceof Error
            ? e.message
            : "Could not change camera",
      );
    }
  };

  const toggleScreenShare = async () => {
    if (screenShareDisabled) return;
    setDeviceError("");
    try {
      const enabling = !isScreenShareEnabled;
      await localParticipant.setScreenShareEnabled(enabling);
      if (enabling) {
        scheduleSubscriptionSync(meetingIsAdmin);
        if (!meetingIsAdmin) {
          scheduleHostSubscriptionSync(() => runServerSubscriptionSync(false));
        }
      }
    } catch (e) {
      setDeviceError(
        isBrowserMediaPermissionDenied(e)
          ? "Screen share was cancelled or blocked."
          : e instanceof Error
            ? e.message
            : "Could not change screen share",
      );
    }
  };

  const handleLeave = () => {
    if (!window.confirm("Leave this meeting?")) return;
    sessionStorage.setItem("meet-voluntary-leave", "1");
    void room.disconnect();
    navigate(meetingIsAdmin ? "/admin/dashboard" : roomId ? `/room/${roomId}` : "/");
  };

  const handleEndMeeting = async () => {
    if (!window.confirm("End meeting for all?")) return;
    setEndMeetingError("");
    try {
      await deleteRoom(roomId);
      await room.disconnect();
      navigate("/admin/dashboard");
    } catch {
      setEndMeetingError("Failed to end meeting.");
    }
  };

  const banner = connectMediaError || deviceError || endMeetingError;

  return (
    <div className="relative flex h-[100svh] max-h-[100svh] w-full flex-col overflow-hidden bg-[#0f0f0f] text-[#e8eaed]">
      {showPopup && pendingPopup && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#2d2e31",
            border: "1px solid #3c3d40",
            borderRadius: "14px",
            padding: "20px 24px",
            zIndex: 200,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            minWidth: "320px",
            maxWidth: "400px",
          }}
        >
          <p
            style={{
              color: "#e8eaed",
              fontSize: "15px",
              fontWeight: 500,
              marginBottom: "4px",
            }}
          >
            Someone wants to join
          </p>
          <p style={{ color: "#9aa0a6", fontSize: "14px", marginBottom: "20px" }}>
            <strong style={{ color: "white" }}>{pendingPopup.name}</strong> is waiting to be
            admitted
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void handleWaitingRespond(pendingPopup.identity, "deny")}
              style={{
                background: "transparent",
                color: "#ea4335",
                border: "1px solid #ea4335",
                borderRadius: "8px",
                padding: "8px 20px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => void handleWaitingRespond(pendingPopup.identity, "approve")}
              style={{
                background: "#1a73e8",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "8px 20px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Admit
            </button>
          </div>
        </div>
      )}

      {banner && (
        <div className="absolute left-1/2 top-2 z-30 max-w-lg -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs">
          <span>{banner}</span>
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              onDismissConnectMediaError();
              setDeviceError("");
              setEndMeetingError("");
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <main
        className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3"
        style={{ paddingBottom: "var(--meet-ctrl-bar-height, 72px)" }}
      >
        <div className="h-full min-h-0">
          <MeetVideoStage
            meetingIsAdmin={meetingIsAdmin}
            raisedHands={raisedHands}
            excludeIdentity={meetingIsAdmin ? localParticipant.identity : undefined}
            isCameraOn={isCameraEnabled}
          />
        </div>
      </main>

      <RoomAudioRenderer />
      <ConnectionStateToast />

      {meetingIsAdmin && <AdminSelfView isCameraOn={isCameraEnabled} />}

      <ControlBar
        isMicOn={isMicrophoneEnabled}
        isCameraOn={isCameraEnabled}
        isScreenSharing={isScreenShareEnabled}
        isScreenShareAllowed={Boolean(canPublishScreenShare)}
        isAdmin={meetingIsAdmin}
        isHandRaised={handRaised}
        participantCount={listStudentIdentities(participants).length}
        hasUnreadChat={unreadChat}
        onToggleMic={() => void toggleMute()}
        onToggleCamera={() => void toggleCamera()}
        onToggleScreenShare={() => void toggleScreenShare()}
        onToggleParticipants={() => togglePanel("participants")}
        onToggleChat={() => togglePanel("chat")}
        onRaiseHand={() => void toggleRaiseHand()}
        onLeave={handleLeave}
        onEndMeeting={() => void handleEndMeeting()}
      />

      <MeetSidePanel
        roomId={roomId}
        meetingIsAdmin={meetingIsAdmin}
        open={panelTab !== null}
        tab={panelTab ?? "participants"}
        onClose={() => setPanelTab(null)}
        onTabChange={(t) => {
          setPanelTab(t);
          if (t === "chat") setUnreadChat(false);
        }}
        participants={participants}
        waitingParticipants={waitingList}
        onWaitingRespond={(id, action) => void handleWaitingRespond(id, action)}
        raisedHands={raisedHands}
        screenShareAllowed={screenShareAllowed}
        onScreenShareAllowedChange={(identity, allowed) => {
          setScreenShareAllowed((prev) => ({ ...prev, [identity]: allowed }));
        }}
        serverMicMuted={serverMicMuted}
        onServerMicMutedChange={(identity, muted) => {
          setServerMicMuted((prev) => ({ ...prev, [identity]: muted }));
        }}
        onServerMicMutedBulkChange={(next) => {
          setServerMicMuted((prev) => ({ ...prev, ...next }));
        }}
        onLowerHand={(id) => void lowerHandAsAdmin(id)}
        chatMessages={chatMessages}
        onSendChat={(t) => void sendChat(t)}
      />
    </div>
  );
}
