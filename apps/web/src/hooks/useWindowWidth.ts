import { useEffect, useState } from 'react';

function readWindowWidth(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerWidth;
}

/** Tracks `window.innerWidth` and re-renders on viewport resize. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState<number>(() => readWindowWidth());

  useEffect(() => {
    function onResize() {
      setWidth(readWindowWidth());
    }
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return width;
}
