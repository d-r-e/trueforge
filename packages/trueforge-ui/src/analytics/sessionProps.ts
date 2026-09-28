import type { AnalyticsEventProps } from './types.js';

/** Merge optional session/shell identity into event props when available. */
export function withSessionProps(
  base: AnalyticsEventProps | undefined,
  session: { sessionId?: string | null; agentId?: string | null; agentName?: string | null },
): AnalyticsEventProps {
  return {
    ...base,
    ...(session.sessionId != null && session.sessionId !== '' ? { session_id: session.sessionId } : {}),
    ...(session.agentId != null && session.agentId !== '' ? { agent_id: session.agentId } : {}),
    ...(session.agentName != null && session.agentName !== '' ? { agent_name: session.agentName } : {}),
  };
}
