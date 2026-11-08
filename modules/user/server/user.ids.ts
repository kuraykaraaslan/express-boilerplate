import type { Id, IdInput, UnbrandedId } from '@kuraykaraaslan-labs/common/server/common.ids'

/**
 * The platform-login id space. `user` owns the concept, so it owns the brand —
 * see `common/server/common.ids.ts` for why brands exist at all and how the
 * asymmetry works.
 */
export type UserId = Id<'User'>

/**
 * What a function that takes a user id should declare. Accepts `UserId` and any
 * plain string; refuses an id branded into a different space (an `EmployeeId`,
 * say) at compile time.
 */
export type UserIdInput = IdInput<UserId>

/**
 * Assert that a plain string is a user id.
 *
 * Deliberately typed to accept only UNBRANDED strings: this is for the boundary
 * where a uuid arrives untyped (a route param, a JWT claim, a webhook body), not
 * a way to re-label an id that already belongs to another space. Crossing spaces
 * goes through the owning module's resolver instead.
 */
export const asUserId = (value: UnbrandedId): UserId => value as unknown as UserId
