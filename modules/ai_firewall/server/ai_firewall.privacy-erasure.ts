import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { accessRel } from '@kuraykaraaslan-labs/db/server/db.time-series.rollup';
import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { ErasureOutcome, PrivacySubject } from '@kuraykaraaslan-labs/common/server/common.privacy-contracts';
import { ACTIONS_TABLE, EVENTS_TABLE, INCIDENTS_TABLE, TERMINAL_ACTION_STATUSES } from './store/ai_firewall.store';
import { SUBJECT_ERASED_CLASSES, attrsOfClasses, loadAttrClasses, type AttrClasses } from './ai_firewall.personal-data';
import { BASELINES_TABLE } from './features/ai_firewall.baseline.store';
import { LABELS_TABLE } from './labels/ai_firewall.label-store';
import { featureIdOf } from './features/ai_firewall.feature-id';
import { forgetFeatureActor } from './features/ai_firewall.feature-forget';
import { tenantScope } from './features/ai_firewall.feature-windows';

/**
 * `privacy:erasure` for the AI firewall's store (docs/phases/55-ai-firewall/01 §1.7). The person is reached by their user id and their
 * e-mail address (the subject's identifiers), and what an attribute is comes from the class its kind declared in `ai_firewall:signal`
 * (ai_firewall.personal-data.ts; the contract: the class decides what erasure removes).
 *
 *   1. stored events the person produced are deleted: an actor `user` with the id, and an actor `session` that is one of the person's
 *      session rows, whatever their status, expiry or idleness (user_session `sessionIdsOfUser`, read best effort, D55-18). A session
 *      whose row is already gone (signed out, revoked by an administrator, pruned) links to no one any more and its events stay until the
 *      retention. They are that person's behaviour, and nothing of the firewall needs an erased account's past;
 *   2. events about the person (a subject whose id is the user id, whatever its type: `user`, `User`, `user_security`, ...), produced by
 *      someone else, keep their row and lose the subject and every attribute of class identifier, contact or content (an event of a kind
 *      nobody registered has no classes and loses every attribute);
 *   3. any other event that carries the person's user id or e-mail address in an attribute (a failed sign-in an outsider made for the
 *      address, an impersonation's `onBehalfOf`, a `m.userId`, an API key's row about the person) loses that attribute, case-insensitively,
 *      whatever its class or kind. An address-actor or API-key-actor row stays: an address is not the person's alone (NAT) and an API key
 *      is the tenant's credential, which outlives the person who created it;
 *   4. incidents and ended action proposals keep their row (the operational record of a decision other people took) and lose the person:
 *      the actor id (the user, or one of their sessions: an incident about a session, 02 §2.4) becomes `erased`, `closedBy` /
 *      `acknowledgedBy` / `decidedBy` / `undoneBy` and the undo data are cleared. An incident's score timeline and explanation hold
 *      feature names and numbers only and stay;
 *   5. an action still waiting or in force (`proposed`, `executed`) is retained as it is: its undo needs the actor, and the person's
 *      account is being erased anyway; it is anonymised by a later erasure run once it has ended (or deleted by the retention);
 *   6. the person's baseline of the feature store (02 §2.1, `ai_firewall_baselines`, keyed by the keyed hash of the user id) is
 *      deleted. A role prior is an average over many people and stays;
 *   6b. the labels (03 §3.1, `ai_firewall_labels`) follow what they are about: a label of one of the person's own events (a decoy they
 *      touched, as the user or through one of their sessions) is deleted with the event; a label of an incident about them keeps its row
 *      and loses the actor (`erased`), as the incident does; a label the person gave (`labelledBy`) keeps its row and loses its labeller.
 *      A label about an address (a ban an operator placed or lifted) is not the person's and stays. The vectors kept for the dataset
 *      export (03 §3.5, migration 006) go too: an incident about the person and its labels lose them, so no training row is ever made
 *      from an erased person's behaviour;
 *   7. after the transaction, the person's feature-store keys in Redis (windows, touched endpoints, the day profiles of the last three
 *      days and their work-list entries) are deleted and the actor is marked erased, so the nightly baseline job cannot rebuild the
 *      baseline from a day profile still in Redis (D55-46; `ai_firewall.feature-forget.ts`). Best effort: what Redis does not answer
 *      expires on its own within two days, and the erasure never fails on it.
 *
 * With only an e-mail address (a contact, no account), step 3 runs alone. `dryRun` counts only, in the same order.
 */
