import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

const AUTH_ORDER = {
  '/login': 0,
  '/register': 1,
  '/forgot-password': 2,
  '/reset-password': 3,
};

const AuthFlow = () => {
  const location = useLocation();
  const [paths, setPaths] = useState({ current: location.pathname, previous: location.pathname });
  if (location.pathname !== paths.current) {
    setPaths({ current: location.pathname, previous: paths.current });
  }
  const nextIndex = AUTH_ORDER[paths.current] ?? 0;
  const previousIndex = AUTH_ORDER[paths.previous] ?? 0;
  const direction = nextIndex >= previousIndex ? 'forward' : 'back';

  useEffect(() => {
    delete document.documentElement.dataset.sidebar;
  }, []);

  return (
    <div className="auth-flow">
      <div key={location.pathname} className={`auth-stage auth-stage-${direction}`}>
        <Outlet />
      </div>
    </div>
  );
};

export default AuthFlow;
