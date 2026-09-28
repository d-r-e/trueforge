---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge-assistant-ui-runtime': patch
---

Add real sandbox-environment CRUD (versioning, snapshot build, soft-delete). Environments are subject-owned (list/get/update/delete/use). AgentSpec `config.sandbox.environment` names a configured environment owned by the caller; delete returns 409 while agents reference it. Turn create clones the env snapshot (when built) and applies resources, env vars, and networking.
