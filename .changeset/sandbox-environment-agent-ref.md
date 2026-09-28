---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Add real sandbox-environment CRUD (versioning, snapshot build, soft-delete). AgentSpec `config.sandbox.environment` names a configured environment; delete returns 409 while agents reference it.
