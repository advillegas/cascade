import CascadeGame from '@/components/CascadeGame';
import AuthBar from '@/components/AuthBar';
import FullscreenButton from '@/components/FullscreenButton';

export default function HomePage() {
  return (
    <>
      <AuthBar />
      <CascadeGame />
      <FullscreenButton />
    </>
  );
}
