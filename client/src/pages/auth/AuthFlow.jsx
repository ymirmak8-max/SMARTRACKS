import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

const AUTH_ORDER = {
  '/login': 0,
  '/register': 1,
  '/forgot-password': 2,
  '/reset-password': 3,
};

const AuthFlow = () => {
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  const nextIndex = AUTH_ORDER[location.pathname] ?? 0;
  const previousIndex = AUTH_ORDER[previousPath.current] ?? 0;
  const direction = nextIndex >= previousIndex ? 'forward' : 'back';

  useEffect(() => {
    previousPath.current = location.pathname;
  }, [location.pathname]);

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
