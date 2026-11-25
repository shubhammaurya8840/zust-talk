import { useEffect, useRef } from "react";

interface BackLayer {
  id: string;
  priority: number;
  close: () => void;
}

const activeLayers = new Map<string, BackLayer>();
let listenerAttached = false;
let onRootBackCallback: (() => void) | null = null;

function ensureBaseGuard() {
  try {
    if (!window.history.state || (!window.history.state.__zustGuard && !window.history.state.__zustLayer)) {
      window.history.replaceState({ __zustRoot: true }, "");
      window.history.pushState({ __zustGuard: true }, "");
    }
  } catch {
    // Ignore history API restrictions in embedded frames
  }
}

function handleGlobalPopState() {
  // Find highest priority open layer
  let topLayer: BackLayer | null = null;
  for (const layer of activeLayers.values()) {
    if (!topLayer || layer.priority > topLayer.priority) {
      topLayer = layer;
    }
  }

  if (topLayer) {
    topLayer.close();
    // Ensure a guard entry remains if we popped down to root
    try {
      if (!window.history.state || window.history.state.__zustRoot) {
        window.history.pushState({ __zustGuard: true }, "");
      }
    } catch {
      // Ignore
    }
  } else {
    // User is already on Home / Root view — prevent leaving the app
    try {
      window.history.pushState({ __zustGuard: true }, "");
    } catch {
      // Ignore
    }
    onRootBackCallback?.();
  }
}

export function useInitAppBackGuard(onRootBack?: () => void) {
  useEffect(() => {
    onRootBackCallback = onRootBack || null;
    ensureBaseGuard();

    if (!listenerAttached) {
      window.addEventListener("popstate", handleGlobalPopState);
      listenerAttached = true;
    }

    const handleFirstInteraction = () => {
      ensureBaseGuard();
    };
    window.addEventListener("pointerdown", handleFirstInteraction, { once: true });

    return () => {
      onRootBackCallback = null;
      window.removeEventListener("pointerdown", handleFirstInteraction);
    };
  }, [onRootBack]);
}

/**
 * Registers an open UI overlay / screen / modal with the global browser Back button stack.
 * Higher priority closes first when the user presses Back.
 */
export function useBackLayer(
  id: string,
  priority: number,
  isOpen: boolean,
  onClose: () => void
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) {
      activeLayers.delete(id);
      return;
    }

    activeLayers.set(id, {
      id,
      priority,
      close: () => closeRef.current(),
    });

    try {
      if (window.history.state?.__zustLayer !== id) {
        window.history.pushState({ __zustLayer: id }, "");
      }
    } catch {
      // Ignore
    }

    return () => {
      activeLayers.delete(id);
    };
  }, [id, priority, isOpen]);
}
