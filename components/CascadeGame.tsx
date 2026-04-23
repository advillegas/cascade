'use client';

import dynamic from 'next/dynamic';
import StorageShim from './StorageShim';

// Load the game only on the client — it touches window/AudioContext at mount.
const App = dynamic(() => import('./CascadeApp'), { ssr: false });

export default function CascadeGame() {
  return (
    <>
      <StorageShim />
      <App />
    </>
  );
}
