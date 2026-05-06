import { useEffect, useState } from 'react';

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;

function readElapsedMs(startedAt: string | null): number | null {
  if (startedAt === null) return null;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  return Math.max(0, Date.now() - startedAtMs);
}

export function formatElapsedRunTime(ms: number | null): string | null {
  if (ms === null) return null;
  const totalSeconds = Math.floor(ms / SECOND_MS);
  if (totalSeconds < MINUTE_SECONDS) return `${String(totalSeconds)}s`;
  if (totalSeconds < HOUR_SECONDS) {
    const minutes = Math.floor(totalSeconds / MINUTE_SECONDS);
    const seconds = totalSeconds % MINUTE_SECONDS;
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  const hours = Math.floor(totalSeconds / HOUR_SECONDS);
  const minutes = Math.floor((totalSeconds % HOUR_SECONDS) / MINUTE_SECONDS);
  return `${String(hours)}h ${String(minutes)}m`;
}

export function useElapsedRunTime(startedAt: string | null): string | null {
  const [elapsedMs, setElapsedMs] = useState(() => readElapsedMs(startedAt));

  useEffect(() => {
    setElapsedMs(readElapsedMs(startedAt));
    if (startedAt === null) return;
    const intervalId = window.setInterval(() => {
      setElapsedMs(readElapsedMs(startedAt));
    }, SECOND_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [startedAt]);

  return formatElapsedRunTime(elapsedMs);
}
