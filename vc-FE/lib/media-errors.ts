/** Browser / LiveKit denial when the user blocks camera, mic, or screen share. */
export function isBrowserMediaPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("permission denied") || msg.includes("notallowed");
}
