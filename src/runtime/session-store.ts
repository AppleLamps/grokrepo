import path from "node:path";

import { Session } from "./session.js";

export interface RestoredSession {
  session: Session;
  path: string;
  restored: boolean;
  error?: {
    code: "restore_failed";
    message: string;
  };
}

export function defaultSessionPath(cwd: string): string {
  return path.join(cwd, ".workspace", "sessions", "current.json");
}

export async function restoreOrCreateSession(cwd: string): Promise<RestoredSession> {
  const sessionPath = defaultSessionPath(cwd);

  try {
    return {
      session: await Session.restore(sessionPath),
      path: sessionPath,
      restored: true
    };
  } catch (cause) {
    if (isMissingFileError(cause)) {
      return {
        session: new Session(),
        path: sessionPath,
        restored: false
      };
    }

    return {
      session: new Session(),
      path: sessionPath,
      restored: false,
      error: {
        code: "restore_failed",
        message: cause instanceof Error ? cause.message : String(cause)
      }
    };
  }
}

export async function saveSession(session: Session, sessionPath: string): Promise<void> {
  await session.save(sessionPath);
}

function isMissingFileError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