export const ERASED_ACTOR = 'erased';
const RETAINED_REASON =
  'Incidents, their labels and action proposals are the record of security decisions other people took; the person was removed from them. '
  + 'An action still waiting or in force keeps its actor until it ends, because its undo needs it.';

const count = (result: unknown): number => Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);

export interface ErasureDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  /** The registry's attribute classes (empty when it cannot be loaded: nothing is classified, so a subject row loses every attribute). */
  classes?: () => Promise<AttrClasses>;
  /** The person's session ids (best effort: a failure answers none). */
  sessionIdsOf?: (userId: string) => Promise<string[]>;
  /** The keyed feature id of a user id (null when the installation has no key: then no baseline was ever written). */
  featureIdOf?: (userId: string) => string | null;
  /** Step 7: deletes a feature-store actor's Redis keys and marks it erased (absent: skipped). Never throws. */
  forgetFeatures?: (scope: string, kind: string, hash: string) => Promise<boolean>;
}

async function personSessionIds(userId: string): Promise<string[]> {
  try {
    const { sessionIdsOfUser } = await import('@kuraykaraaslan-labs/user_session/server/user_session.admin.service');
    return await sessionIdsOfUser(userId);
  } catch {
    return [];
  }
}

const defaultDeps: ErasureDeps = {
  inTenant: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
  accessRel,
  classes: loadAttrClasses,
  sessionIdsOf: personSessionIds,
  forgetFeatures: (scope, kind, hash) => forgetFeatureActor(scope, kind, hash),
};

/** The text of a stored attribute value (a string, or an `UntrustedText`'s text), lower case; SQL over `jsonb_each(attrs) a(key, value)`. */
const ATTR_TEXT_SQL = `lower(CASE jsonb_typeof(a.value) WHEN 'string' THEN a.value #>> '{}' WHEN 'object' THEN a.value ->> 'text' END)`;

