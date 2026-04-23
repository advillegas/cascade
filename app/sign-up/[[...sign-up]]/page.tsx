import { SignUp } from '@clerk/nextjs';

export default function Page() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(ellipse at top, #1a1440 0%, #0a0818 55%, #050410 100%)',
        padding: 20,
      }}
    >
      <SignUp />
    </main>
  );
}
