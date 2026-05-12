"use client";

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { getToken } from "@/lib/api";
import { Loader2, Users } from "lucide-react";
import { BrandIcon } from "./brand-icon";

const NAME_REGEX = /^[a-zA-Z0-9 _-]{1,30}$/;

export function UserJoin() {
  const { roomId } = useParams<{ roomId: string }>();
  const { isAdmin, adminToken } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [adminJoinBusy, setAdminJoinBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin || !adminToken || !roomId) return;
    let cancelled = false;
    setAdminJoinBusy(true);
    (async () => {
      try {
        const { token, wsUrl } = await getToken(roomId, "admin", true);
        if (cancelled) return;
        navigate(`/room/${roomId}`, {
          replace: true,
          state: { token, wsUrl, isAdmin: true },
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not join as admin");
          setAdminJoinBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, adminToken, roomId, navigate]);

  if (isAdmin && adminToken && roomId) {
    if (adminJoinBusy || !error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" aria-label="Loading" />
        </div>
      );
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter your name");
      return;
    }

    if (!NAME_REGEX.test(trimmedName)) {
      setError(
        "Name can only contain letters, numbers, spaces, hyphens and underscores (max 30 characters)"
      );
      return;
    }

    if (!roomId) {
      setError("Invalid room");
      return;
    }

    setIsLoading(true);

    try {
      const { token, wsUrl } = await getToken(roomId, trimmedName, false);
      navigate(`/room/${roomId}`, {
        replace: true,
        state: { token, wsUrl, isAdmin: false, participantName: trimmedName },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Room is full") {
        setError("This room is full (30/30)");
      } else if (msg === "Room not found") {
        setError("This meeting link is invalid or has ended");
      } else {
        setError("Could not join. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center p-1">
              <BrandIcon className="h-6 w-6" />
            </div>
            <span className="text-2xl font-bold text-foreground">Techerudite</span>
          </div>

          {/* Room Info */}
          <div className="flex items-center justify-center gap-2 mb-8 p-3 bg-secondary rounded-lg">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Joining room: <span className="font-mono text-foreground">{roomId}</span>
            </span>
          </div>

          <h2 className="text-xl font-semibold text-foreground text-center mb-6">
            Enter your name to join
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-foreground mb-2"
              >
                Your Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                className="w-full px-4 py-3 bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="Enter your name"
                required
                disabled={isLoading}
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground text-right">
                {name.length}/30 characters
              </p>
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive-foreground">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Joining...
                </>
              ) : (
                "Join Meeting"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
