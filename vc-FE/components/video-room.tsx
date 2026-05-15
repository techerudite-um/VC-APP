"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  LiveKitRoom,
  useLocalParticipantPermissions,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  FocusLayout,
  FocusLayoutContainer,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import {
  supportsScreenSharing,
  isEqualTrackRef,
  isTrackReference,
  isWeb,
  log,
  type TrackReferenceOrPlaceholder,
  type WidgetState,
} from "@livekit/components-core";
import { RoomEvent, Track } from "livekit-client";
import * as React from "react";
import { LiveMeetGridLayout } from "./livemeet-grid-layout";
import { InRoomModerationPanel } from "./in-room-moderation-panel";
import { BrandIcon } from "./brand-icon";
import { useAuth } from "@/contexts/auth-context";
import { deleteRoom } from "@/lib/api";
import { isBrowserMediaPermissionDenied } from "@/lib/media-errors";
import {
  Mic,
  MicOff,
  Camera,
  CameraOff,
  MonitorUp,
  PhoneOff,
  Users,
  AlertTriangle,
  X,
} from "lucide-react";

/**
 * Mirrors {@link LiveMeetVideoConference} layout; students only render gallery tiles for
 * {@link visibleParticipants} (teacher `admin` only). Full-room audio is unchanged via {@link RoomAudioRenderer}.
 */
function TeacherStudentGalleryConference({
  meetingIsAdmin,
  className,
}: {
  meetingIsAdmin: boolean;
  className?: string;
}) {
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  const participants = useParticipants();
  const visibleParticipants = meetingIsAdmin
    ? participants
    : participants.filter((p) => p.identity === "admin");
  const visibleIdentities = useMemo(
    () => new Set(visibleParticipants.map((p) => p.identity)),
    [visibleParticipants],
  );

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const galleryTracks = useMemo(() => {
    if (meetingIsAdmin) return tracks;
    return tracks.filter((t) => visibleIdentities.has(t.participant.identity));
  }, [meetingIsAdmin, tracks, visibleIdentities]);

  const widgetUpdate = (state: WidgetState) => {
    log.debug("updating widget state", state);
    setWidgetState(state);
  };

  const layoutContext = useCreateLayoutContext();

  const screenShareTracks = galleryTracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);

  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = galleryTracks.filter((track) => !isEqualTrackRef(track, focusTrack));

  React.useEffect(() => {
    if (
      screenShareTracks.some((track) => track.publication.isSubscribed) &&
      lastAutoFocusedScreenShareTrack.current === null
    ) {
      log.debug("Auto set screen share focus:", { newScreenShareTrack: screenShareTracks[0] });
      layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid,
      )
    ) {
      log.debug("Auto clearing screen share focus.");
      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = galleryTracks.find(
        (tr) =>
          tr.participant.identity === focusTrack.participant.identity &&
          tr.source === focusTrack.source,
      );
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: updatedFocusTrack });
      }
    }
  }, [
    screenShareTracks
      .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
      .join(),
    focusTrack?.publication?.trackSid,
    galleryTracks,
  ]);

  return (
    <div className={["lk-video-conference", className].filter(Boolean).join(" ")}>
      {isWeb() && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={widgetUpdate}>
          <div className="lk-video-conference-inner">
            {!focusTrack ? (
              <div className="lk-grid-layout-wrapper">
                <LiveMeetGridLayout tracks={galleryTracks}>
                  <ParticipantTile />
                </LiveMeetGridLayout>
              </div>
            ) : (
              <div className="lk-focus-layout-wrapper">
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack && <FocusLayout trackRef={focusTrack} />}
                </FocusLayoutContainer>
              </div>
            )}
          </div>
          <Chat style={{ display: widgetState.showChat ? "grid" : "none" }} />
        </LayoutContextProvider>
      )}
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}

const MAX_PARTICIPANTS = 30;

/** Same mapping as LiveKit `ControlBar` for `ParticipantPermission.canPublishSources`. */
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
    return <div className="min-h-screen bg-background" aria-hidden />;
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
            "The browser blocked camera or microphone when joining. You can still use the room: allow access from the lock icon in the address bar, or turn the mic/camera on below when you are ready."
          );
        }
      }}
      onDisconnected={() => {
        if (meetingIsAdmin) {
          navigate("/admin/dashboard");
        } else {
          navigate("/");
        }
      }}
    >
      <VideoRoomChrome
        roomId={roomId}
        meetingIsAdmin={meetingIsAdmin}
        connectMediaError={connectMediaError}
        onDismissConnectMediaError={() => setConnectMediaError("")}
      />
    </LiveKitRoom>
  );
}

function VideoRoomChrome({
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
  const { isAdmin, adminToken } = useAuth();
  const canUseHostApi = Boolean(isAdmin && adminToken);
  const room = useRoomContext();
  const participants = useParticipants();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const localPermissions = useLocalParticipantPermissions();
  const [endMeetingError, setEndMeetingError] = useState("");
  const [deviceError, setDeviceError] = useState("");

  const canPublishScreenShare =
    localPermissions &&
    localPermissions.canPublish &&
    (localPermissions.canPublishSources.length === 0 ||
      localPermissions.canPublishSources.includes(trackSourceToProtocol(Track.Source.ScreenShare)));
  const showScreenShareButton =
    supportsScreenSharing() && (Boolean(canPublishScreenShare) || isScreenShareEnabled);

  const isRoomFull = participants.length >= MAX_PARTICIPANTS;

  const toggleMute = async () => {
    setDeviceError("");
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (e) {
      if (isBrowserMediaPermissionDenied(e)) {
        setDeviceError(
          "Microphone access was blocked. Click the lock or site settings icon in the address bar and allow the microphone for this site."
        );
      } else {
        setDeviceError(e instanceof Error ? e.message : "Could not change microphone");
      }
    }
  };

  const toggleCamera = async () => {
    setDeviceError("");
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (e) {
      if (isBrowserMediaPermissionDenied(e)) {
        setDeviceError(
          "Camera access was blocked. Allow the camera in the browser site settings, or keep the camera off."
        );
      } else {
        setDeviceError(e instanceof Error ? e.message : "Could not change camera");
      }
    }
  };

  const toggleScreenShare = async () => {
    setDeviceError("");
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch (e) {
      if (isBrowserMediaPermissionDenied(e)) {
        setDeviceError("Screen sharing was cancelled or blocked by the browser.");
      } else {
        setDeviceError(e instanceof Error ? e.message : "Could not change screen share");
      }
    }
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

            {canUseHostApi && (
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
        {(connectMediaError || deviceError) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            <span className="min-w-0 flex-1">{connectMediaError || deviceError}</span>
            <button
              type="button"
              onClick={() => {
                onDismissConnectMediaError();
                setDeviceError("");
              }}
              className="shrink-0 rounded p-0.5 hover:bg-amber-500/20"
              aria-label="Dismiss notice"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <InRoomModerationPanel roomId={roomId} />
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-x-clip p-2 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col">
          <TeacherStudentGalleryConference meetingIsAdmin={meetingIsAdmin} className="min-h-0 flex-1" />
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

          {showScreenShareButton && (
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
          )}

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
