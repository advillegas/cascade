'use client';

import { useEffect, useState } from 'react';

// Floating bottom-right button that toggles the Fullscreen API.
// Hidden on devices that don't support it (iOS Safari) — iOS users
// should "Add to Home Screen" for a fullscreen experience instead.
export default function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el: any = document.documentElement;
    const canFs =
      typeof document !== 'undefined' &&
      (document.fullscreenEnabled ||
        (document as any).webkitFullscreenEnabled);
    const canRequest = !!(el.requestFullscreen || el.webkitRequestFullscreen);
    setSupported(Boolean(canFs && canRequest));

    const onChange = () => {
      const fs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setActive(fs);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange as any);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange as any);
    };
  }, []);

  if (!supported) {
    // Best we can do on iOS Safari — suggest Add to Home Screen.
    // Detect iOS to avoid showing this hint on desktop Firefox etc.
    const isIOS =
      typeof navigator !== 'undefined' &&
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true);
    if (!isIOS || isStandalone) return null;
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 'max(12px, env(safe-area-inset-bottom))',
          right: 'max(12px, env(safe-area-inset-right))',
          zIndex: 9999,
          padding: '6px 10px',
          borderRadius: 10,
          background: 'rgba(0,0,0,0.45)',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 10,
          letterSpacing: '0.08em',
          fontFamily: '"Rubik Mono One", monospace',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'none',
        }}
      >
        TAP SHARE → ADD TO HOME SCREEN
      </div>
    );
  }

  const toggle = () => {
    const el: any = document.documentElement;
    if (active) {
      (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  };

  return (
    <button
      aria-label={active ? 'Exit fullscreen' : 'Fullscreen'}
      onClick={toggle}
      style={{
        position: 'fixed',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        right: 'max(12px, env(safe-area-inset-right))',
        zIndex: 9999,
        width: 38,
        height: 38,
        borderRadius: 10,
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.14)',
        backdropFilter: 'blur(6px)',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        fontSize: 16,
        lineHeight: 1,
      }}
    >
      {active ? '⤢' : '⤡'}
    </button>
  );
}