export async function erase(
  tenantId: string, subject: PrivacySubject, options: { dryRun: boolean }, deps: ErasureDeps = defaultDeps,
): Promise<ErasureOutcome> {
  const userId = subject.identifiers?.userId ?? (subject.subjectType === 'USER' ? subject.subjectId : null);
  const email = typeof subject.identifiers?.email === 'string' && subject.identifiers.email.trim() ? subject.identifiers.email.trim() : null;
  if (!userId && !email) return { erased: 0, mode: 'ERASE' };
  const dry = options?.dryRun === true;
  const ended = [...TERMINAL_ACTION_STATUSES];
  const needles = [userId, email].filter((v): v is string => !!v).map((v) => v.toLowerCase());
  const [classes, sessionIds] = userId
    ? await Promise.all([(deps.classes ?? loadAttrClasses)(), (deps.sessionIdsOf ?? personSessionIds)(userId)])
    : [new Map() as AttrClasses, [] as string[]];
  const subjectErased = attrsOfClasses(classes, SUBJECT_ERASED_CLASSES);
  const registeredKinds = [...classes.keys()];

  const baselineKey = userId ? (deps.featureIdOf ?? ((id: string) => featureIdOf('user', id)))(userId) : null;

  const outcome = await deps.inTenant(tenantId, async (db): Promise<ErasureOutcome> => {
    const events = await deps.accessRel(db, EVENTS_TABLE);
    // `countParams`: when the count names fewer parameters than the write (Postgres refuses a parameter a statement never uses).
    const run = async (countSql: string, writeSql: string, params: unknown[], countParams: unknown[] = params): Promise<number> => {
      const n = count(await db.query(countSql, countParams));
      if (!dry && n > 0) await db.query(writeSql, params);
      return n;
    };
    let erased = 0;
    if (userId) {
      // 1. the person's own behaviour: as the user, and through one of their sessions
      erased += await run(
        `SELECT count(*)::int AS n FROM ${events} WHERE "tenantId" = $1
           AND ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))`,
        `DELETE FROM ${events} WHERE "tenantId" = $1
           AND ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))`,
        [tenantId, userId, sessionIds],
      );
      // 2. about the person: the subject (any type whose id is the user id) and the attributes that name or reach a person
      erased += await run(
        `SELECT count(*)::int AS n FROM ${events} WHERE "tenantId" = $1 AND "subjectId" = $2`,
        `UPDATE ${events} SET "subjectType" = NULL, "subjectId" = NULL,
           "attrs" = CASE WHEN "kind" = ANY($3::text[])
             THEN "attrs" - ARRAY(SELECT jsonb_array_elements_text(COALESCE($4::jsonb -> "kind", '[]'::jsonb)))
             ELSE '{}'::jsonb END
         WHERE "tenantId" = $1 AND "subjectId" = $2`,
        [tenantId, userId, registeredKinds, JSON.stringify(subjectErased)],
        [tenantId, userId],
      );
    }
    // 3. anywhere else: an attribute whose value is the person's user id or e-mail address
    erased += await run(
      `SELECT count(*)::int AS n FROM ${events} e WHERE e."tenantId" = $1
         AND EXISTS (SELECT 1 FROM jsonb_each(e."attrs") a WHERE ${ATTR_TEXT_SQL} = ANY($2::text[]))`,
      `UPDATE ${events} e SET "attrs" = e."attrs" - ARRAY(SELECT a.key FROM jsonb_each(e."attrs") a WHERE ${ATTR_TEXT_SQL} = ANY($2::text[]))
       WHERE e."tenantId" = $1 AND EXISTS (SELECT 1 FROM jsonb_each(e."attrs") a WHERE ${ATTR_TEXT_SQL} = ANY($2::text[]))`,
      [tenantId, needles],
    );
    if (!userId) return { erased, mode: 'ERASE' };

    let retained = 0;
    // An erased incident leaves the one-active-incident index (an `erased` actor is no one's): it is closed as well when it was active.
    retained += await run(
      `SELECT count(*)::int AS n FROM "${INCIDENTS_TABLE}" WHERE "tenantId" = $1
         AND ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[])
              OR "closedBy"::text = $2 OR "acknowledgedBy"::text = $2)`,
      `UPDATE "${INCIDENTS_TABLE}" SET
         "status" = CASE WHEN ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))
                          AND "status" <> 'closed' THEN 'closed' ELSE "status" END,
         "closeReason" = CASE WHEN ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))
                          AND "status" <> 'closed' THEN 'erased' ELSE "closeReason" END,
         "closedAt" = CASE WHEN ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))
                          AND "status" <> 'closed' THEN now() ELSE "closedAt" END,
         "actorId" = CASE WHEN "actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[])
                          THEN '${ERASED_ACTOR}' ELSE "actorId" END,
         "peakVectors" = CASE WHEN "actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[])
                          THEN NULL ELSE "peakVectors" END,
         "closedBy" = CASE WHEN "closedBy"::text = $2 THEN NULL ELSE "closedBy" END,
         "acknowledgedBy" = CASE WHEN "acknowledgedBy"::text = $2 THEN NULL ELSE "acknowledgedBy" END
       WHERE "tenantId" = $1
         AND ("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[])
              OR "closedBy"::text = $2 OR "acknowledgedBy"::text = $2)`,
      [tenantId, userId, sessionIds],
    );
    retained += await run(
      `SELECT count(*)::int AS n FROM "${ACTIONS_TABLE}" WHERE "tenantId" = $1 AND "status" = ANY($3::text[])
         AND ("actorKind" = 'user' AND "actorId" = $2 OR "subjectId" = $2
              OR "decidedBy"::text = $2 OR "undoneBy"::text = $2)`,
      `UPDATE "${ACTIONS_TABLE}" SET
         "actorId" = CASE WHEN "actorKind" = 'user' AND "actorId" = $2 THEN '${ERASED_ACTOR}' ELSE "actorId" END,
         "subjectType" = CASE WHEN "subjectId" = $2 THEN NULL ELSE "subjectType" END,
         "subjectId" = CASE WHEN "subjectId" = $2 THEN NULL ELSE "subjectId" END,
         "decidedBy" = CASE WHEN "decidedBy"::text = $2 THEN NULL ELSE "decidedBy" END,
         "undoneBy" = CASE WHEN "undoneBy"::text = $2 THEN NULL ELSE "undoneBy" END,
         "undoData" = NULL
       WHERE "tenantId" = $1 AND "status" = ANY($3::text[])
         AND ("actorKind" = 'user' AND "actorId" = $2 OR "subjectId" = $2
              OR "decidedBy"::text = $2 OR "undoneBy"::text = $2)`,
      [tenantId, userId, ended],
    );
    // Still waiting or in force: counted as retained, left as they are.
    const live = count(await db.query(
      `SELECT count(*)::int AS n FROM "${ACTIONS_TABLE}" WHERE "tenantId" = $1 AND NOT ("status" = ANY($3::text[]))
         AND ("actorKind" = 'user' AND "actorId" = $2 OR "subjectId" = $2)`,
      [tenantId, userId, ended],
    ));
    retained += live;

    // 6. the person's baseline (the keyed hash of their user id)
    if (baselineKey) {
      erased += await run(
        `SELECT count(*)::int AS n FROM "${BASELINES_TABLE}" WHERE "tenantId" = $1 AND "actorKind" = 'user' AND "actorKey" = $2`,
        `DELETE FROM "${BASELINES_TABLE}" WHERE "tenantId" = $1 AND "actorKind" = 'user' AND "actorKey" = $2`,
        [tenantId, baselineKey],
      );
    }

    // 6b. the labels: of the person's own events (deleted with them), of their incidents and by them (anonymised)
    const ownActor = `("actorKind" = 'user' AND "actorId" = $2 OR "actorKind" = 'session' AND "actorId" = ANY($3::text[]))`;
    erased += await run(
      `SELECT count(*)::int AS n FROM "${LABELS_TABLE}" WHERE "tenantId" = $1 AND "refKind" = 'event' AND ${ownActor}`,
      `DELETE FROM "${LABELS_TABLE}" WHERE "tenantId" = $1 AND "refKind" = 'event' AND ${ownActor}`,
      [tenantId, userId, sessionIds],
    );
    retained += await run(
      `SELECT count(*)::int AS n FROM "${LABELS_TABLE}" WHERE "tenantId" = $1
         AND ("refKind" = 'incident' AND ${ownActor} OR "labelledBy"::text = $2)`,
      `UPDATE "${LABELS_TABLE}" SET
         "actorId" = CASE WHEN "refKind" = 'incident' AND ${ownActor} THEN '${ERASED_ACTOR}' ELSE "actorId" END,
         "vectors" = CASE WHEN "refKind" = 'incident' AND ${ownActor} THEN NULL ELSE "vectors" END,
         "labelledBy" = CASE WHEN "labelledBy"::text = $2 THEN NULL ELSE "labelledBy" END,
         "updatedAt" = now()
       WHERE "tenantId" = $1 AND ("refKind" = 'incident' AND ${ownActor} OR "labelledBy"::text = $2)`,
      [tenantId, userId, sessionIds],
    );

    return {
      erased,
      mode: retained > 0 ? 'MIXED' : 'ERASE',
      ...(retained > 0 ? { retained, retainedReason: RETAINED_REASON } : {}),
    };
  });

  // 7. the person's feature-store keys in Redis, once the rows are gone (best effort, never fails the erasure)
  if (!dry && baselineKey && deps.forgetFeatures) {
    try {
      await deps.forgetFeatures(tenantScope(tenantId), 'user', baselineKey);
    } catch {
      // the keys expire on their own within two days
    }
  }
  return outcome;
}

const erasureProvider = { erase };
export default erasureProvider;
