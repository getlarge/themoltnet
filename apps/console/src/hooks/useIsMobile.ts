import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;
export const TABLET_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}

export function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.innerWidth >= MOBILE_BREAKPOINT &&
        window.innerWidth < TABLET_BREAKPOINT,
  );

  useEffect(() => {
    function check() {
      const width = window.innerWidth;
      setIsTablet(width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT);
    }

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isTablet;
}
