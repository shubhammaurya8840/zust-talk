import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { getStoredToken, API_BASE } from "../api/client";

export interface PresenceInfo {
  isOnline: boolean;
  lastSeenAt?: string | null;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  presenceMap: Record<string, PresenceInfo>;
  syncPresence: (userIds: string[]) => void;
  updatePresenceBulk: (entries: Array<{ userId: string; isOnline?: boolean; lastSeenAt?: string | null }>) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  presenceMap: {},
  syncPresence: () => {},
  updatePresenceBulk: () => {},
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceInfo>>({});

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      setPresenceMap({});
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    const s = io(API_BASE || undefined, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      setIsConnected(true);
    });

    s.on("disconnect", () => {
      setIsConnected(false);
    });

    s.on("presence:update", (data: { userId: string; isOnline: boolean; lastSeenAt?: string | null }) => {
      if (!data?.userId) return;
      setPresenceMap((prev) => ({
        ...prev,
        [data.userId]: {
          isOnline: data.isOnline,
          lastSeenAt: data.lastSeenAt ?? prev[data.userId]?.lastSeenAt ?? null,
        },
      }));
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [user]);

  const syncPresence = useCallback(
    (userIds: string[]) => {
      if (!socket || userIds.length === 0) return;
      socket.emit("presence:sync", userIds, (res: Record<string, PresenceInfo>) => {
        if (res && typeof res === "object") {
          setPresenceMap((prev) => ({ ...prev, ...res }));
        }
      });
    },
    [socket]
  );

  const updatePresenceBulk = useCallback(
    (entries: Array<{ userId: string; isOnline?: boolean; lastSeenAt?: string | null }>) => {
      setPresenceMap((prev) => {
        const next = { ...prev };
        for (const e of entries) {
          if (!e.userId) continue;
          next[e.userId] = {
            isOnline: Boolean(e.isOnline),
            lastSeenAt: e.lastSeenAt ?? prev[e.userId]?.lastSeenAt ?? null,
          };
        }
        return next;
      });
    },
    []
  );

  return (
    <SocketContext.Provider value={{ socket, isConnected, presenceMap, syncPresence, updatePresenceBulk }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
