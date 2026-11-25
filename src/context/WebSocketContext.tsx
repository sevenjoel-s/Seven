import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

export interface OnlinePeer {
  uid: string;
  displayName: string;
  availability: string;
  role?: string;
  accountType?: string;
}

type WSListener = (payload: Record<string, unknown>) => void;

interface WebSocketContextValue {
  connected: boolean;
  onlineUsers: OnlinePeer[];
  send: (payload: Record<string, unknown>) => void;
  subscribe: (listener: WSListener) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  connected: false,
  onlineUsers: [],
  send: () => {},
  subscribe: () => () => {},
});

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { firebaseUser, profile, getToken } = useAuth();
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlinePeer[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<WSListener>>(new Set());
  const reconnectTimerRef = useRef<number | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const subscribe = useCallback((listener: WSListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!firebaseUser || !profile || profile.status !== 'active') {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setOnlineUsers([]);
      return;
    }

    const connect = async () => {
      if (!active) return;
      const token = await getToken();
      if (!token || !active) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            token,
            displayName: profile.fullName,
            availability: profile.availability || 'available',
            role: profile.role,
            accountType: profile.accountType,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          if (data.type === 'auth:ok') {
            setConnected(true);
          } else if (data.type === 'presence:snapshot' && Array.isArray(data.users)) {
            setOnlineUsers(data.users as OnlinePeer[]);
          }
          for (const listener of listenersRef.current) {
            listener(data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (active) {
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [firebaseUser, profile?.uid, profile?.status]);

  useEffect(() => {
    if (connected && profile?.availability) {
      send({ type: 'presence:update', availability: profile.availability });
    }
  }, [connected, profile?.availability, send]);

  return (
    <WebSocketContext.Provider value={{ connected, onlineUsers, send, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export function useWebSocket() {
  return useContext(WebSocketContext);
}
