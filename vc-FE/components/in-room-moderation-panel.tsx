"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import {
  getParticipants,
  moderateParticipantMute,
  moderateParticipantScreenShare,
  moderateParticipantScreenShareMute,
  removeParticipantFromRoom,
} from "@/lib/api";
import { Loader2, Mic, MicOff, Monitor, MonitorOff, ScreenShareOff, UserMinus } from "lucide-react";

type ParticipantRow = {
  identity: string;
  joinedAt: string;
  isPublishing: boolean;
  microphoneTrackSid: string | null;
  isMicrophoneMuted: boolean;
  screenShareAllowed: boolean;
  hasActiveScreenShare: boolean;
};

export function InRoomModerationPanel({ roomId }: { roomId: string }) {
  const { isAdmin, adminToken } = useAuth();
  const canModerate = Boolean(isAdmin && adminToken);

  const [rows, setRows] = useState<ParticipantRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!canModerate || !roomId) return;
    try {
      const data = await getParticipants(roomId);
      setRows(data.participants);
      setError("");
    } catch {
      /* keep list; avoid spamming errors while room spins up */
    }
  }, [canModerate, roomId]);

  useEffect(() => {
    if (!canModerate) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [canModerate, refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setError("");
    setBusyKey(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  };

  if (!canModerate) return null;

  const isHostIdentity = (identity: string) => identity === "admin";

  return (
    <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5 sm:px-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3 mb-2">
        <p className="text-xs font-medium text-foreground">Host controls (this meeting)</p>
        <Link
          to="/admin/dashboard"
          className="text-xs text-primary hover:underline shrink-0"
        >
          Open full dashboard
        </Link>
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        Mute, stop screen share, allow/block sharing, or remove participants via the LiveKit server API.
        These controls are only here when you are logged in as an admin.
      </p>
      {error && (
        <p className="text-xs text-destructive-foreground mb-2" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No remote list yet — waiting for LiveKit…</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
          {rows.map((p) => (
            <li
              key={p.identity}
              className="flex flex-col gap-2 rounded-md border border-border/80 bg-card/80 p-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">{p.identity}</span>
                <span className="text-[10px] text-muted-foreground">
                  Mic {p.isMicrophoneMuted ? "muted" : "live"}
                  {p.hasActiveScreenShare ? " · sharing screen" : ""}
                  {" · "}
                  share {p.screenShareAllowed ? "allowed" : "blocked"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 sm:shrink-0">
                <button
                  type="button"
                  disabled={busyKey !== null || !p.microphoneTrackSid}
                  onClick={() =>
                    void run(`m:${p.identity}`, () =>
                      moderateParticipantMute(roomId, p.identity, !p.isMicrophoneMuted)
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                  title={p.isMicrophoneMuted ? "Unmute" : "Mute"}
                >
                  {busyKey === `m:${p.identity}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : p.isMicrophoneMuted ? (
                    <MicOff className="size-3.5" />
                  ) : (
                    <Mic className="size-3.5" />
                  )}
                  {p.isMicrophoneMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null || !p.hasActiveScreenShare}
                  onClick={() =>
                    void run(`ssm:${p.identity}`, () =>
                      moderateParticipantScreenShareMute(roomId, p.identity, true)
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                  title="Stop current screen share"
                >
                  {busyKey === `ssm:${p.identity}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ScreenShareOff className="size-3.5" />
                  )}
                  Stop share
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() =>
                    void run(`ss:${p.identity}`, () =>
                      moderateParticipantScreenShare(roomId, p.identity, !p.screenShareAllowed)
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                  title={p.screenShareAllowed ? "Block sharing" : "Allow sharing"}
                >
                  {busyKey === `ss:${p.identity}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : p.screenShareAllowed ? (
                    <Monitor className="size-3.5" />
                  ) : (
                    <MonitorOff className="size-3.5" />
                  )}
                  {p.screenShareAllowed ? "Block" : "Allow"}
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null || isHostIdentity(p.identity)}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remove "${p.identity}" from the meeting? They can rejoin with the link.`
                      )
                    ) {
                      return;
                    }
                    void run(`rm:${p.identity}`, () => removeParticipantFromRoom(roomId, p.identity));
                  }}
                  className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/10 disabled:opacity-50"
                  title="Remove from meeting"
                >
                  {busyKey === `rm:${p.identity}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="size-3.5" />
                  )}
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
