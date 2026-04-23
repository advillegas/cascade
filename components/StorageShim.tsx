'use client';

import { useEffect } from 'react';

/**
 * Installs window.storage (Claude Chat sandbox API) backed by localStorage,
 * so game code that calls window.storage.get/set works in real browsers.
 * Installed once on the client before the game mounts.
 */
export default function StorageShim() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).storage) return;
    (window as any).storage = {
      get: (key: string) => {
        try { return Promise.resolve(window.localStorage.getItem(key)); }
        catch { return Promise.resolve(null); }
      },
      set: (key: string, value: string) => {
        try { window.localStorage.setItem(key, value); return Promise.resolve(); }
        catch { return Promise.resolve(); }
      },
      delete: (key: string) => {
        try { window.localStorage.removeItem(key); return Promise.resolve(); }
        catch { return Promise.resolve(); }
      },
    };
  }, []);
  return null;
}
