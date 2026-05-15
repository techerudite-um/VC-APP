/** nanoid(10) room ids from the backend */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{8,21}$/;

const INVALID_STORED = new Set(["", "undefined", "null"]);

export function isValidRoomId(id: string | null | undefined): id is string {
  return typeof id === "string" && ROOM_ID_RE.test(id);
}

export function readAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("adminToken");
  if (!token || INVALID_STORED.has(token)) {
    if (token && INVALID_STORED.has(token)) {
      localStorage.removeItem("adminToken");
      localStorage.removeItem("isAdmin");
    }
    return null;
  }
  return token;
}

export function readCachedRoomId(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(storageKey);
  if (!id || INVALID_STORED.has(id) || !isValidRoomId(id)) {
    if (id) localStorage.removeItem(storageKey);
    return null;
  }
  return id;
}

export function assertValidRoomId(roomId: string): void {
  if (!isValidRoomId(roomId)) {
    throw new Error("Invalid room id");
  }
}
