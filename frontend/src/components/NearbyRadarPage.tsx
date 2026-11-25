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
  Shield,
  Users,
  UserPlus,
  Check,
  X,
  MessageSquare,
  AlertCircle,
  Power,
  Clock,
} from "lucide-react";

interface NearbyRadarPageProps {
  onBack: () => void;
  onOpenConversation: (conversationId: string) => void;
  onRequestsCountChange?: (count: number) => void;
}

// Deterministic visual radar angle based on user id + index (never exposes real GPS bearing!)
function computeVisualPosition(user: NearbyUser, idx: number, total: number) {
  let hash = 0;
  for (let i = 0; i < user.id.length; i++) {
    hash = (hash * 31 + user.id.charCodeAt(i)) >>> 0;
  }
  const baseAngle = ((hash % 360) + (idx * 360) / Math.max(total, 1)) % 360;
  const rad = (baseAngle * Math.PI) / 180;
  // Map 0..100m into 22%..44% of radar box radius so avatars sit nicely inside the 100m circle
  const norm = Math.min(1, Math.max(0.15, user.distanceMeters / 100));
  const radiusPercent = 16 + norm * 28;
  const x = 50 + radiusPercent * Math.cos(rad);
  const y = 50 + radiusPercent * Math.sin(rad);
  return { x, y };
}

