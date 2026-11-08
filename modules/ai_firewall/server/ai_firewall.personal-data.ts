import type { PersonalDataClass } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

/**
 * The personal-data classes of the stored attributes, read from `ai_firewall:signal` (docs/phases/55-ai-firewall/01 §1.5): what the
 * export redacts and what the erasure removes are decided by the class each kind declared for each attribute (common.firewall-contracts
 * PERSONAL_DATA_CLASSES), not by a list of names kept here.
 *
 * Fail closed: an attribute of a kind nobody registered (the consumer stores every well-formed signal it hears), an attribute the kind
 * did not declare, and every attribute while the registry cannot be loaded have no class, and a reader treats them as personal data.
 */
export type AttrClasses = ReadonlyMap<string, Readonly<Record<string, PersonalDataClass>>>;

/** The classes of every registered kind; an empty map (every attribute unclassified) when the registry cannot be loaded. Never throws. */
export async function loadAttrClasses(): Promise<AttrClasses> {
  try {
    const { firewallRegistry } = await import('./registry/ai_firewall.registry');
    const verdict = await firewallRegistry();
    const out = new Map<string, Record<string, PersonalDataClass>>();
    for (const s of verdict.catalog.signals.values()) {
      out.set(s.kind, Object.fromEntries(Object.entries(s.attrs).map(([name, a]) => [name, a.pd])));
    }
    return out;
  } catch {
    return new Map();
  }
}

/** The class of one attribute of one kind, or null when there is none (an unregistered kind or an undeclared attribute). */
export function classOfAttr(classes: AttrClasses, kind: string, name: string): PersonalDataClass | null {
  const attrs = classes.get(kind);
  return attrs && Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name]! : null;
}

/** Whether an attribute may leave the store without a person in it: only a declared `none`. */
export const isPersonFreeAttr = (classes: AttrClasses, kind: string, name: string): boolean => classOfAttr(classes, kind, name) === 'none';

/** The attributes of a kind that name or reach a person and go when that person is the row's subject (identifier, contact, content). */
export const SUBJECT_ERASED_CLASSES: readonly PersonalDataClass[] = ['identifier', 'contact', 'content'];

/**
 * Per registered kind, the attribute names of `wanted` classes (a JSON-able map for one SQL parameter). A kind with none is left out;
 * the caller decides what an unregistered kind loses.
 */
export function attrsOfClasses(classes: AttrClasses, wanted: readonly PersonalDataClass[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [kind, attrs] of classes) {
    const names = Object.entries(attrs).filter(([, pd]) => wanted.includes(pd)).map(([name]) => name).sort();
    if (names.length) out[kind] = names;
  }
  return out;
}

/** Actor kinds that are a person or a person's credential: their id is an identifier (an address is `network`, kept apart). */
export const PERSON_ACTOR_KINDS: ReadonlySet<string> = new Set(['user', 'session', 'apiKey']);

/** A subject whose id is a person's user id (`user`, `User`, `user_security`, `user_social_account`, ...): matched case-insensitively. */
export const isPersonSubjectType = (type: string | null | undefined): boolean => typeof type === 'string' && /^user(_|$)/i.test(type);
