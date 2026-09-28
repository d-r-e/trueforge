'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import type { AnalyticsEventProps, TrackAnalytics } from './types.js';

// Host owns vendor identify/group/gating; SDK only forwards (name, props) and no-ops when unset
// so tests and embeds work without a host analytics sink.
const AnalyticsContext = createContext<TrackAnalytics | null>(null);

const noopTrack: TrackAnalytics = () => {};

export function AnalyticsProvider({ track, children }: { track?: TrackAnalytics; children: ReactNode }) {
  const stableTrack = useCallback<TrackAnalytics>(
    (eventName, data) => {
      track?.(eventName, data);
    },
    [track],
  );

  const value = useMemo(() => (track == null ? null : stableTrack), [stableTrack, track]);

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

/** Always-safe tracker: host `track` when mounted, otherwise a no-op. */
export function useTrackAnalytics(): TrackAnalytics {
  return useContext(AnalyticsContext) ?? noopTrack;
}

export type { AnalyticsEventProps, TrackAnalytics };
