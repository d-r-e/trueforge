/**
 * Sandbox environments API (mounted at /api/v1/sandbox-environments).
 * Real DB CRUD; OpenAPI / Fern registration intentionally deferred.
 */
import { OpenAPIHono, z } from '@hono/zod-openapi';
import { InvalidPageTokenError } from '@truefoundry/trueforge-core/agent-session';
import { withTimeout } from '@truefoundry/trueforge-core/core';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { createdBySubjectFromRequestContext, type ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import {
  SandboxEnvironmentNameConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentVersionRecord,
  type SandboxEnvironmentWithVersion,
} from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { WithTransaction } from '../db/transaction';
import { toSandboxProviderFromRecord } from '../sandbox/providerUtils';
import { buildNextVersion, redactManifestSecrets } from '../sandbox/sandboxEnvironmentVersion';
import { PAGE_LIMIT } from '../schemas/common';
import {
  CreateSandboxEnvironmentRequestSchema,
  UpdateSandboxEnvironmentRequestSchema,
  type SandboxEnvironment,
} from '../schemas/sandboxEnvironment';
import { MissingStoredSecretError } from '../utils/secretRedaction';
import { zodErrorResponse } from '../zodErrorResponse';

/** Cap Daytona register so a slow provider cannot hold the HTTP request open. */
const BUILD_REQUEST_TIMEOUT_MS = 3_000;

export interface SandboxEnvironmentsRouterDeps<TTransaction> {
  sandboxEnvironmentStore: ISandboxEnvironmentStore<TTransaction>;
  resolveAgentStore: (c: Context) => IAgentStore<TTransaction>;
  resolveSandboxProviderStore: (c: Context) => ISandboxProviderStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  resolveRequestContext: ResolveRequestContext;
  logger: Logger;
}

function toSandboxEnvironment({ environment, version }: SandboxEnvironmentWithVersion): SandboxEnvironment {
  const { type, sandbox_provider, ...manifest } = version.manifest;
  void type;
  void sandbox_provider;
  return {
    id: environment.id,
    name: environment.name,
    description: environment.description,
    active_version: environment.active_version,
    lifecycle_stage: environment.lifecycle_stage,
    status: version.status,
    status_reason: version.status_reason,
    manifest: redactManifestSecrets(manifest),
    created_by_subject: environment.created_by_subject,
    created_at: environment.created_at,
    updated_at: environment.updated_at,
  };
}

async function validateJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(c, parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

function parseListQuery(c: Context): { limit: number; page_token: string | undefined } {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? Number(rawLimit) : PAGE_LIMIT;
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : PAGE_LIMIT,
    page_token: c.req.query('page_token'),
  };
}

async function startSnapshotBuild<TTransaction>({
  store,
  providerStore,
  tenant_id,
  version,
  logger,
}: {
  store: ISandboxEnvironmentStore<TTransaction>;
  providerStore: ISandboxProviderStore<TTransaction>;
  tenant_id: string;
  version: SandboxEnvironmentVersionRecord;
  logger: Logger;
}): Promise<SandboxEnvironmentVersionRecord> {
  const fail = async (status_reason: string) =>
    (await store.markVersionFailed({
      environment_id: version.environment_id,
      version: version.version,
      status_reason,
    })) ?? version;

  const providerRecord = await providerStore.getSandboxProvider(tenant_id);
  if (!providerRecord) {
    return fail('No sandbox provider configured');
  }
  try {
    const provider = toSandboxProviderFromRecord({
      record: providerRecord,
      tenant_id,
      logger,
      build_metadata: { build_ref: version.external_ref },
    });
    await withTimeout(provider.buildImage(), BUILD_REQUEST_TIMEOUT_MS, 'sandbox buildImage');
    return version;
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'buildImage failed');
  }
}

