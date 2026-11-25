import React, { useState, useEffect, useRef, useCallback } from "react";
import { NearbyUser, ConnectionRequestItem } from "../types";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { api } from "../api/client";
import { UserAvatar } from "../utils/avatars";
import { formatLastSeen } from "../utils/presence";
import { useBackLayer } from "../utils/useBackNavigation";
import { NearbyProfileModal } from "./NearbyProfileModal";
import {
  ArrowLeft,
  Radar,
  RefreshCw,
  EyeOff,
  Eye,
  MapPin,
  Users,
  UserPlus,
  Check,
  X,
  MessageSquare,
  AlertCircle,
  Power,
  Clock,
  WifiOff,
} from "lucide-react";

interface NearbyRadarPageProps {
  onBack: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRequestsCountChange?: (count: number) => void;
  initialTab?: "NEARBY" | "REQUESTS";
}

const NEARBY_CACHE_KEY = "zust_nearby_cached_users";
const MANUAL_OFF_KEY = "zust_nearby_manual_off";

function computeVisualPosition(user: NearbyUser, idx: number, total: number) {
  let hash = 0;
  for (let i = 0; i < user.id.length; i++) {
    hash = (hash * 31 + user.id.charCodeAt(i)) >>> 0;
  }
  const baseAngle = ((hash % 360) + (idx * 360) / Math.max(total, 1)) % 360;
  const rad = (baseAngle * Math.PI) / 180;
  const norm = Math.min(1, Math.max(0.15, user.distanceMeters / 100));
  const radiusPercent = 16 + norm * 28;
  return {
    x: 50 + radiusPercent * Math.cos(rad),
    y: 50 + radiusPercent * Math.sin(rad),
  };
}

function approxMovedMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const NearbyRadarPage: React.FC<NearbyRadarPageProps> = ({
  onBack,
  onOpenConversation,
  onRequestsCountChange,
  initialTab = "NEARBY",
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
  const [invisibleMode, setInvisibleMode] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>(() => {
    try {
      const saved = localStorage.getItem(NEARBY_CACHE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [incomingRequests, setIncomingRequests] = useState<ConnectionRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<ConnectionRequestItem[]>([]);
  const [activeTab, setActiveTab] = useState<"NEARBY" | "REQUESTS">(initialTab);
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef = useRef<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const lastScanCallRef = useRef<{ ts: number; lat: number; lon: number } | null>(null);
  const isScanningRef = useRef(false);
  const discoveryEnabledRef = useRef(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    discoveryEnabledRef.current = discoveryEnabled;
  }, [discoveryEnabled]);

  useBackLayer("nearby-profile-modal", 75, Boolean(selectedUser), () => setSelectedUser(null));

  const showToast = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((curr) => (curr === msg ? null : curr));
    }, 2800);
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const res = await api.nearby.getRequests();
      setIncomingRequests(res.incoming || []);
      setOutgoingRequests(res.outgoing || []);
      onRequestsCountChange?.((res.incoming || []).length);
    } catch {
      // Ignore offline errors
    }
  }, [onRequestsCountChange]);

  const performScanWithCoords = useCallback(
    async (coords: { latitude: number; longitude: number; accuracy?: number }, force = false) => {
      const now = Date.now();
      const prev = lastScanCallRef.current;

      // Throttle watchPosition jitter: skip unless >= 6s passed OR moved >= 5m OR forced
      if (!force && prev) {
        const elapsed = now - prev.ts;
        const moved = approxMovedMeters(prev.lat, prev.lon, coords.latitude, coords.longitude);
        if (elapsed < 6000 && moved < 5) {
          return;
        }
      }

      if (!navigator.onLine) {
        setIsOffline(true);
        setIsRefreshing(false);
        return;
      }

      lastScanCallRef.current = { ts: now, lat: coords.latitude, lon: coords.longitude };

      try {
        if (force) setIsRefreshing(true);

        // Auto-enable discovery on server whenever browser location permission is granted & user scans!
        if (!discoveryEnabledRef.current) {
          await api.nearby.updateSettings({ discoveryEnabled: true });
          discoveryEnabledRef.current = true;
          setDiscoveryEnabled(true);
          localStorage.removeItem(MANUAL_OFF_KEY);
        }

        const res = await api.nearby.scan(coords);
        setNearbyUsers(res.nearbyUsers);
        try {
          localStorage.setItem(NEARBY_CACHE_KEY, JSON.stringify(res.nearbyUsers));
        } catch {}
        setLastScannedAt(res.scannedAt);
        setLocationError(null);
        setIsOffline(false);

        setSelectedUser((curr) =>
          curr ? res.nearbyUsers.find((u) => u.id === curr.id) || curr : null
        );
      } catch (err: any) {
        if (force) {
          setLocationError(err.message || "Could not refresh nearby users");
        }
      } finally {
        if (force) setIsRefreshing(false);
      }
    },
    []
  );

  const stopScanning = useCallback(async (notifyServer = true) => {
    isScanningRef.current = false;
    setIsScanning(false);

    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    if (notifyServer && navigator.onLine) {
      api.nearby.stop().catch(() => {});
    }
  }, []);

  const mapGeolocationError = (err: GeolocationPositionError): string => {
    if (err.code === err.PERMISSION_DENIED) {
      return "Location permission denied. Please allow location access in browser settings to scan nearby people.";
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
      return "GPS / device location is off or unavailable. Turn on device Location and try again.";
    }
    if (err.code === err.TIMEOUT) {
      return "Location request timed out. Tap Refresh or move near a window.";
    }
    return "Unable to detect your location.";
  };

  const startScanning = useCallback(async () => {
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }

    if (
      !window.isSecureContext &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setLocationError("GPS location requires HTTPS.");
      return;
    }

    localStorage.removeItem(MANUAL_OFF_KEY);
    isScanningRef.current = true;
    setIsScanning(true);
    setIsRefreshing(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        coordsRef.current = coords;
        performScanWithCoords(coords, true);
      },
      (err) => {
        setIsRefreshing(false);
        setIsScanning(false);
        isScanningRef.current = false;
        setLocationError(mapGeolocationError(err));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isScanningRef.current) return;
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        coordsRef.current = coords;
        performScanWithCoords(coords, false);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopScanning(false);
          setLocationError(mapGeolocationError(err));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    autoRefreshTimerRef.current = setInterval(() => {
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
      }
    }, 15_000);
  }, [performScanWithCoords, stopScanning]);

  // On mount: load settings, requests, and auto-start scanning if Location permission is ALREADY granted!
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.nearby.getSettings();
        if (!mounted) return;
        setDiscoveryEnabled(res.settings.discoveryEnabled);
        discoveryEnabledRef.current = res.settings.discoveryEnabled;
        setInvisibleMode(res.settings.invisibleMode);
      } catch {
        // Ignore offline
      } finally {
        if (mounted) setSettingsLoaded(true);
      }

      loadRequests();

      const manualOff = localStorage.getItem(MANUAL_OFF_KEY) === "true";
      if (!manualOff && navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: "geolocation" });
          if (mounted && perm.state === "granted") {
            startScanning();
          }
        } catch {}
      }
    })();

    return () => {
      mounted = false;
      // Clear local watchPosition when leaving page, while keeping 5-min TTL server presence if discovery stays ON!
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
    };
  }, [loadRequests, startScanning]);

  // Network online/offline sync listener
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      loadRequests();
      if (coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadRequests, performScanWithCoords]);

  const handleToggleDiscovery = async () => {
    const next = !discoveryEnabled;
    if (next) {
      localStorage.removeItem(MANUAL_OFF_KEY);
      await startScanning();
      return;
    }
    try {
      localStorage.setItem(MANUAL_OFF_KEY, "true");
      await api.nearby.updateSettings({ discoveryEnabled: false });
      setDiscoveryEnabled(false);
      discoveryEnabledRef.current = false;
      setNearbyUsers([]);
      await stopScanning(false);
      showToast("Discovery turned OFF");
    } catch (err: any) {
      showToast(err.message || "Failed to turn off discovery");
    }
  };

  const handleToggleInvisible = async () => {
    const next = !invisibleMode;
    try {
      await api.nearby.updateSettings({ invisibleMode: next });
      setInvisibleMode(next);
      showToast(
        next
          ? "Invisible Mode ON — you are hidden from others"
          : "Invisible Mode OFF — discoverable when scanning"
      );
    } catch (err: any) {
      showToast(err.message || "Failed to update invisible mode");
    }
  };

  const handleManualRefresh = () => {
    if (coordsRef.current) {
      performScanWithCoords(coordsRef.current, true);
    } else {
      startScanning();
    }
    loadRequests();
  };

  useEffect(() => {
    if (!socket) return;

    socket.emit("nearby:join");

    const handlePulse = () => {
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, false);
      }
    };

    const handleUsersRemoved = (data: { userIds: string[] }) => {
      if (!data?.userIds?.length) return;
      const removed = new Set(data.userIds);
      setNearbyUsers((prev) => prev.filter((u) => !removed.has(u.id)));
      setSelectedUser((curr) => (curr && removed.has(curr.id) ? null : curr));
    };

    const handleRequestReceived = () => {
      loadRequests();
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
      }
      showToast("New nearby connection request!");
    };

    const handleRequestUpdated = () => {
      loadRequests();
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
      }
    };

    socket.on("nearby:pulse", handlePulse);
    socket.on("nearby:users-removed", handleUsersRemoved);
    socket.on("nearby:request-received", handleRequestReceived);
    socket.on("nearby:request-accepted", handleRequestUpdated);
    socket.on("nearby:request-rejected", handleRequestUpdated);
    socket.on("nearby:request-cancelled", handleRequestUpdated);

    return () => {
      socket.emit("nearby:leave");
      socket.off("nearby:pulse", handlePulse);
      socket.off("nearby:users-removed", handleUsersRemoved);
      socket.off("nearby:request-received", handleRequestReceived);
      socket.off("nearby:request-accepted", handleRequestUpdated);
      socket.off("nearby:request-rejected", handleRequestUpdated);
      socket.off("nearby:request-cancelled", handleRequestUpdated);
    };
  }, [socket, performScanWithCoords, loadRequests, showToast]);

  const handleConnect = async (toUserId: string, message?: string) => {
    const res = await api.nearby.sendRequest(toUserId, message);
    if (res.autoAccepted && res.conversationId) {
      showToast("Mutual request — connected!");
      setSelectedUser(null);
      onOpenConversation(res.conversationId);
      return;
    }
    showToast("Connection request sent");
    await loadRequests();
    if (coordsRef.current) await performScanWithCoords(coordsRef.current, true);
  };

  const handleAcceptRequest = async (requestId: string) => {
    const res = await api.nearby.respondRequest(requestId, "ACCEPT");
    showToast("Connection accepted!");
    await loadRequests();
    if (coordsRef.current) await performScanWithCoords(coordsRef.current, true);
    setSelectedUser(null);
    if (res.conversationId) {
      onOpenConversation(res.conversationId);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    await api.nearby.respondRequest(requestId, "REJECT");
    showToast("Request declined");
    await loadRequests();
    if (coordsRef.current) await performScanWithCoords(coordsRef.current, true);
  };

  const handleCancelRequest = async (requestId: string) => {
    await api.nearby.cancelRequest(requestId);
    showToast("Request cancelled");
    await loadRequests();
    if (coordsRef.current) await performScanWithCoords(coordsRef.current, true);
  };

  const handleOpenChatForUser = async (targetUserId: string, existingConvId?: string) => {
    if (existingConvId) {
      setSelectedUser(null);
      onOpenConversation(existingConvId);
      return;
    }
    const res = await api.conversations.createDirect(targetUserId);
    setSelectedUser(null);
    onOpenConversation(res.conversation.id);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950 overflow-hidden relative">
      {/* Header */}
      <div className="shrink-0 px-3 sm:px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center space-x-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            title="Back to Chats"
            className="p-2 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Radar className={`w-5 h-5 ${isScanning ? "animate-pulse" : ""}`} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
              Nearby Radar
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              100m radius • {nearbyUsers.length} discovered
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={handleToggleInvisible}
            disabled={!settingsLoaded}
            title={invisibleMode ? "Invisible Mode ON" : "Invisible Mode OFF"}
            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center space-x-1 transition-all border ${
              invisibleMode
                ? "bg-slate-800 text-amber-300 border-slate-700"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
            }`}
          >
            {invisibleMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{invisibleMode ? "Invisible" : "Visible"}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleDiscovery}
            disabled={!settingsLoaded}
            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center space-x-1 transition-all ${
              discoveryEnabled
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{discoveryEnabled ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left: Circular Radar */}
        <div className="lg:col-span-6 p-4 sm:p-6 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-white relative overflow-hidden shrink-0 lg:h-full">
          <div className="flex items-center space-x-2 mb-4 z-10">
            <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-semibold flex items-center space-x-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isScanning ? "bg-emerald-400 animate-ping" : "bg-slate-400"
                }`}
              />
              <span>
                {isScanning
                  ? `Scanning 100m • ${nearbyUsers.length} nearby`
                  : "Tap Scan Nearby to start"}
              </span>
            </span>
          </div>

          <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-slate-900/90 border border-emerald-500/30 shadow-[0_0_60px_rgba(16,185,129,0.18)] flex items-center justify-center overflow-hidden">
            <div className="absolute inset-[12.5%] rounded-full border border-emerald-500/20 pointer-events-none" />
            <div className="absolute inset-[25%] rounded-full border border-emerald-500/25 pointer-events-none" />
            <div className="absolute inset-[37.5%] rounded-full border border-emerald-500/30 pointer-events-none" />

            <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-500/15 pointer-events-none" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-emerald-500/15 pointer-events-none" />

            <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-emerald-400/70 pointer-events-none">
              100m
            </span>
            <span className="absolute top-[25%] left-1/2 -translate-x-1/2 translate-y-0.5 text-[9px] font-mono text-emerald-400/70 pointer-events-none">
              50m
            </span>

            {isScanning && (
              <div
                className="absolute inset-0 rounded-full pointer-events-none animate-spin [animation-duration:3.5s]"
                style={{
                  background:
                    "conic-gradient(from 0deg, rgba(16, 185, 129, 0.36) 0deg, rgba(16, 185, 129, 0.08) 55deg, transparent 90deg)",
                }}
              />
            )}

            <div className="relative z-10 flex flex-col items-center">
              {isScanning && (
                <div className="absolute -inset-2 rounded-full bg-emerald-500/25 animate-ping pointer-events-none" />
              )}
              <UserAvatar
                name={user?.displayName}
                username={user?.username}
                avatarUrl={user?.avatarUrl}
                size="sm"
                className="ring-2 ring-emerald-400 shadow-lg"
              />
            </div>

            {nearbyUsers.map((nu, idx) => {
              const pos = computeVisualPosition(nu, idx, nearbyUsers.length);
              return (
                <button
                  key={nu.id}
                  type="button"
                  onClick={() => setSelectedUser(nu)}
                  title={`${nu.displayName} • ~${nu.distanceMeters}m`}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center transition-all duration-500 hover:scale-110"
                >
                  <UserAvatar
                    name={nu.displayName}
                    username={nu.username}
                    avatarUrl={nu.avatarUrl}
                    size="xs"
                    isOnline={nu.isOnline}
                    showOnlineDot
                    className="ring-2 ring-white/80 shadow-lg"
                  />
                  <span className="mt-0.5 px-1.5 py-0.2 rounded-full bg-black/75 text-[9px] font-bold text-emerald-300 whitespace-nowrap border border-white/10">
                    {nu.distanceMeters}m
                  </span>
                </button>
              );
            })}
          </div>

          {invisibleMode && (
            <div className="mt-3 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-[11px] text-amber-200 flex items-center space-x-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              <span>Invisible Mode active</span>
            </div>
          )}

          <div className="mt-5 flex items-center space-x-2.5 z-10">
            {!isScanning ? (
              <button
                type="button"
                onClick={startScanning}
                className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center space-x-2 shadow-lg shadow-emerald-500/30 transition-all active:scale-95"
              >
                <Radar className="w-4 h-4" />
                <span>Scan Nearby</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => stopScanning(true)}
                className="px-5 py-2.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs sm:text-sm flex items-center space-x-2 shadow-lg transition-all"
              >
                <X className="w-4 h-4" />
                <span>Stop Scanning</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              title="Refresh Scan"
              className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          <p className="text-[10px] text-slate-400 mt-3 text-center max-w-xs">
            Uses browser GPS within 100m. Exact coordinates, phone & email are never shared.
          </p>

          {lastScannedAt && (
            <p className="text-[10px] text-emerald-400/80 mt-1">
              Last scanned {new Date(lastScannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
        </div>

        {/* Right: Nearby Users & Requests */}
        <div className="lg:col-span-6 flex flex-col min-h-0 bg-white dark:bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800">
          <div className="shrink-0 p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("NEARBY")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  activeTab === "NEARBY"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                Nearby ({nearbyUsers.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("REQUESTS")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors ${
                  activeTab === "REQUESTS"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                }`}
              >
                <span>Requests</span>
                {incomingRequests.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold">
                    {incomingRequests.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {isOffline && (
            <div className="mx-3 mt-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-center space-x-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>You're offline — showing cached nearby list. Auto-syncs when online.</span>
            </div>
          )}

          {locationError && (
            <div className="m-3 p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{locationError}</p>
                <button type="button" onClick={startScanning} className="mt-1.5 font-bold underline">
                  Try Again
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {activeTab === "NEARBY" ? (
              nearbyUsers.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-2.5">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto">
                    <MapPin className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {isScanning ? "No one within 100m right now" : "Tap 'Scan Nearby' to discover people"}
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Nearby users within 100 meters appear automatically as they scan.
                  </p>
                </div>
              ) : (
                nearbyUsers.map((nu) => (
                  <div
                    key={nu.id}
                    onClick={() => setSelectedUser(nu)}
                    className="p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-emerald-50/60 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <UserAvatar
                        name={nu.displayName}
                        username={nu.username}
                        avatarUrl={nu.avatarUrl}
                        size="md"
                        isOnline={nu.isOnline}
                        showOnlineDot
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                            {nu.displayName || nu.username}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold shrink-0">
                            ~{nu.distanceMeters}m
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          @{nu.username} • {formatLastSeen(nu.isOnline, nu.lastSeenAt)}
                        </p>
                        {nu.commonGroups.length > 0 && (
                          <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium mt-0.5 flex items-center space-x-1">
                            <Users className="w-3 h-3" />
                            <span>{nu.commonGroups.length} common group</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {nu.connectionStatus === "CONNECTED" ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenChatForUser(nu.id, nu.conversationId);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center space-x-1"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Chat</span>
                        </button>
                      ) : nu.connectionStatus === "PENDING_SENT" ? (
                        <span className="px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                          Pending
                        </span>
                      ) : nu.connectionStatus === "PENDING_RECEIVED" ? (
                        <span className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                          Respond
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUser(nu);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white text-xs font-bold flex items-center space-x-1 transition-colors"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Connect</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Incoming Requests ({incomingRequests.length})
                  </h4>
                  {incomingRequests.length === 0 ? (
                    <p className="text-xs text-slate-400 py-3">No incoming connection requests.</p>
                  ) : (
                    <div className="space-y-2">
                      {incomingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                            <UserAvatar
                              name={req.sender?.displayName}
                              username={req.sender?.username}
                              avatarUrl={req.sender?.avatarUrl}
                              size="sm"
                              isOnline={req.sender?.isOnline}
                              showOnlineDot
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {req.sender?.displayName || req.sender?.username}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {req.message || `@${req.sender?.username}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRejectRequest(req.id)}
                              title="Decline"
                              className="p-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-red-100 hover:text-red-600"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAcceptRequest(req.id)}
                              title="Accept"
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center space-x-1"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Accept</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Sent Requests ({outgoingRequests.length})
                  </h4>
                  {outgoingRequests.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">No pending sent requests.</p>
                  ) : (
                    <div className="space-y-2">
                      {outgoingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                            <UserAvatar
                              name={req.receiver?.displayName}
                              username={req.receiver?.username}
                              avatarUrl={req.receiver?.avatarUrl}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {req.receiver?.displayName || req.receiver?.username}
                              </p>
                              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center space-x-1">
                                <Clock className="w-3 h-3" />
                                <span>Awaiting response</span>
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCancelRequest(req.id)}
                            className="px-2.5 py-1 rounded-xl text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {statusNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-slate-900/95 text-white text-xs font-semibold shadow-xl border border-white/10 animate-fadeIn">
          {statusNotice}
        </div>
      )}

      <NearbyProfileModal
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onConnect={handleConnect}
        onAcceptRequest={handleAcceptRequest}
        onRejectRequest={handleRejectRequest}
        onCancelRequest={handleCancelRequest}
        onOpenChat={handleOpenChatForUser}
      />
    </div>
  );
};
