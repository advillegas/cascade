'use client';

// Install window.storage at module-load time (client only), so the game's
// storage.get/set calls always find a polyfill even if their useEffect
// runs before any useEffect inside this component would.
if (typeof window !== 'undefined' && !(window as any).storage) {
  (window as any).storage = {
    get: (key: string) =>
      new Promise<string | null>((resolve) => {
        try { resolve(window.localStorage.getItem(key)); }
        catch { resolve(null); }
      }),
    set: (key: string, value: string) =>
      new Promise<void>((resolve) => {
        try { window.localStorage.setItem(key, value); resolve(); }
        catch { resolve(); }
      }),
    delete: (key: string) =>
      new Promise<void>((resolve) => {
        try { window.localStorage.removeItem(key); resolve(); }
        catch { resolve(); }
      }),
  };
}

export default function StorageShim() {
  return null;
}
