"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { readAdminToken } from "@/lib/session";

interface AuthContextType {
  isAdmin: boolean;
  adminToken: string | null;
  isLoading: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminToken, setAdminToken] = useState<string | null>(() => readAdminToken());
  const [isAdmin, setIsAdmin] = useState(
    () => typeof window !== "undefined" && readAdminToken() !== null && localStorage.getItem("isAdmin") === "true"
  );
  const [isLoading] = useState(false);

  function login(token: string) {
    localStorage.setItem("adminToken", token);
    localStorage.setItem("isAdmin", "true");
    setAdminToken(token);
    setIsAdmin(true);
  }

  function logout() {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("isAdmin");
    setAdminToken(null);
    setIsAdmin(false);
  }

  return (
    <AuthContext.Provider value={{ adminToken, isAdmin, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
