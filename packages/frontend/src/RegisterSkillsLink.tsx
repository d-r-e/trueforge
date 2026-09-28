import { AgentSkillsHeaderActionSlot } from '@truefoundry/trueforge-ui';

/** Host override for `AgentSkillsHeaderActionSlot`; forwards URL props with SDK defaults. */
export function RegisterSkillsLink(
  props: {
    platformSkillsUrl?: string;
    settingsSkillsUrl?: string;
  } = {},
) {
  return <AgentSkillsHeaderActionSlot {...props} />;
}