export const NearbyRadarPage: React.FC<NearbyRadarPageProps> = ({
  onBack,
  onOpenConversation,
  onRequestsCountChange,
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
  const [invisibleMode, setInvisibleMode] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<ConnectionRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<ConnectionRequestItem[]>([]);
  const [activeTab, setActiveTab] = useState<"NEARBY" | "REQUESTS">("NEARBY");
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showConsentPrompt, setShowConsentPrompt] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef = useRef<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const isScanningRef = useRef(false);

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
      // Ignore transient errors
    }
  }, [onRequestsCountChange]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.nearby.getSettings();
      setDiscoveryEnabled(res.settings.discoveryEnabled);
      setInvisibleMode(res.settings.invisibleMode);
    } catch {
      // Ignore
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadRequests();
  }, [loadSettings, loadRequests]);

  const performScanWithCoords = useCallback(
    async (coords: { latitude: number; longitude: number; accuracy?: number }, silent = false) => {
      try {
        if (!silent) setIsRefreshing(true);
        const res = await api.nearby.scan(coords);
        setNearbyUsers(res.nearbyUsers);
        setLastScannedAt(res.scannedAt);
        setLocationError(null);
        // Keep selectedUser updated in real-time if modal is open
        setSelectedUser((curr) =>
          curr ? res.nearbyUsers.find((u) => u.id === curr.id) || curr : null
        );
      } catch (err: any) {
        if (!silent) {
          setLocationError(err.message || "Failed to scan nearby users");
        }
      } finally {
        if (!silent) setIsRefreshing(false);
      }
    },
    []
  );

  const stopScanning = useCallback(
    async (notifyServer = true) => {
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

      if (notifyServer) {
        api.nearby.stop().catch(() => {});
      }
    },
    []
  );

  // Stop GPS tracking on unmount
  useEffect(() => {
    return () => {
      stopScanning(true);
    };
  }, [stopScanning]);

  const mapGeolocationError = (err: GeolocationPositionError): string => {
    if (err.code === err.PERMISSION_DENIED) {
      return "Location permission denied. Please allow location access in your browser site settings to scan nearby people.";
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
      return "Your device location is currently unavailable. Please enable GPS / Location Services.";
    }
    if (err.code === err.TIMEOUT) {
      return "Location request timed out. Please tap Refresh or try again in an open area.";
    }
    return "Unable to detect your location.";
  };

  const startScanning = useCallback(async () => {
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      setLocationError("GPS location requires HTTPS in mobile/desktop browsers.");
      return;
    }

    // Require explicit Discovery consent first
    if (!discoveryEnabled) {
      setShowConsentPrompt(true);
      return;
    }

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
        performScanWithCoords(coords, false);
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
        performScanWithCoords(coords, true);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopScanning(true);
          setLocationError(mapGeolocationError(err));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }
    );

    // Periodic refresh every 12 seconds to pick up new arrivals, departures & TTL expiries
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    autoRefreshTimerRef.current = setInterval(() => {
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
      }
    }, 12_000);
  }, [discoveryEnabled, performScanWithCoords, stopScanning]);

  const handleConfirmConsentAndScan = async () => {
    try {
      setShowConsentPrompt(false);
      await api.nearby.updateSettings({ discoveryEnabled: true });
      setDiscoveryEnabled(true);
      // Directly invoke geolocation after enabling consent
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
          performScanWithCoords(coords, false);

          watchIdRef.current = navigator.geolocation.watchPosition(
            (p) => {
              if (!isScanningRef.current) return;
              const nextCoords = {
                latitude: p.coords.latitude,
                longitude: p.coords.longitude,
                accuracy: p.coords.accuracy,
              };
              coordsRef.current = nextCoords;
              performScanWithCoords(nextCoords, true);
            },
            undefined,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }
          );

          if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
          autoRefreshTimerRef.current = setInterval(() => {
            if (isScanningRef.current && coordsRef.current) {
              performScanWithCoords(coordsRef.current, true);
            }
          }, 12_000);
        },
        (err) => {
          setIsRefreshing(false);
          setIsScanning(false);
          isScanningRef.current = false;
          setLocationError(mapGeolocationError(err));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
      );
    } catch (err: any) {
      setLocationError(err.message || "Could not enable discovery");
    }
  };

  const handleToggleDiscovery = async () => {
    const next = !discoveryEnabled;
    if (next) {
      setShowConsentPrompt(true);
      return;
    }
    try {
      await api.nearby.updateSettings({ discoveryEnabled: false });
      setDiscoveryEnabled(false);
      setNearbyUsers([]);
      await stopScanning(false);
      showToast("Nearby Discovery turned OFF — you are hidden");
    } catch (err: any) {
      showToast(err.message || "Failed to update discovery setting");
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
    if (!discoveryEnabled) {
      setShowConsentPrompt(true);
      return;
    }
    if (coordsRef.current) {
      performScanWithCoords(coordsRef.current, false);
    } else {
      startScanning();
    }
    loadRequests();
  };

  // Socket real-time listeners
  useEffect(() => {
    if (!socket) return;

    socket.emit("nearby:join");

    const handlePulse = () => {
      if (isScanningRef.current && coordsRef.current) {
        performScanWithCoords(coordsRef.current, true);
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
              Within 100m radius • {nearbyUsers.length} discovered
            </p>
          </div>
        </div>

        {/* Discovery & Invisible Mode Toggles */}
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
            <span>{discoveryEnabled ? "Discovery ON" : "Discovery OFF"}</span>
          </button>
        </div>
      </div>

      {/* Main Content Grid (Responsive Desktop Side-by-Side / Mobile Stacked) */}
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left: Animated Circular Radar Scanner */}
        <div className="lg:col-span-6 p-4 sm:p-6 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-white relative overflow-hidden shrink-0 lg:h-full">
          {/* Status Pill */}
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
                  : discoveryEnabled
                  ? "Ready to scan"
                  : "Discovery is OFF"}
              </span>
            </span>
          </div>

          {/* Circular 100m Radar Arena */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-slate-900/90 border border-emerald-500/30 shadow-[0_0_60px_rgba(16,185,129,0.18)] flex items-center justify-center overflow-hidden">
            {/* Concentric Distance Rings */}
            <div className="absolute inset-[12.5%] rounded-full border border-emerald-500/20 pointer-events-none" />
            <div className="absolute inset-[25%] rounded-full border border-emerald-500/25 pointer-events-none" />
            <div className="absolute inset-[37.5%] rounded-full border border-emerald-500/30 pointer-events-none" />

            {/* Crosshairs */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-emerald-500/15 pointer-events-none" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-emerald-500/15 pointer-events-none" />

            {/* Distance labels */}
            <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-emerald-400/70 pointer-events-none">
              100m
            </span>
            <span className="absolute top-[25%] left-1/2 -translate-x-1/2 translate-y-0.5 text-[9px] font-mono text-emerald-400/70 pointer-events-none">
              50m
            </span>

            {/* Animated Rotating Sweep Beam */}
            {isScanning && (
              <div
                className="absolute inset-0 rounded-full pointer-events-none animate-spin [animation-duration:3.5s]"
                style={{
                  background:
                    "conic-gradient(from 0deg, rgba(16, 185, 129, 0.36) 0deg, rgba(16, 185, 129, 0.08) 55deg, transparent 90deg)",
                }}
              />
            )}

            {/* Central Current User Marker */}
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

            {/* Nearby User Avatars Around the Radar */}
            {nearbyUsers.map((nu, idx) => {
              const pos = computeVisualPosition(nu, idx, nearbyUsers.length);
              return (
                <button
                  key={nu.id}
                  type="button"
                  onClick={() => setSelectedUser(nu)}
                  title={`${nu.displayName} • ~${nu.distanceMeters}m`}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center group transition-all duration-500 hover:scale-110"
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

          {/* Invisible Mode Notice */}
          {invisibleMode && (
            <div className="mt-3 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-[11px] text-amber-200 flex items-center space-x-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              <span>Invisible Mode active — others cannot see you</span>
            </div>
          )}

          {/* Scan / Stop / Refresh Controls */}
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

          {lastScannedAt && (
            <p className="text-[10px] text-slate-400 mt-2">
              Updated {new Date(lastScannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
        </div>

        {/* Right: Nearby Users & Connection Requests Panel */}
        <div className="lg:col-span-6 flex flex-col min-h-0 bg-white dark:bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800">
          {/* Sub-Tabs */}
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

          {/* Location Error / Warning */}
          {locationError && (
            <div className="m-3 p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{locationError}</p>
                <button
                  type="button"
                  onClick={startScanning}
                  className="mt-1.5 font-bold underline"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Scrollable List Body */}
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
                  <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                    Only registered users within 100 meters who enabled Nearby Discovery appear here. Exact locations are never shared.
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
              /* Requests Tab */
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

      {/* Status Toast */}
      {statusNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-slate-900/95 text-white text-xs font-semibold shadow-xl border border-white/10 animate-fadeIn">
          {statusNotice}
        </div>
      )}

      {/* Explicit Permission & Privacy Consent Modal */}
      {showConsentPrompt && (
        <div
          onClick={() => setShowConsentPrompt(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-sm animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 animate-scaleIn"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <Shield className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Enable Nearby Discovery?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Your browser GPS is used only while scanning to find people within 100 meters. Your exact coordinates, phone number, and email are never shared, and presence auto-expires after 3 minutes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowConsentPrompt(false)}
                className="py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold"
              >
                Not Now
              </button>
              <button
                type="button"
                onClick={handleConfirmConsentAndScan}
                className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md"
              >
                Allow & Scan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nearby User Profile Modal */}
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
