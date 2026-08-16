import { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Tiny hash-based router — enough for the app's three pages without pulling in
// a routing library. Pages are addressed as '#/signup', '#/settings'; anything
// else renders the tracker.
// ---------------------------------------------------------------------------

export function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export function navigate(hash: string) {
  window.location.hash = hash
}
