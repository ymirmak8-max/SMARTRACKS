import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const useDashboardNavigation = (defaultView, allowedViews) => {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedView = new URLSearchParams(location.search).get('view');
  const activeView = allowedViews.includes(requestedView) ? requestedView : defaultView;

  const setActiveView = useCallback(nextView => {
    const value = typeof nextView === 'function' ? nextView(activeView) : nextView;
    if (!allowedViews.includes(value) || value === activeView) return;
    const params = new URLSearchParams(location.search);
    if (value === defaultView) params.delete('view');
    else params.set('view', value);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' });
  }, [activeView, allowedViews, defaultView, location.pathname, location.search, navigate]);

  return [activeView, setActiveView];
};

export default useDashboardNavigation;
