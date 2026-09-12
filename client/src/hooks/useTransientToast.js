import { useCallback, useEffect, useRef, useState } from 'react';

const useTransientToast = (duration = 6000) => {
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const timeoutRef = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    clearTimeout(timeoutRef.current);
    setToast(message);
    setToastType(type);
    timeoutRef.current = setTimeout(() => setToast(''), duration);
  }, [duration]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return { toast, toastType, showToast };
};

export default useTransientToast;
