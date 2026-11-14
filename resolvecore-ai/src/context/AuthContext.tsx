import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import type { NotificationItem, UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  wsConnected: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  lastWsEvent: { event: string; payload: any; ts: number } | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastWsEvent, setLastWsEvent] = useState<{ event: string; payload: any; ts: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const authModeRef = useRef<'none' | 'firebase' | 'session'>('none');

  const fetchNotifications = useCallback(async (activeToken: string) => {
    try {
      const data = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications', {
        token: activeToken,
      });
      setNotifications(data.notifications || []);
    } catch {
      // silent
    }
  }, []);

  // Restore Firebase Auth state cleanly without storing tokens in localStorage
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          authModeRef.current = 'firebase';
          const idToken = await fbUser.getIdToken();
          const data = await apiFetch<{ user: UserProfile }>('/api/auth/me', { token: idToken });
          setToken(idToken);
          setUser(data.user);
          await fetchNotifications(idToken);
        } catch {
          if (authModeRef.current === 'firebase') {
            setToken(null);
            setUser(null);
          }
        }
      } else if (authModeRef.current !== 'session') {
        setToken(null);
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [fetchNotifications]);

  // Connect real-time WebSocket when authenticated
  useEffect(() => {
    if (!token || !user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => setWsConnected(false);
    socket.onerror = () => setWsConnected(false);
    socket.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (parsed.event === 'notification:new' && parsed.payload) {
          setNotifications((prev) => {
            if (prev.some((n) => n.id === parsed.payload.id)) return prev;
            return [parsed.payload, ...prev];
          });
        }
        setLastWsEvent({ event: parsed.event, payload: parsed.payload, ts: Date.now() });
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      socket.close();
      wsRef.current = null;
    };
  }, [token, user]);

  const loginWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleAuthProvider);
    authModeRef.current = 'firebase';
    const idToken = await result.user.getIdToken();
    const data = await apiFetch<{ user: UserProfile }>('/api/auth/me', { token: idToken });
    setToken(idToken);
    setUser(data.user);
    await fetchNotifications(idToken);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    authModeRef.current = 'session';
    setToken(data.token);
    setUser(data.user);
    await fetchNotifications(data.token);
  };

  const registerWithEmail = async (payload: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => {
    const data = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    authModeRef.current = 'session';
    setToken(data.token);
    setUser(data.user);
    await fetchNotifications(data.token);
  };

  const logout = async () => {
    authModeRef.current = 'none';
    try {
      await signOut(auth);
    } catch {
      // ignore if session-only
    }
    setToken(null);
    setUser(null);
    setNotifications([]);
  };

  const refreshNotifications = async () => {
    if (token) await fetchNotifications(token);
  };

  const markNotificationRead = async (id: number) => {
    if (!token) return;
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH', token });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  };

  const markAllNotificationsRead = async () => {
    if (!token) return;
    await apiFetch('/api/notifications/read-all', { method: 'POST', token });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        notifications,
        unreadCount,
        wsConnected,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        logout,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        lastWsEvent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
