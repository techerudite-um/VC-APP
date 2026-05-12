"use client";

import { useLocation } from "react-router-dom";
import { UserJoin } from "./user-join";
import { VideoRoom } from "./video-room";

type JoinState = { token?: string; wsUrl?: string; isAdmin?: boolean };

export function RoomPage() {
  const location = useLocation();
  const state = location.state as JoinState | null;

  if (state?.token && state?.wsUrl) {
    return <VideoRoom />;
  }

  return <UserJoin />;
}
