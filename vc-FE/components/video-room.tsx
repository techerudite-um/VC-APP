"use client";

import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  LiveKitRoom,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
} from "@livekit/components-react";
import { LiveMeetVideoConference } from "./livemeet-video-conference";
import { BrandIcon } from "./brand-icon";
import { deleteRoom } from "@/lib/api";
import {
  Mic,
  MicOff,
  Camera,
  CameraOff,
  MonitorUp,
  PhoneOff,
  Users,
  AlertTriangle,
} from "lucide-react";

const MAX_PARTICIPANTS = 30;

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

  useEffect(() => {
    if (!state?.token || !state?.wsUrl) {
      const id = roomId ?? "";
      navigate(id ? `/room/${id}` : "/", { replace: true });
    }
  }, [state, roomId, navigate]);

  if (!state?.token || !state?.wsUrl || !roomId) {
    return <div className="min-h-screen bg-background" aria-hidden />;
  }

  const meetingIsAdmin = Boolean(state.isAdmin);

  return (
    <LiveKitRoom
      token={state.token}
      serverUrl={state.wsUrl}
      connect={true}
      audio
      video
      onDisconnected={() => {
        if (meetingIsAdmin) {
          navigate("/admin/dashboard");
        } else {
          navigate("/");
        }
      }}
    >
      <VideoRoomChrome roomId={roomId} />
    </LiveKitRoom>
  );
}

function VideoRoomChrome({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const room = useRoomContext();
  const participants = useParticipants();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const [endMeetingError, setEndMeetingError] = useState("");

  const isRoomFull = participants.length >= MAX_PARTICIPANTS;
  const isAdminStorage =
    typeof window !== "undefined" && localStorage.getItem("isAdmin") === "true";

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const toggleCamera = async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  };

  const toggleScreenShare = async () => {
    await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
  };

  const handleLeave = () => {
    if (!window.confirm("Leave this meeting?")) return;
    void room.disconnect();
  };

  const handleEndMeetingForAll = async () => {
    if (!window.confirm("End meeting for all participants?")) return;
    setEndMeetingError("");
    try {
      await deleteRoom(roomId);
      await room.disconnect();
      navigate("/admin/dashboard");
    } catch {
      setEndMeetingError("Failed to end meeting. Try again.");
    }
  };

  return (
    <div className="livemeet-room flex min-h-0 flex-col overflow-hidden bg-background max-lg:h-[100svh] max-lg:max-h-[100svh] lg:min-h-screen">
      {isRoomFull && (
        <div className="shrink-0 bg-destructive/20 border-b border-destructive/30 px-3 py-2 sm:px-4 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-destructive-foreground" />
          <span className="text-destructive-foreground text-xs sm:text-sm font-medium text-center">
            Room is full (30/30 participants)
          </span>
        </div>
      )}

      <header className="shrink-0 bg-card border-b border-border px-3 py-2 sm:px-4 sm:py-3 flex flex-col gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 shrink-0 bg-primary rounded-lg flex items-center justify-center p-1">
              <BrandIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-foreground font-semibold text-sm sm:text-base">Techerudite</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground font-mono truncate">
                {roomId}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
            <div className="flex items-center gap-2 self-stretch px-2.5 py-1.5 sm:self-auto sm:px-3 bg-secondary rounded-lg sm:shrink-0">
              <Users className="w-4 h-4 shrink-0 text-primary" />
              <span className="text-xs sm:text-sm text-foreground font-medium tabular-nums">
                {participants.length} / {MAX_PARTICIPANTS}
              </span>
            </div>

            {isAdminStorage && (
              <button
                type="button"
                onClick={() => void handleEndMeetingForAll()}
                className="w-full sm:w-auto px-3 py-2 sm:px-4 border border-destructive text-destructive-foreground rounded-lg hover:bg-destructive/10 transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
              >
                End Meeting for All
              </button>
            )}
          </div>
        </div>
        {endMeetingError && (
          <p className="text-sm text-destructive-foreground">{endMeetingError}</p>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-x-clip p-2 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col">
          <LiveMeetVideoConference className="min-h-0 flex-1" />
        </div>
      </main>

      <footer className="shrink-0 bg-card border-t border-border px-3 py-3 sm:px-4 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => void toggleMute()}
            className={`p-4 rounded-full transition-colors ${
              !isMicrophoneEnabled
                ? "bg-destructive/20 text-destructive-foreground hover:bg-destructive/30"
                : "bg-secondary text-foreground hover:bg-accent"
            }`}
            title={!isMicrophoneEnabled ? "Unmute" : "Mute"}
          >
            {!isMicrophoneEnabled ? (
              <MicOff className="w-6 h-6" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void toggleCamera()}
            className={`p-4 rounded-full transition-colors ${
              !isCameraEnabled
                ? "bg-destructive/20 text-destructive-foreground hover:bg-destructive/30"
                : "bg-secondary text-foreground hover:bg-accent"
            }`}
            title={!isCameraEnabled ? "Turn on camera" : "Turn off camera"}
          >
            {!isCameraEnabled ? (
              <CameraOff className="w-6 h-6" />
            ) : (
              <Camera className="w-6 h-6" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void toggleScreenShare()}
            className={`p-4 rounded-full transition-colors ${
              isScreenShareEnabled
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-secondary text-foreground hover:bg-accent"
            }`}
            title={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          >
            <MonitorUp className="w-6 h-6" />
          </button>

          <button
            type="button"
            onClick={handleLeave}
            className="p-4 bg-destructive text-white rounded-full hover:bg-destructive/90 transition-colors"
            title="Leave meeting"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </footer>
    </div>
  );
}
