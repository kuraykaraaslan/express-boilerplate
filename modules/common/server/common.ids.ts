/**
 * Nominal id brands — the type-level answer to "which id space is this uuid in?".
 *
 * Every id in this repo is a bare uuid string, which means the compiler happily
 * accepts an `employeeId` wherever a `userId` is expected. That is not a
 * hypothetical: the payroll finaliser looked a payslip's `employeeId` up in the
 * USER table, the lookup missed on every row, and the `.catch(() => null)`
 * around it turned "nobody was ever emailed their payslip" into silence
 * (audit 2026-08, DEP-03).
 *
 * The shape below is chosen so that adopting a brand costs nothing at the call
 * sites that were already right:
 *
 *   - `Id<'User'>` is still a `string`, so a branded value can be logged,
 *     concatenated, put in a Redis key or passed to `repo.findOne` unchanged.
 *   - `IdInput<UserId>` accepts a plain `string` (a route param, a body field,
 *     a session id nobody has branded yet) — no ceremony, no `as` casts spread
 *     across the codebase.
 *   - `IdInput<UserId>` REJECTS `Id<'Employee'>`, because a brand from another
 *     space is not assignable to the optional-`undefined` slot. That single
 *     asymmetry is the whole point: unbranded is trusted, MIS-branded is not.
 *
 * So a sink brands its parameter (`getById(userId: IdInput<UserId>)`) and a
 * source brands its column (`employeeId!: EmployeeId`); everything in between
 * stays plain. Crossing the two spaces on purpose then has exactly one spelling
 * — the owning module's resolver (see `EmployeeSessionService.resolveUserId`) —
 * and laundering one into the other needs a loud `as unknown as`.
 *
 * Brands live with the module that OWNS the concept: `UserId` in `user`,
 * `EmployeeId` in `hr`. Only the machinery is here, because `common` is the one
 * module both sides may import.
 */

declare const ID_SPACE: unique symbol

/** A uuid that belongs to exactly one id space. Still a `string` at runtime. */
export type Id<Space extends string> = string & { readonly [ID_SPACE]: Space }

/**
 * A string that has not claimed an id space — a route param, a DTO field, a
 * literal. Assignable to any `IdInput<…>`; a foreign brand is not.
 */
export type UnbrandedId = string & { readonly [ID_SPACE]?: undefined }

/** What a sink should accept: its own brand, or a string nobody has branded. */
export type IdInput<Branded extends string> = Branded | UnbrandedId
