'use client';

import { Show, UserButton } from '@clerk/nextjs';
import Link from 'next/link';

export default function AuthBar() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 10000,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        fontFamily: '"Rubik", system-ui, sans-serif',
      }}
    >
      <Show when="signed-out">
        <Link
          href="/sign-in"
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.5,
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(8px)',
          }}
        >
          SIGN IN
        </Link>
        <Link
          href="/sign-up"
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'linear-gradient(135deg,#ff2e6e,#a855f7)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            textDecoration: 'none',
            boxShadow: '0 4px 16px rgba(255,46,110,0.35)',
          }}
        >
          SIGN UP
        </Link>
      </Show>
      <Show when="signed-in">
        <UserButton
          appearance={{ elements: { avatarBox: { width: 36, height: 36 } } }}
        />
      </Show>
    </div>
  );
}
