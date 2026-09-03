import { useEffect } from 'react';

/**
 * Scroll to and focus the section named by the URL hash, but only for ids the
 * page owns. Cross-route links such as `/download#verify` land at the page top
 * otherwise, because the SPA router changes the URL without a native hash
 * jump (#2051 critique). Listens for later `hashchange` events too.
 */
export function useHashTarget(ids: readonly string[]) {
  useEffect(() => {
    let focusTimer: number | undefined;

    const focusHashTarget = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        const id = window.location.hash.slice(1);
        if (!ids.includes(id)) return;

        const target = document.getElementById(id);
        // Instant, like a native hash jump: arrival is not a transition, and
        // smooth scrolling is suppressed in background tabs anyway.
        target?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        target?.focus({ preventScroll: true });
      }, 0);
    };

    focusHashTarget();
    window.addEventListener('hashchange', focusHashTarget);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('hashchange', focusHashTarget);
    };
  }, [ids]);
}
