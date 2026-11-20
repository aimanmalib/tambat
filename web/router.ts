import { useEffect, useState } from 'react';

export const ROUTES = ['/', '/lookup', '/wall', '/demo', '/pay', '/judges', '/video'] as const;
export type Route = (typeof ROUTES)[number];

function current(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : '/';
}

/** Moves to a page inside the app without a reload. `query` is kept in the URL so links can be shared. */
export function navigate(path: Route, query = ''): void {
  window.history.pushState(null, '', path + query);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return route;
}

export const queryParam = (name: string): string => new URLSearchParams(window.location.search).get(name) ?? '';
