"use client";

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { createRoom, getParticipants, getToken, moderateParticipantMute, moderateParticipantScreenShare, moderateParticipantScreenShareMute, removeParticipantFromRoom } from "@/lib/api";
import {
  Copy,
  Check,
  MessageCircle,
  Play,
  Users,
  LogOut,
  Clock,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  UserMinus,
  Loader2,
  ScreenShareOff,
} from "lucide-react";
import { BrandIcon } from "./brand-icon";
import { isValidRoomId, readAdminToken, readCachedRoomId } from "@/lib/session";

const LS_PERMANENT_ROOM_ID = "techerudite_permanent_room_id";
const LS_PERMANENT_ROOM_URL = "techerudite_permanent_room_url";

export function AdminDashboard() {
  const { isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string>("");
  const [createError, setCreateError] = useState("");
  const [startMeetingError, setStartMeetingError] = useState("");
  const [participants, setParticipants] = useState<
    {
      identity: string;
      joinedAt: string;
      isPublishing: boolean;
      microphoneTrackSid: string | null;
      isMicrophoneMuted: boolean;
      screenShareAllowed: boolean;
      hasActiveScreenShare: boolean;
    }[]
  >([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [moderationBusy, setModerationBusy] = useState<string | null>(null);
  const [moderationError, setModerationError] = useState("");

  useEffect(() => {
    if (!isAdmin) {
      navigate("/admin/login");
    }
  }, [isAdmin, navigate]);

  useEffect(() => {
    if (typeof window === "undefined" || !readAdminToken()) {
      return;
    }
    const cachedId = readCachedRoomId(LS_PERMANENT_ROOM_ID);
    const cachedUrl = localStorage.getItem(LS_PERMANENT_ROOM_URL);
    if (cachedId && cachedUrl && cachedUrl.startsWith("http")) {
      setRoomId(cachedId);
      setRoomUrl(cachedUrl);
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await createRoom();
        if (cancelled) return;
        const id = isValidRoomId(data.roomId) ? data.roomId : null;
        const url =
          typeof data.roomUrl === "string" && data.roomUrl.length > 0
            ? data.roomUrl
            : id
              ? `${typeof window !== "undefined" ? window.location.origin : ""}/room/${id}`
              : "";
        setRoomId(id);
        setRoomUrl(url);
        if (id) localStorage.setItem(LS_PERMANENT_ROOM_ID, id);
        if (url) localStorage.setItem(LS_PERMANENT_ROOM_URL, url);
        setCreateError("");
      } catch {
        if (!cancelled) {
          setCreateError("Could not create room");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pollParticipants = useCallback(async (id: string) => {
    try {
      const data = await getParticipants(id);
      setParticipants(Array.isArray(data.participants) ? data.participants : []);
      setParticipantCount(typeof data.count === "number" ? data.count : 0);
    } catch {
      /* keep last known value */
    }
  }, []);

  useEffect(() => {
    if (!isValidRoomId(roomId)) return;
    void pollParticipants(roomId);
    const id = window.setInterval(() => {
      void pollParticipants(roomId);
    }, 5000);
    return () => window.clearInterval(id);
  }, [roomId, pollParticipants]);

  const handleCopyLink = async () => {
    if (!roomUrl) return;
    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    if (!roomUrl) return;
    const message = encodeURIComponent(`Join my meeting: ${roomUrl}`);
    window.open(`https://wa.me/?text=${message}`, "_blank");
  };

  const handleStartMeeting = async () => {
    setStartMeetingError("");
    if (!roomId) return;
    try {
      const { token, wsUrl } = await getToken(roomId, "admin", true);
      navigate(`/room/${roomId}`, {
        state: { token, wsUrl, isAdmin: true },
      });
    } catch (err) {
      setStartMeetingError(err instanceof Error ? err.message : "Could not start meeting");
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/admin/login");
  };

  const isHostIdentity = (identity: string) => identity === "admin";

  const runModeration = async (key: string, fn: () => Promise<void>) => {
    if (!roomId) return;
    setModerationError("");
    setModerationBusy(key);
    try {
      await fn();
      await pollParticipants(roomId);
    } catch (e) {
      setModerationError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setModerationBusy(null);
    }
  };

  const formatJoinedAt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center p-1">
                <BrandIcon className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold text-foreground">Techerudite</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Meeting Room Card */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-6">
            Your Meeting Room
          </h1>

          {createError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive-foreground">{createError}</p>
            </div>
          )}

          {/* Room Link */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Room Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={roomUrl ?? ""}
                readOnly
                className="flex-1 px-4 py-3 bg-secondary border border-border rounded-lg text-foreground text-sm font-mono"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                disabled={!roomUrl}
                className="px-4 py-3 bg-secondary border border-border rounded-lg hover:bg-accent transition-colors flex items-center gap-2 text-foreground disabled:opacity-50"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-green-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {/* <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={!roomUrl}
              className="flex-1 py-3 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <MessageCircle className="w-5 h-5" />
              Share via WhatsApp
            </button> */}
            <button
              type="button"
              onClick={handleStartMeeting}
              disabled={!roomId}
              className="flex-1 py-3 px-4 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Play className="w-5 h-5" />
              Start Meeting
            </button>
          </div>

          {startMeetingError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive-foreground">{startMeetingError}</p>
            </div>
          )}

          {/* Participant Count */}
          <div className="flex items-center gap-2 p-4 bg-secondary rounded-lg">
            <Users className="w-5 h-5 text-primary" />
            <span className="text-foreground font-medium">
              {participantCount} / 30 participants connected
            </span>
          </div>
        </div>

        {/* Participants List */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
          <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Connected Participants
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Controls map to LiveKit Room Service: <span className="font-medium">Remove</span> uses{" "}
            <span className="font-mono">removeParticipant</span>; <span className="font-medium">Mute</span> uses{" "}
            <span className="font-mono">mutePublishedTrack</span> on the microphone;{" "}
            <span className="font-medium">Stop share</span> uses{" "}
            <span className="font-mono">mutePublishedTrack</span> on screen share tracks;{" "}
            <span className="font-medium">Allow / Block share</span> uses{" "}
            <span className="font-mono">updateParticipant</span> (<span className="font-mono">canPublishSources</span>
            ). The host (<span className="font-mono">admin</span>) cannot be removed.
          </p>
          {moderationError && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive-foreground">{moderationError}</p>
            </div>
          )}

          {(participants ?? []).length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No participants connected yet
            </p>
          ) : (
            <div className="space-y-3">
              {(participants ?? []).map((participant) => (
                <div
                  key={participant.identity}
                  className="flex flex-col gap-3 p-4 bg-secondary rounded-lg sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center shrink-0">
                      <span className="text-primary font-semibold">
                        {participant.identity.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-foreground font-medium truncate">
                        {participant.identity}
                      </span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {participant.isPublishing && <span>Publishing</span>}
                        {participant.microphoneTrackSid && (
                          <span>
                            Mic: {participant.isMicrophoneMuted ? "muted" : "live"}
                          </span>
                        )}
                        <span>
                          Screen share: {participant.screenShareAllowed ? "allowed" : "blocked"}
                          {participant.hasActiveScreenShare ? " · live" : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm mr-auto sm:mr-0">
                      <Clock className="w-4 h-4 shrink-0" />
                      {formatJoinedAt(participant.joinedAt)}
                    </div>
                    <button
                      type="button"
                      disabled={
                        !roomId ||
                        moderationBusy !== null ||
                        !participant.microphoneTrackSid
                      }
                      onClick={() =>
                        void runModeration(`mute:${participant.identity}`, async () => {
                          await moderateParticipantMute(
                            roomId!,
                            participant.identity,
                            !participant.isMicrophoneMuted
                          );
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-accent disabled:opacity-50"
                      title={
                        participant.isMicrophoneMuted ? "Unmute microphone" : "Mute microphone"
                      }
                    >
                      {moderationBusy === `mute:${participant.identity}` ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : participant.isMicrophoneMuted ? (
                        <MicOff className="w-4 h-4" />
                      ) : (
                        <Mic className="w-4 h-4" />
                      )}
                      {participant.isMicrophoneMuted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        !roomId ||
                        moderationBusy !== null ||
                        !participant.hasActiveScreenShare
                      }
                      onClick={() =>
                        void runModeration(`ssmute:${participant.identity}`, async () => {
                          await moderateParticipantScreenShareMute(roomId!, participant.identity, true);
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-accent disabled:opacity-50"
                      title="Stop current screen share (server mute on screen share tracks)"
                    >
                      {moderationBusy === `ssmute:${participant.identity}` ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ScreenShareOff className="w-4 h-4" />
                      )}
                      Stop share
                    </button>
                    <button
                      type="button"
                      disabled={!roomId || moderationBusy !== null}
                      onClick={() =>
                        void runModeration(`ss:${participant.identity}`, async () => {
                          await moderateParticipantScreenShare(
                            roomId!,
                            participant.identity,
                            !participant.screenShareAllowed
                          );
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-xs font-medium hover:bg-accent disabled:opacity-50"
                      title={
                        participant.screenShareAllowed
                          ? "Disallow screen sharing"
                          : "Allow screen sharing"
                      }
                    >
                      {moderationBusy === `ss:${participant.identity}` ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : participant.screenShareAllowed ? (
                        <Monitor className="w-4 h-4" />
                      ) : (
                        <MonitorOff className="w-4 h-4" />
                      )}
                      {participant.screenShareAllowed ? "Block share" : "Allow share"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        !roomId ||
                        moderationBusy !== null ||
                        isHostIdentity(participant.identity)
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove "${participant.identity}" from the meeting? They can rejoin with the link.`
                          )
                        ) {
                          return;
                        }
                        void runModeration(`rm:${participant.identity}`, async () => {
                          await removeParticipantFromRoom(roomId!, participant.identity);
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/50 text-destructive-foreground text-xs font-medium hover:bg-destructive/10 disabled:opacity-50"
                      title="Remove from meeting"
                    >
                      {moderationBusy === `rm:${participant.identity}` ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UserMinus className="w-4 h-4" />
                      )}
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
