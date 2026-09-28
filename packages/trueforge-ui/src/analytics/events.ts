/**
 * Public event-name contract for hosts (e.g. PostHog). Keep names stable — renaming is a breaking change.
 */
export const AnalyticsEvents = {
  Message: {
    SENT: 'agent.message_sent',
    CANCELLED: 'agent.message_cancelled',
    COPIED: 'agent.message_copied',
    EDIT_STARTED: 'agent.message_edit_started',
    RETRIED: 'agent.message_retried',
  },
  Attachment: {
    PICKED: 'agent.attachment_picked',
  },
  Session: {
    NEW: 'agent.session_new',
    SELECTED: 'agent.session_selected',
    SHARE_OPENED: 'agent.session_share_opened',
    SHARE_LINK_COPIED: 'agent.session_share_link_copied',
  },
  Tool: {
    APPROVAL_RESOLVED: 'agent.tool_approval_resolved',
  },
  AskUser: {
    SUBMITTED: 'agent.ask_user_submitted',
  },
  Config: {
    OPENED: 'agent.config_opened',
  },
  Settings: {
    OPENED: 'agent.settings_opened',
  },
} as const;
