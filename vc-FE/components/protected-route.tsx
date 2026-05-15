"use client";

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { readAdminToken } from "@/lib/session";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = readAdminToken();
  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
