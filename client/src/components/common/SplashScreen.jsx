import { useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';

const SplashScreen = ({ onDone }) => {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const timer1 = setTimeout(() => setFade(true), 2100);
    const timer2 = setTimeout(() => onDone(), 2500);
    return () => { clearTimeout(timer1); clearTimeout(timer2); };
  }, [onDone]);

  return (
    <div className="splash-screen" aria-hidden={fade} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      transition: 'opacity 0.4s ease',
      opacity: fade ? 0 : 1,
      visibility: fade ? 'hidden' : 'visible',
      pointerEvents: fade ? 'none' : 'all',
    }}>
      <BrandLogo className="splash-logo-image" size="lg" />
      <div className="smartrack-loader-dots" aria-hidden="true">
        <span /><span /><span />
      </div>
    </div>
  );
};

export default SplashScreen;
