"use client";

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { createRoom, getParticipants, getToken } from "@/lib/api";
import {
  Copy,
  Check,
  MessageCircle,
  Play,
  Users,
  LogOut,
  Clock,
} from "lucide-react";
import { BrandIcon } from "./brand-icon";

export function AdminDashboard() {
  const { isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomUrl, setRoomUrl] = useState<string>("");
  const [createError, setCreateError] = useState("");
  const [startMeetingError, setStartMeetingError] = useState("");
  const [participants, setParticipants] = useState<
    { identity: string; joinedAt: string; isPublishing: boolean }[]
  >([]);
  const [participantCount, setParticipantCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) {
      navigate("/admin/login");
    }
  }, [isAdmin, navigate]);

  useEffect(() => {
    if (typeof window === "undefined" || !localStorage.getItem("adminToken")) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await createRoom();
        if (cancelled) return;
        setRoomId(data.roomId);
        setRoomUrl(data.roomUrl);
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
      setParticipants(data.participants);
      setParticipantCount(data.count);
    } catch {
      /* keep last known value */
    }
  }, []);

  useEffect(() => {
    if (!roomId) return;
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
                value={roomUrl}
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
            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={!roomUrl}
              className="flex-1 py-3 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <MessageCircle className="w-5 h-5" />
              Share via WhatsApp
            </button>
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

          {participants.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No participants connected yet
            </p>
          ) : (
            <div className="space-y-3">
              {participants.map((participant) => (
                <div
                  key={participant.identity}
                  className="flex items-center justify-between p-4 bg-secondary rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                      <span className="text-primary font-semibold">
                        {participant.identity.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-foreground font-medium">
                        {participant.identity}
                      </span>
                      {participant.isPublishing && (
                        <span className="text-xs text-muted-foreground">Publishing</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Clock className="w-4 h-4" />
                    {formatJoinedAt(participant.joinedAt)}
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
