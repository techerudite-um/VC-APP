"use client";

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/auth-context";
import { AdminLogin } from "./admin-login";
import { AdminDashboard } from "./admin-dashboard";
import { RoomPage } from "./room-page";
import { ProtectedRoute } from "./protected-route";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/login" replace />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/room/:roomId" element={<RoomPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