/** CRUD for sandbox environments (no OpenAPI registration yet). */
export function createSandboxEnvironmentsRouter<TTransaction>(
  deps: SandboxEnvironmentsRouterDeps<TTransaction>,
): OpenAPIHono {
  const router = new OpenAPIHono();
  const { sandboxEnvironmentStore: store, resolveAgentStore, withTransaction, resolveRequestContext, logger } = deps;

  router.get('/', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const { limit, page_token } = parseListQuery(c);
    try {
      const listed = await store.listEnvironments({
        tenant_id,
        created_by_subject_id: subject.id,
        limit,
        page_token,
      });
      return c.json({ data: listed.data.map(toSandboxEnvironment), pagination: listed.pagination });
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return c.json({ error: { message: error.message } }, 400);
      }
      throw error;
    }
  });

  router.get('/:name', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const name = c.req.param('name');
    const loaded = await store.getEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    if (!loaded) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }
    return c.json({ data: toSandboxEnvironment(loaded) });
  });

  router.post('/', async c => {
    const body = await validateJsonBody(c, CreateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const requestContext = resolveRequestContext(c);
    const providerStore = deps.resolveSandboxProviderStore(c);
    const providerRecord = await providerStore.getSandboxProvider(requestContext.tenant_id);
    if (!providerRecord) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 422);
    }
    const created_by_subject = createdBySubjectFromRequestContext(requestContext);
    const { manifest } = body.data;

    let created: SandboxEnvironmentWithVersion & { needs_snapshot: boolean };
    try {
      created = await withTransaction(transaction =>
        store.createEnvironment(
          {
            tenant_id: requestContext.tenant_id,
            name: manifest.name,
            description: manifest.description ?? '',
            created_by_subject,
            buildVersion: () => ({
              ...buildNextVersion({
                tenant_id: requestContext.tenant_id,
                version: 1,
                manifest,
                provider_type: providerRecord.manifest.type,
              }),
              created_by_subject,
            }),
          },
          transaction,
        ),
      );
    } catch (error) {
      if (error instanceof SandboxEnvironmentNameConflictError) {
        return c.json({ error: { message: error.message } }, 409);
      }
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Secret value is required' } }, 400);
      }
      throw error;
    }

    if (created.needs_snapshot) {
      created = {
        ...created,
        version: await startSnapshotBuild({
          store,
          providerStore,
          tenant_id: requestContext.tenant_id,
          version: created.version,
          logger,
        }),
      };
    }

    return c.json({ data: toSandboxEnvironment(created) }, 201);
  });

  router.put('/:name', async c => {
    const body = await validateJsonBody(c, UpdateSandboxEnvironmentRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const name = c.req.param('name');
    if (body.data.manifest.name !== name) {
      return c.json({ error: { message: 'Path name must match manifest.name' } }, 400);
    }
    const requestContext = resolveRequestContext(c);
    const providerStore = deps.resolveSandboxProviderStore(c);
    const providerRecord = await providerStore.getSandboxProvider(requestContext.tenant_id);
    if (!providerRecord) {
      return c.json({ error: { message: 'No sandbox provider configured' } }, 422);
    }

    const existing = await store.getEnvironment({
      tenant_id: requestContext.tenant_id,
      name,
      created_by_subject_id: requestContext.subject.id,
    });
    if (!existing) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }

    const created_by_subject = createdBySubjectFromRequestContext(requestContext);
    const { manifest } = body.data;
    const active_version = existing.environment.active_version + 1;
    let next;
    try {
      next = buildNextVersion({
        tenant_id: requestContext.tenant_id,
        version: active_version,
        previous_manifest: existing.version.manifest,
        previous_external_ref: existing.version.external_ref,
        manifest,
        provider_type: providerRecord.manifest.type,
      });
    } catch (error) {
      if (error instanceof MissingStoredSecretError) {
        return c.json({ error: { message: 'Secret value is required' } }, 400);
      }
      throw error;
    }

    let result = await withTransaction(transaction =>
      store.updateEnvironment(
        {
          tenant_id: requestContext.tenant_id,
          id: existing.environment.id,
          description: manifest.description ?? '',
          active_version,
          version: { ...next, created_by_subject },
        },
        transaction,
      ),
    );
    if (!result) {
      throw new Error(`Sandbox environment disappeared during update: ${name}`);
    }

    if (next.needs_snapshot) {
      result = {
        ...result,
        version: await startSnapshotBuild({
          store,
          providerStore,
          tenant_id: requestContext.tenant_id,
          version: result.version,
          logger,
        }),
      };
    }

    return c.json({ data: toSandboxEnvironment(result) });
  });

  router.delete('/:name', async c => {
    const { tenant_id, subject } = resolveRequestContext(c);
    const name = c.req.param('name');
    const existing = await store.getEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    if (!existing) {
      return c.json({ error: { message: `Sandbox environment not found: ${name}` } }, 404);
    }
    const agentNames = await resolveAgentStore(c).listAgentNamesUsingSandboxEnvironment({
      tenant_id,
      environment_name: name,
    });
    if (agentNames.length > 0) {
      const listed = agentNames.slice(0, 5).join(', ');
      const more = agentNames.length > 5 ? ` (+${String(agentNames.length - 5)} more)` : '';
      return c.json(
        {
          error: {
            message: `Sandbox environment "${name}" is referenced by agent(s): ${listed}${more}`,
          },
        },
        409,
      );
    }
    await store.deleteEnvironment({
      tenant_id,
      name,
      created_by_subject_id: subject.id,
    });
    return c.json({});
  });

  return router;
}
