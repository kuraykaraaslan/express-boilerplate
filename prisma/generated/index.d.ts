
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model User
 * 
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model UserSession
 * 
 */
export type UserSession = $Result.DefaultSelection<Prisma.$UserSessionPayload>
/**
 * Model UserSocialAccount
 * 
 */
export type UserSocialAccount = $Result.DefaultSelection<Prisma.$UserSocialAccountPayload>
/**
 * Model Tenant
 * 
 */
export type Tenant = $Result.DefaultSelection<Prisma.$TenantPayload>
/**
 * Model TenantUser
 * 
 */
export type TenantUser = $Result.DefaultSelection<Prisma.$TenantUserPayload>
/**
 * Model Settings
 * 
 */
export type Settings = $Result.DefaultSelection<Prisma.$SettingsPayload>
/**
 * Model SubscriptionPrice
 * 
 */
export type SubscriptionPrice = $Result.DefaultSelection<Prisma.$SubscriptionPricePayload>
/**
 * Model SubscriptionPlan
 * 
 */
export type SubscriptionPlan = $Result.DefaultSelection<Prisma.$SubscriptionPlanPayload>
/**
 * Model Subscription
 * 
 */
export type Subscription = $Result.DefaultSelection<Prisma.$SubscriptionPayload>
/**
 * Model Address
 * 
 */
export type Address = $Result.DefaultSelection<Prisma.$AddressPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const OTPMethod: {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  TOTP_APP: 'TOTP_APP',
  PUSH_APP: 'PUSH_APP'
};

export type OTPMethod = (typeof OTPMethod)[keyof typeof OTPMethod]


export const UserRole: {
  USER: 'USER',
  ADMIN: 'ADMIN'
};

export type UserRole = (typeof UserRole)[keyof typeof UserRole]


export const UserStatus: {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED'
};

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]


export const TenantStatus: {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED'
};

export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus]


export const TenantUserRole: {
  USER: 'USER',
  ADMIN: 'ADMIN'
};

export type TenantUserRole = (typeof TenantUserRole)[keyof typeof TenantUserRole]


export const TenantUserStatus: {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED'
};

export type TenantUserStatus = (typeof TenantUserStatus)[keyof typeof TenantUserStatus]


export const SubscriptionStatus: {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED'
};

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]


export const PaymentMethod: {
  STRIPE: 'STRIPE',
  PAYPAL: 'PAYPAL',
  IYZICO: 'IYZICO'
};

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod]


export const Currency: {
  USD: 'USD',
  EUR: 'EUR',
  TRY: 'TRY',
  GBP: 'GBP'
};

export type Currency = (typeof Currency)[keyof typeof Currency]


export const SubscriptionBillingCycle: {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY'
};

export type SubscriptionBillingCycle = (typeof SubscriptionBillingCycle)[keyof typeof SubscriptionBillingCycle]


export const AddressIntent: {
  BILLING: 'BILLING',
  SHIPPING: 'SHIPPING'
};

export type AddressIntent = (typeof AddressIntent)[keyof typeof AddressIntent]


export const AddressType: {
  PERSONAL: 'PERSONAL',
  BUSINESS: 'BUSINESS'
};

export type AddressType = (typeof AddressType)[keyof typeof AddressType]

}

export type OTPMethod = $Enums.OTPMethod

export const OTPMethod: typeof $Enums.OTPMethod

export type UserRole = $Enums.UserRole

export const UserRole: typeof $Enums.UserRole

export type UserStatus = $Enums.UserStatus

export const UserStatus: typeof $Enums.UserStatus

export type TenantStatus = $Enums.TenantStatus

export const TenantStatus: typeof $Enums.TenantStatus

export type TenantUserRole = $Enums.TenantUserRole

export const TenantUserRole: typeof $Enums.TenantUserRole

export type TenantUserStatus = $Enums.TenantUserStatus

export const TenantUserStatus: typeof $Enums.TenantUserStatus

export type SubscriptionStatus = $Enums.SubscriptionStatus

export const SubscriptionStatus: typeof $Enums.SubscriptionStatus

export type PaymentMethod = $Enums.PaymentMethod

export const PaymentMethod: typeof $Enums.PaymentMethod

export type Currency = $Enums.Currency

export const Currency: typeof $Enums.Currency

export type SubscriptionBillingCycle = $Enums.SubscriptionBillingCycle

export const SubscriptionBillingCycle: typeof $Enums.SubscriptionBillingCycle

export type AddressIntent = $Enums.AddressIntent

export const AddressIntent: typeof $Enums.AddressIntent

export type AddressType = $Enums.AddressType

export const AddressType: typeof $Enums.AddressType

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Users
 * const users = await prisma.user.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Users
   * const users = await prisma.user.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.userSession`: Exposes CRUD operations for the **UserSession** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more UserSessions
    * const userSessions = await prisma.userSession.findMany()
    * ```
    */
  get userSession(): Prisma.UserSessionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.userSocialAccount`: Exposes CRUD operations for the **UserSocialAccount** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more UserSocialAccounts
    * const userSocialAccounts = await prisma.userSocialAccount.findMany()
    * ```
    */
  get userSocialAccount(): Prisma.UserSocialAccountDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.tenant`: Exposes CRUD operations for the **Tenant** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Tenants
    * const tenants = await prisma.tenant.findMany()
    * ```
    */
  get tenant(): Prisma.TenantDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.tenantUser`: Exposes CRUD operations for the **TenantUser** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TenantUsers
    * const tenantUsers = await prisma.tenantUser.findMany()
    * ```
    */
  get tenantUser(): Prisma.TenantUserDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.settings`: Exposes CRUD operations for the **Settings** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Settings
    * const settings = await prisma.settings.findMany()
    * ```
    */
  get settings(): Prisma.SettingsDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.subscriptionPrice`: Exposes CRUD operations for the **SubscriptionPrice** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more SubscriptionPrices
    * const subscriptionPrices = await prisma.subscriptionPrice.findMany()
    * ```
    */
  get subscriptionPrice(): Prisma.SubscriptionPriceDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.subscriptionPlan`: Exposes CRUD operations for the **SubscriptionPlan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more SubscriptionPlans
    * const subscriptionPlans = await prisma.subscriptionPlan.findMany()
    * ```
    */
  get subscriptionPlan(): Prisma.SubscriptionPlanDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.subscription`: Exposes CRUD operations for the **Subscription** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Subscriptions
    * const subscriptions = await prisma.subscription.findMany()
    * ```
    */
  get subscription(): Prisma.SubscriptionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.address`: Exposes CRUD operations for the **Address** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Addresses
    * const addresses = await prisma.address.findMany()
    * ```
    */
  get address(): Prisma.AddressDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.7.0
   * Query Engine version: 3cff47a7f5d65c3ea74883f1d736e41d68ce91ed
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    User: 'User',
    UserSession: 'UserSession',
    UserSocialAccount: 'UserSocialAccount',
    Tenant: 'Tenant',
    TenantUser: 'TenantUser',
    Settings: 'Settings',
    SubscriptionPrice: 'SubscriptionPrice',
    SubscriptionPlan: 'SubscriptionPlan',
    Subscription: 'Subscription',
    Address: 'Address'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "user" | "userSession" | "userSocialAccount" | "tenant" | "tenantUser" | "settings" | "subscriptionPrice" | "subscriptionPlan" | "subscription" | "address"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.UserUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      UserSession: {
        payload: Prisma.$UserSessionPayload<ExtArgs>
        fields: Prisma.UserSessionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserSessionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserSessionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          findFirst: {
            args: Prisma.UserSessionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserSessionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          findMany: {
            args: Prisma.UserSessionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>[]
          }
          create: {
            args: Prisma.UserSessionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          createMany: {
            args: Prisma.UserSessionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserSessionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>[]
          }
          delete: {
            args: Prisma.UserSessionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          update: {
            args: Prisma.UserSessionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          deleteMany: {
            args: Prisma.UserSessionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserSessionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.UserSessionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>[]
          }
          upsert: {
            args: Prisma.UserSessionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSessionPayload>
          }
          aggregate: {
            args: Prisma.UserSessionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUserSession>
          }
          groupBy: {
            args: Prisma.UserSessionGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserSessionGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserSessionCountArgs<ExtArgs>
            result: $Utils.Optional<UserSessionCountAggregateOutputType> | number
          }
        }
      }
      UserSocialAccount: {
        payload: Prisma.$UserSocialAccountPayload<ExtArgs>
        fields: Prisma.UserSocialAccountFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserSocialAccountFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserSocialAccountFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          findFirst: {
            args: Prisma.UserSocialAccountFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserSocialAccountFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          findMany: {
            args: Prisma.UserSocialAccountFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>[]
          }
          create: {
            args: Prisma.UserSocialAccountCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          createMany: {
            args: Prisma.UserSocialAccountCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserSocialAccountCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>[]
          }
          delete: {
            args: Prisma.UserSocialAccountDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          update: {
            args: Prisma.UserSocialAccountUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          deleteMany: {
            args: Prisma.UserSocialAccountDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserSocialAccountUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.UserSocialAccountUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>[]
          }
          upsert: {
            args: Prisma.UserSocialAccountUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserSocialAccountPayload>
          }
          aggregate: {
            args: Prisma.UserSocialAccountAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUserSocialAccount>
          }
          groupBy: {
            args: Prisma.UserSocialAccountGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserSocialAccountGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserSocialAccountCountArgs<ExtArgs>
            result: $Utils.Optional<UserSocialAccountCountAggregateOutputType> | number
          }
        }
      }
      Tenant: {
        payload: Prisma.$TenantPayload<ExtArgs>
        fields: Prisma.TenantFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TenantFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TenantFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          findFirst: {
            args: Prisma.TenantFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TenantFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          findMany: {
            args: Prisma.TenantFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>[]
          }
          create: {
            args: Prisma.TenantCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          createMany: {
            args: Prisma.TenantCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TenantCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>[]
          }
          delete: {
            args: Prisma.TenantDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          update: {
            args: Prisma.TenantUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          deleteMany: {
            args: Prisma.TenantDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TenantUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.TenantUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>[]
          }
          upsert: {
            args: Prisma.TenantUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          aggregate: {
            args: Prisma.TenantAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTenant>
          }
          groupBy: {
            args: Prisma.TenantGroupByArgs<ExtArgs>
            result: $Utils.Optional<TenantGroupByOutputType>[]
          }
          count: {
            args: Prisma.TenantCountArgs<ExtArgs>
            result: $Utils.Optional<TenantCountAggregateOutputType> | number
          }
        }
      }
      TenantUser: {
        payload: Prisma.$TenantUserPayload<ExtArgs>
        fields: Prisma.TenantUserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TenantUserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TenantUserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          findFirst: {
            args: Prisma.TenantUserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TenantUserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          findMany: {
            args: Prisma.TenantUserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>[]
          }
          create: {
            args: Prisma.TenantUserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          createMany: {
            args: Prisma.TenantUserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TenantUserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>[]
          }
          delete: {
            args: Prisma.TenantUserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          update: {
            args: Prisma.TenantUserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          deleteMany: {
            args: Prisma.TenantUserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TenantUserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.TenantUserUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>[]
          }
          upsert: {
            args: Prisma.TenantUserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantUserPayload>
          }
          aggregate: {
            args: Prisma.TenantUserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTenantUser>
          }
          groupBy: {
            args: Prisma.TenantUserGroupByArgs<ExtArgs>
            result: $Utils.Optional<TenantUserGroupByOutputType>[]
          }
          count: {
            args: Prisma.TenantUserCountArgs<ExtArgs>
            result: $Utils.Optional<TenantUserCountAggregateOutputType> | number
          }
        }
      }
      Settings: {
        payload: Prisma.$SettingsPayload<ExtArgs>
        fields: Prisma.SettingsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SettingsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SettingsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          findFirst: {
            args: Prisma.SettingsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SettingsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          findMany: {
            args: Prisma.SettingsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>[]
          }
          create: {
            args: Prisma.SettingsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          createMany: {
            args: Prisma.SettingsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SettingsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>[]
          }
          delete: {
            args: Prisma.SettingsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          update: {
            args: Prisma.SettingsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          deleteMany: {
            args: Prisma.SettingsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SettingsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SettingsUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>[]
          }
          upsert: {
            args: Prisma.SettingsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SettingsPayload>
          }
          aggregate: {
            args: Prisma.SettingsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSettings>
          }
          groupBy: {
            args: Prisma.SettingsGroupByArgs<ExtArgs>
            result: $Utils.Optional<SettingsGroupByOutputType>[]
          }
          count: {
            args: Prisma.SettingsCountArgs<ExtArgs>
            result: $Utils.Optional<SettingsCountAggregateOutputType> | number
          }
        }
      }
      SubscriptionPrice: {
        payload: Prisma.$SubscriptionPricePayload<ExtArgs>
        fields: Prisma.SubscriptionPriceFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SubscriptionPriceFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SubscriptionPriceFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          findFirst: {
            args: Prisma.SubscriptionPriceFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SubscriptionPriceFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          findMany: {
            args: Prisma.SubscriptionPriceFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>[]
          }
          create: {
            args: Prisma.SubscriptionPriceCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          createMany: {
            args: Prisma.SubscriptionPriceCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SubscriptionPriceCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>[]
          }
          delete: {
            args: Prisma.SubscriptionPriceDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          update: {
            args: Prisma.SubscriptionPriceUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          deleteMany: {
            args: Prisma.SubscriptionPriceDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SubscriptionPriceUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SubscriptionPriceUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>[]
          }
          upsert: {
            args: Prisma.SubscriptionPriceUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPricePayload>
          }
          aggregate: {
            args: Prisma.SubscriptionPriceAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSubscriptionPrice>
          }
          groupBy: {
            args: Prisma.SubscriptionPriceGroupByArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionPriceGroupByOutputType>[]
          }
          count: {
            args: Prisma.SubscriptionPriceCountArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionPriceCountAggregateOutputType> | number
          }
        }
      }
      SubscriptionPlan: {
        payload: Prisma.$SubscriptionPlanPayload<ExtArgs>
        fields: Prisma.SubscriptionPlanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SubscriptionPlanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SubscriptionPlanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          findFirst: {
            args: Prisma.SubscriptionPlanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SubscriptionPlanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          findMany: {
            args: Prisma.SubscriptionPlanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>[]
          }
          create: {
            args: Prisma.SubscriptionPlanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          createMany: {
            args: Prisma.SubscriptionPlanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SubscriptionPlanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>[]
          }
          delete: {
            args: Prisma.SubscriptionPlanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          update: {
            args: Prisma.SubscriptionPlanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          deleteMany: {
            args: Prisma.SubscriptionPlanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SubscriptionPlanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SubscriptionPlanUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>[]
          }
          upsert: {
            args: Prisma.SubscriptionPlanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPlanPayload>
          }
          aggregate: {
            args: Prisma.SubscriptionPlanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSubscriptionPlan>
          }
          groupBy: {
            args: Prisma.SubscriptionPlanGroupByArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionPlanGroupByOutputType>[]
          }
          count: {
            args: Prisma.SubscriptionPlanCountArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionPlanCountAggregateOutputType> | number
          }
        }
      }
      Subscription: {
        payload: Prisma.$SubscriptionPayload<ExtArgs>
        fields: Prisma.SubscriptionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SubscriptionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SubscriptionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          findFirst: {
            args: Prisma.SubscriptionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SubscriptionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          findMany: {
            args: Prisma.SubscriptionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          create: {
            args: Prisma.SubscriptionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          createMany: {
            args: Prisma.SubscriptionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SubscriptionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          delete: {
            args: Prisma.SubscriptionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          update: {
            args: Prisma.SubscriptionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          deleteMany: {
            args: Prisma.SubscriptionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SubscriptionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SubscriptionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          upsert: {
            args: Prisma.SubscriptionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          aggregate: {
            args: Prisma.SubscriptionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSubscription>
          }
          groupBy: {
            args: Prisma.SubscriptionGroupByArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionGroupByOutputType>[]
          }
          count: {
            args: Prisma.SubscriptionCountArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionCountAggregateOutputType> | number
          }
        }
      }
      Address: {
        payload: Prisma.$AddressPayload<ExtArgs>
        fields: Prisma.AddressFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AddressFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AddressFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          findFirst: {
            args: Prisma.AddressFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AddressFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          findMany: {
            args: Prisma.AddressFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>[]
          }
          create: {
            args: Prisma.AddressCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          createMany: {
            args: Prisma.AddressCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AddressCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>[]
          }
          delete: {
            args: Prisma.AddressDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          update: {
            args: Prisma.AddressUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          deleteMany: {
            args: Prisma.AddressDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AddressUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.AddressUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>[]
          }
          upsert: {
            args: Prisma.AddressUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AddressPayload>
          }
          aggregate: {
            args: Prisma.AddressAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAddress>
          }
          groupBy: {
            args: Prisma.AddressGroupByArgs<ExtArgs>
            result: $Utils.Optional<AddressGroupByOutputType>[]
          }
          count: {
            args: Prisma.AddressCountArgs<ExtArgs>
            result: $Utils.Optional<AddressCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    user?: UserOmit
    userSession?: UserSessionOmit
    userSocialAccount?: UserSocialAccountOmit
    tenant?: TenantOmit
    tenantUser?: TenantUserOmit
    settings?: SettingsOmit
    subscriptionPrice?: SubscriptionPriceOmit
    subscriptionPlan?: SubscriptionPlanOmit
    subscription?: SubscriptionOmit
    address?: AddressOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type UserCountOutputType
   */

  export type UserCountOutputType = {
    userSessions: number
    userSocialAccounts: number
    tenantUsers: number
  }

  export type UserCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    userSessions?: boolean | UserCountOutputTypeCountUserSessionsArgs
    userSocialAccounts?: boolean | UserCountOutputTypeCountUserSocialAccountsArgs
    tenantUsers?: boolean | UserCountOutputTypeCountTenantUsersArgs
  }

  // Custom InputTypes
  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserCountOutputType
     */
    select?: UserCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountUserSessionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserSessionWhereInput
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountUserSocialAccountsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserSocialAccountWhereInput
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountTenantUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TenantUserWhereInput
  }


  /**
   * Count Type TenantCountOutputType
   */

  export type TenantCountOutputType = {
    tenantUsers: number
    subscriptions: number
  }

  export type TenantCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenantUsers?: boolean | TenantCountOutputTypeCountTenantUsersArgs
    subscriptions?: boolean | TenantCountOutputTypeCountSubscriptionsArgs
  }

  // Custom InputTypes
  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantCountOutputType
     */
    select?: TenantCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountTenantUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TenantUserWhereInput
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountSubscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }


  /**
   * Count Type SubscriptionPriceCountOutputType
   */

  export type SubscriptionPriceCountOutputType = {
    Subscription: number
  }

  export type SubscriptionPriceCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    Subscription?: boolean | SubscriptionPriceCountOutputTypeCountSubscriptionArgs
  }

  // Custom InputTypes
  /**
   * SubscriptionPriceCountOutputType without action
   */
  export type SubscriptionPriceCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPriceCountOutputType
     */
    select?: SubscriptionPriceCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * SubscriptionPriceCountOutputType without action
   */
  export type SubscriptionPriceCountOutputTypeCountSubscriptionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }


  /**
   * Count Type SubscriptionPlanCountOutputType
   */

  export type SubscriptionPlanCountOutputType = {
    price: number
    subscriptions: number
  }

  export type SubscriptionPlanCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    price?: boolean | SubscriptionPlanCountOutputTypeCountPriceArgs
    subscriptions?: boolean | SubscriptionPlanCountOutputTypeCountSubscriptionsArgs
  }

  // Custom InputTypes
  /**
   * SubscriptionPlanCountOutputType without action
   */
  export type SubscriptionPlanCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlanCountOutputType
     */
    select?: SubscriptionPlanCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * SubscriptionPlanCountOutputType without action
   */
  export type SubscriptionPlanCountOutputTypeCountPriceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionPriceWhereInput
  }

  /**
   * SubscriptionPlanCountOutputType without action
   */
  export type SubscriptionPlanCountOutputTypeCountSubscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }


  /**
   * Count Type AddressCountOutputType
   */

  export type AddressCountOutputType = {
    billingOrders: number
  }

  export type AddressCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    billingOrders?: boolean | AddressCountOutputTypeCountBillingOrdersArgs
  }

  // Custom InputTypes
  /**
   * AddressCountOutputType without action
   */
  export type AddressCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AddressCountOutputType
     */
    select?: AddressCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * AddressCountOutputType without action
   */
  export type AddressCountOutputTypeCountBillingOrdersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }


  /**
   * Models
   */

  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserMinAggregateOutputType = {
    userId: string | null
    email: string | null
    phone: string | null
    password: string | null
    name: string | null
    lastName: string | null
    userRole: $Enums.UserRole | null
    userStatus: $Enums.UserStatus | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
    profilePicture: string | null
    otpSecret: string | null
    userNationalityId: string | null
    userNationalityCountry: string | null
  }

  export type UserMaxAggregateOutputType = {
    userId: string | null
    email: string | null
    phone: string | null
    password: string | null
    name: string | null
    lastName: string | null
    userRole: $Enums.UserRole | null
    userStatus: $Enums.UserStatus | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
    profilePicture: string | null
    otpSecret: string | null
    userNationalityId: string | null
    userNationalityCountry: string | null
  }

  export type UserCountAggregateOutputType = {
    userId: number
    email: number
    phone: number
    password: number
    name: number
    lastName: number
    userRole: number
    userStatus: number
    createdAt: number
    updatedAt: number
    deletedAt: number
    profilePicture: number
    otpMethods: number
    otpSecret: number
    userNationalityId: number
    userNationalityCountry: number
    _all: number
  }


  export type UserMinAggregateInputType = {
    userId?: true
    email?: true
    phone?: true
    password?: true
    name?: true
    lastName?: true
    userRole?: true
    userStatus?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
    profilePicture?: true
    otpSecret?: true
    userNationalityId?: true
    userNationalityCountry?: true
  }

  export type UserMaxAggregateInputType = {
    userId?: true
    email?: true
    phone?: true
    password?: true
    name?: true
    lastName?: true
    userRole?: true
    userStatus?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
    profilePicture?: true
    otpSecret?: true
    userNationalityId?: true
    userNationalityCountry?: true
  }

  export type UserCountAggregateInputType = {
    userId?: true
    email?: true
    phone?: true
    password?: true
    name?: true
    lastName?: true
    userRole?: true
    userStatus?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
    profilePicture?: true
    otpMethods?: true
    otpSecret?: true
    userNationalityId?: true
    userNationalityCountry?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    userId: string
    email: string
    phone: string | null
    password: string
    name: string | null
    lastName: string | null
    userRole: $Enums.UserRole
    userStatus: $Enums.UserStatus
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    profilePicture: string | null
    otpMethods: $Enums.OTPMethod[]
    otpSecret: string | null
    userNationalityId: string | null
    userNationalityCountry: string | null
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userId?: boolean
    email?: boolean
    phone?: boolean
    password?: boolean
    name?: boolean
    lastName?: boolean
    userRole?: boolean
    userStatus?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    profilePicture?: boolean
    otpMethods?: boolean
    otpSecret?: boolean
    userNationalityId?: boolean
    userNationalityCountry?: boolean
    userSessions?: boolean | User$userSessionsArgs<ExtArgs>
    userSocialAccounts?: boolean | User$userSocialAccountsArgs<ExtArgs>
    tenantUsers?: boolean | User$tenantUsersArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userId?: boolean
    email?: boolean
    phone?: boolean
    password?: boolean
    name?: boolean
    lastName?: boolean
    userRole?: boolean
    userStatus?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    profilePicture?: boolean
    otpMethods?: boolean
    otpSecret?: boolean
    userNationalityId?: boolean
    userNationalityCountry?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userId?: boolean
    email?: boolean
    phone?: boolean
    password?: boolean
    name?: boolean
    lastName?: boolean
    userRole?: boolean
    userStatus?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    profilePicture?: boolean
    otpMethods?: boolean
    otpSecret?: boolean
    userNationalityId?: boolean
    userNationalityCountry?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    userId?: boolean
    email?: boolean
    phone?: boolean
    password?: boolean
    name?: boolean
    lastName?: boolean
    userRole?: boolean
    userStatus?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    profilePicture?: boolean
    otpMethods?: boolean
    otpSecret?: boolean
    userNationalityId?: boolean
    userNationalityCountry?: boolean
  }

  export type UserOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"userId" | "email" | "phone" | "password" | "name" | "lastName" | "userRole" | "userStatus" | "createdAt" | "updatedAt" | "deletedAt" | "profilePicture" | "otpMethods" | "otpSecret" | "userNationalityId" | "userNationalityCountry", ExtArgs["result"]["user"]>
  export type UserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    userSessions?: boolean | User$userSessionsArgs<ExtArgs>
    userSocialAccounts?: boolean | User$userSocialAccountsArgs<ExtArgs>
    tenantUsers?: boolean | User$tenantUsersArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type UserIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type UserIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {
      userSessions: Prisma.$UserSessionPayload<ExtArgs>[]
      userSocialAccounts: Prisma.$UserSocialAccountPayload<ExtArgs>[]
      tenantUsers: Prisma.$TenantUserPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      userId: string
      email: string
      phone: string | null
      password: string
      name: string | null
      lastName: string | null
      userRole: $Enums.UserRole
      userStatus: $Enums.UserStatus
      createdAt: Date
      updatedAt: Date
      deletedAt: Date | null
      profilePicture: string | null
      otpMethods: $Enums.OTPMethod[]
      otpSecret: string | null
      userNationalityId: string | null
      userNationalityCountry: string | null
    }, ExtArgs["result"]["user"]>
    composites: {}
  }

  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserFindUniqueArgs>(args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one User that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserFindFirstArgs>(args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `userId`
     * const userWithUserIdOnly = await prisma.user.findMany({ select: { userId: true } })
     * 
     */
    findMany<T extends UserFindManyArgs>(args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
     */
    create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Users.
     * @param {UserCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserCreateManyArgs>(args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {UserCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `userId`
     * const userWithUserIdOnly = await prisma.user.createManyAndReturn({
     *   select: { userId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
     */
    delete<T extends UserDeleteArgs>(args: SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserDeleteManyArgs>(args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserUpdateManyArgs>(args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users and returns the data updated in the database.
     * @param {UserUpdateManyAndReturnArgs} args - Arguments to update many Users.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Users and only return the `userId`
     * const userWithUserIdOnly = await prisma.user.updateManyAndReturn({
     *   select: { userId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends UserUpdateManyAndReturnArgs>(args: SelectSubset<T, UserUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
     */
    upsert<T extends UserUpsertArgs>(args: SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    userSessions<T extends User$userSessionsArgs<ExtArgs> = {}>(args?: Subset<T, User$userSessionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    userSocialAccounts<T extends User$userSocialAccountsArgs<ExtArgs> = {}>(args?: Subset<T, User$userSocialAccountsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    tenantUsers<T extends User$tenantUsersArgs<ExtArgs> = {}>(args?: Subset<T, User$tenantUsersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the User model
   */
  interface UserFieldRefs {
    readonly userId: FieldRef<"User", 'String'>
    readonly email: FieldRef<"User", 'String'>
    readonly phone: FieldRef<"User", 'String'>
    readonly password: FieldRef<"User", 'String'>
    readonly name: FieldRef<"User", 'String'>
    readonly lastName: FieldRef<"User", 'String'>
    readonly userRole: FieldRef<"User", 'UserRole'>
    readonly userStatus: FieldRef<"User", 'UserStatus'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
    readonly deletedAt: FieldRef<"User", 'DateTime'>
    readonly profilePicture: FieldRef<"User", 'String'>
    readonly otpMethods: FieldRef<"User", 'OTPMethod[]'>
    readonly otpSecret: FieldRef<"User", 'String'>
    readonly userNationalityId: FieldRef<"User", 'String'>
    readonly userNationalityCountry: FieldRef<"User", 'String'>
  }
    

  // Custom InputTypes
  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }

  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User createManyAndReturn
   */
  export type UserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to update.
     */
    limit?: number
  }

  /**
   * User updateManyAndReturn
   */
  export type UserUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to update.
     */
    limit?: number
  }

  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }

  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to delete.
     */
    limit?: number
  }

  /**
   * User.userSessions
   */
  export type User$userSessionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    where?: UserSessionWhereInput
    orderBy?: UserSessionOrderByWithRelationInput | UserSessionOrderByWithRelationInput[]
    cursor?: UserSessionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: UserSessionScalarFieldEnum | UserSessionScalarFieldEnum[]
  }

  /**
   * User.userSocialAccounts
   */
  export type User$userSocialAccountsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    where?: UserSocialAccountWhereInput
    orderBy?: UserSocialAccountOrderByWithRelationInput | UserSocialAccountOrderByWithRelationInput[]
    cursor?: UserSocialAccountWhereUniqueInput
    take?: number
    skip?: number
    distinct?: UserSocialAccountScalarFieldEnum | UserSocialAccountScalarFieldEnum[]
  }

  /**
   * User.tenantUsers
   */
  export type User$tenantUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    where?: TenantUserWhereInput
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    cursor?: TenantUserWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TenantUserScalarFieldEnum | TenantUserScalarFieldEnum[]
  }

  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
  }


  /**
   * Model UserSession
   */

  export type AggregateUserSession = {
    _count: UserSessionCountAggregateOutputType | null
    _min: UserSessionMinAggregateOutputType | null
    _max: UserSessionMaxAggregateOutputType | null
  }

  export type UserSessionMinAggregateOutputType = {
    userSessionId: string | null
    userId: string | null
    accessToken: string | null
    refreshToken: string | null
    sessionExpiry: Date | null
    otpVerifyNeeded: boolean | null
    otpVerifiedAt: Date | null
    ip: string | null
    os: string | null
    device: string | null
    browser: string | null
    city: string | null
    state: string | null
    country: string | null
    deviceFingerprint: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserSessionMaxAggregateOutputType = {
    userSessionId: string | null
    userId: string | null
    accessToken: string | null
    refreshToken: string | null
    sessionExpiry: Date | null
    otpVerifyNeeded: boolean | null
    otpVerifiedAt: Date | null
    ip: string | null
    os: string | null
    device: string | null
    browser: string | null
    city: string | null
    state: string | null
    country: string | null
    deviceFingerprint: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserSessionCountAggregateOutputType = {
    userSessionId: number
    userId: number
    accessToken: number
    refreshToken: number
    sessionExpiry: number
    otpVerifyNeeded: number
    otpVerifiedAt: number
    ip: number
    os: number
    device: number
    browser: number
    city: number
    state: number
    country: number
    deviceFingerprint: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserSessionMinAggregateInputType = {
    userSessionId?: true
    userId?: true
    accessToken?: true
    refreshToken?: true
    sessionExpiry?: true
    otpVerifyNeeded?: true
    otpVerifiedAt?: true
    ip?: true
    os?: true
    device?: true
    browser?: true
    city?: true
    state?: true
    country?: true
    deviceFingerprint?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserSessionMaxAggregateInputType = {
    userSessionId?: true
    userId?: true
    accessToken?: true
    refreshToken?: true
    sessionExpiry?: true
    otpVerifyNeeded?: true
    otpVerifiedAt?: true
    ip?: true
    os?: true
    device?: true
    browser?: true
    city?: true
    state?: true
    country?: true
    deviceFingerprint?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserSessionCountAggregateInputType = {
    userSessionId?: true
    userId?: true
    accessToken?: true
    refreshToken?: true
    sessionExpiry?: true
    otpVerifyNeeded?: true
    otpVerifiedAt?: true
    ip?: true
    os?: true
    device?: true
    browser?: true
    city?: true
    state?: true
    country?: true
    deviceFingerprint?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserSessionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserSession to aggregate.
     */
    where?: UserSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSessions to fetch.
     */
    orderBy?: UserSessionOrderByWithRelationInput | UserSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned UserSessions
    **/
    _count?: true | UserSessionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserSessionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserSessionMaxAggregateInputType
  }

  export type GetUserSessionAggregateType<T extends UserSessionAggregateArgs> = {
        [P in keyof T & keyof AggregateUserSession]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUserSession[P]>
      : GetScalarType<T[P], AggregateUserSession[P]>
  }




  export type UserSessionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserSessionWhereInput
    orderBy?: UserSessionOrderByWithAggregationInput | UserSessionOrderByWithAggregationInput[]
    by: UserSessionScalarFieldEnum[] | UserSessionScalarFieldEnum
    having?: UserSessionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserSessionCountAggregateInputType | true
    _min?: UserSessionMinAggregateInputType
    _max?: UserSessionMaxAggregateInputType
  }

  export type UserSessionGroupByOutputType = {
    userSessionId: string
    userId: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date
    otpVerifyNeeded: boolean
    otpVerifiedAt: Date | null
    ip: string | null
    os: string | null
    device: string | null
    browser: string | null
    city: string | null
    state: string | null
    country: string | null
    deviceFingerprint: string | null
    createdAt: Date
    updatedAt: Date
    _count: UserSessionCountAggregateOutputType | null
    _min: UserSessionMinAggregateOutputType | null
    _max: UserSessionMaxAggregateOutputType | null
  }

  type GetUserSessionGroupByPayload<T extends UserSessionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserSessionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserSessionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserSessionGroupByOutputType[P]>
            : GetScalarType<T[P], UserSessionGroupByOutputType[P]>
        }
      >
    >


  export type UserSessionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSessionId?: boolean
    userId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    sessionExpiry?: boolean
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: boolean
    ip?: boolean
    os?: boolean
    device?: boolean
    browser?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    deviceFingerprint?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSession"]>

  export type UserSessionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSessionId?: boolean
    userId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    sessionExpiry?: boolean
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: boolean
    ip?: boolean
    os?: boolean
    device?: boolean
    browser?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    deviceFingerprint?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSession"]>

  export type UserSessionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSessionId?: boolean
    userId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    sessionExpiry?: boolean
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: boolean
    ip?: boolean
    os?: boolean
    device?: boolean
    browser?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    deviceFingerprint?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSession"]>

  export type UserSessionSelectScalar = {
    userSessionId?: boolean
    userId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    sessionExpiry?: boolean
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: boolean
    ip?: boolean
    os?: boolean
    device?: boolean
    browser?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    deviceFingerprint?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserSessionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"userSessionId" | "userId" | "accessToken" | "refreshToken" | "sessionExpiry" | "otpVerifyNeeded" | "otpVerifiedAt" | "ip" | "os" | "device" | "browser" | "city" | "state" | "country" | "deviceFingerprint" | "createdAt" | "updatedAt", ExtArgs["result"]["userSession"]>
  export type UserSessionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type UserSessionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type UserSessionIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }

  export type $UserSessionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "UserSession"
    objects: {
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      userSessionId: string
      userId: string
      accessToken: string
      refreshToken: string
      sessionExpiry: Date
      otpVerifyNeeded: boolean
      otpVerifiedAt: Date | null
      ip: string | null
      os: string | null
      device: string | null
      browser: string | null
      city: string | null
      state: string | null
      country: string | null
      deviceFingerprint: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["userSession"]>
    composites: {}
  }

  type UserSessionGetPayload<S extends boolean | null | undefined | UserSessionDefaultArgs> = $Result.GetResult<Prisma.$UserSessionPayload, S>

  type UserSessionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<UserSessionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: UserSessionCountAggregateInputType | true
    }

  export interface UserSessionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['UserSession'], meta: { name: 'UserSession' } }
    /**
     * Find zero or one UserSession that matches the filter.
     * @param {UserSessionFindUniqueArgs} args - Arguments to find a UserSession
     * @example
     * // Get one UserSession
     * const userSession = await prisma.userSession.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserSessionFindUniqueArgs>(args: SelectSubset<T, UserSessionFindUniqueArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one UserSession that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {UserSessionFindUniqueOrThrowArgs} args - Arguments to find a UserSession
     * @example
     * // Get one UserSession
     * const userSession = await prisma.userSession.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserSessionFindUniqueOrThrowArgs>(args: SelectSubset<T, UserSessionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first UserSession that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionFindFirstArgs} args - Arguments to find a UserSession
     * @example
     * // Get one UserSession
     * const userSession = await prisma.userSession.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserSessionFindFirstArgs>(args?: SelectSubset<T, UserSessionFindFirstArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first UserSession that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionFindFirstOrThrowArgs} args - Arguments to find a UserSession
     * @example
     * // Get one UserSession
     * const userSession = await prisma.userSession.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserSessionFindFirstOrThrowArgs>(args?: SelectSubset<T, UserSessionFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more UserSessions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all UserSessions
     * const userSessions = await prisma.userSession.findMany()
     * 
     * // Get first 10 UserSessions
     * const userSessions = await prisma.userSession.findMany({ take: 10 })
     * 
     * // Only select the `userSessionId`
     * const userSessionWithUserSessionIdOnly = await prisma.userSession.findMany({ select: { userSessionId: true } })
     * 
     */
    findMany<T extends UserSessionFindManyArgs>(args?: SelectSubset<T, UserSessionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a UserSession.
     * @param {UserSessionCreateArgs} args - Arguments to create a UserSession.
     * @example
     * // Create one UserSession
     * const UserSession = await prisma.userSession.create({
     *   data: {
     *     // ... data to create a UserSession
     *   }
     * })
     * 
     */
    create<T extends UserSessionCreateArgs>(args: SelectSubset<T, UserSessionCreateArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many UserSessions.
     * @param {UserSessionCreateManyArgs} args - Arguments to create many UserSessions.
     * @example
     * // Create many UserSessions
     * const userSession = await prisma.userSession.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserSessionCreateManyArgs>(args?: SelectSubset<T, UserSessionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many UserSessions and returns the data saved in the database.
     * @param {UserSessionCreateManyAndReturnArgs} args - Arguments to create many UserSessions.
     * @example
     * // Create many UserSessions
     * const userSession = await prisma.userSession.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many UserSessions and only return the `userSessionId`
     * const userSessionWithUserSessionIdOnly = await prisma.userSession.createManyAndReturn({
     *   select: { userSessionId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserSessionCreateManyAndReturnArgs>(args?: SelectSubset<T, UserSessionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a UserSession.
     * @param {UserSessionDeleteArgs} args - Arguments to delete one UserSession.
     * @example
     * // Delete one UserSession
     * const UserSession = await prisma.userSession.delete({
     *   where: {
     *     // ... filter to delete one UserSession
     *   }
     * })
     * 
     */
    delete<T extends UserSessionDeleteArgs>(args: SelectSubset<T, UserSessionDeleteArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one UserSession.
     * @param {UserSessionUpdateArgs} args - Arguments to update one UserSession.
     * @example
     * // Update one UserSession
     * const userSession = await prisma.userSession.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserSessionUpdateArgs>(args: SelectSubset<T, UserSessionUpdateArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more UserSessions.
     * @param {UserSessionDeleteManyArgs} args - Arguments to filter UserSessions to delete.
     * @example
     * // Delete a few UserSessions
     * const { count } = await prisma.userSession.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserSessionDeleteManyArgs>(args?: SelectSubset<T, UserSessionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many UserSessions
     * const userSession = await prisma.userSession.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserSessionUpdateManyArgs>(args: SelectSubset<T, UserSessionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserSessions and returns the data updated in the database.
     * @param {UserSessionUpdateManyAndReturnArgs} args - Arguments to update many UserSessions.
     * @example
     * // Update many UserSessions
     * const userSession = await prisma.userSession.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more UserSessions and only return the `userSessionId`
     * const userSessionWithUserSessionIdOnly = await prisma.userSession.updateManyAndReturn({
     *   select: { userSessionId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends UserSessionUpdateManyAndReturnArgs>(args: SelectSubset<T, UserSessionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one UserSession.
     * @param {UserSessionUpsertArgs} args - Arguments to update or create a UserSession.
     * @example
     * // Update or create a UserSession
     * const userSession = await prisma.userSession.upsert({
     *   create: {
     *     // ... data to create a UserSession
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the UserSession we want to update
     *   }
     * })
     */
    upsert<T extends UserSessionUpsertArgs>(args: SelectSubset<T, UserSessionUpsertArgs<ExtArgs>>): Prisma__UserSessionClient<$Result.GetResult<Prisma.$UserSessionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of UserSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionCountArgs} args - Arguments to filter UserSessions to count.
     * @example
     * // Count the number of UserSessions
     * const count = await prisma.userSession.count({
     *   where: {
     *     // ... the filter for the UserSessions we want to count
     *   }
     * })
    **/
    count<T extends UserSessionCountArgs>(
      args?: Subset<T, UserSessionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserSessionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a UserSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserSessionAggregateArgs>(args: Subset<T, UserSessionAggregateArgs>): Prisma.PrismaPromise<GetUserSessionAggregateType<T>>

    /**
     * Group by UserSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSessionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserSessionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserSessionGroupByArgs['orderBy'] }
        : { orderBy?: UserSessionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserSessionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserSessionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the UserSession model
   */
  readonly fields: UserSessionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for UserSession.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserSessionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the UserSession model
   */
  interface UserSessionFieldRefs {
    readonly userSessionId: FieldRef<"UserSession", 'String'>
    readonly userId: FieldRef<"UserSession", 'String'>
    readonly accessToken: FieldRef<"UserSession", 'String'>
    readonly refreshToken: FieldRef<"UserSession", 'String'>
    readonly sessionExpiry: FieldRef<"UserSession", 'DateTime'>
    readonly otpVerifyNeeded: FieldRef<"UserSession", 'Boolean'>
    readonly otpVerifiedAt: FieldRef<"UserSession", 'DateTime'>
    readonly ip: FieldRef<"UserSession", 'String'>
    readonly os: FieldRef<"UserSession", 'String'>
    readonly device: FieldRef<"UserSession", 'String'>
    readonly browser: FieldRef<"UserSession", 'String'>
    readonly city: FieldRef<"UserSession", 'String'>
    readonly state: FieldRef<"UserSession", 'String'>
    readonly country: FieldRef<"UserSession", 'String'>
    readonly deviceFingerprint: FieldRef<"UserSession", 'String'>
    readonly createdAt: FieldRef<"UserSession", 'DateTime'>
    readonly updatedAt: FieldRef<"UserSession", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * UserSession findUnique
   */
  export type UserSessionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter, which UserSession to fetch.
     */
    where: UserSessionWhereUniqueInput
  }

  /**
   * UserSession findUniqueOrThrow
   */
  export type UserSessionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter, which UserSession to fetch.
     */
    where: UserSessionWhereUniqueInput
  }

  /**
   * UserSession findFirst
   */
  export type UserSessionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter, which UserSession to fetch.
     */
    where?: UserSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSessions to fetch.
     */
    orderBy?: UserSessionOrderByWithRelationInput | UserSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserSessions.
     */
    cursor?: UserSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserSessions.
     */
    distinct?: UserSessionScalarFieldEnum | UserSessionScalarFieldEnum[]
  }

  /**
   * UserSession findFirstOrThrow
   */
  export type UserSessionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter, which UserSession to fetch.
     */
    where?: UserSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSessions to fetch.
     */
    orderBy?: UserSessionOrderByWithRelationInput | UserSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserSessions.
     */
    cursor?: UserSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserSessions.
     */
    distinct?: UserSessionScalarFieldEnum | UserSessionScalarFieldEnum[]
  }

  /**
   * UserSession findMany
   */
  export type UserSessionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter, which UserSessions to fetch.
     */
    where?: UserSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSessions to fetch.
     */
    orderBy?: UserSessionOrderByWithRelationInput | UserSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing UserSessions.
     */
    cursor?: UserSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSessions.
     */
    skip?: number
    distinct?: UserSessionScalarFieldEnum | UserSessionScalarFieldEnum[]
  }

  /**
   * UserSession create
   */
  export type UserSessionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * The data needed to create a UserSession.
     */
    data: XOR<UserSessionCreateInput, UserSessionUncheckedCreateInput>
  }

  /**
   * UserSession createMany
   */
  export type UserSessionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many UserSessions.
     */
    data: UserSessionCreateManyInput | UserSessionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserSession createManyAndReturn
   */
  export type UserSessionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * The data used to create many UserSessions.
     */
    data: UserSessionCreateManyInput | UserSessionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * UserSession update
   */
  export type UserSessionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * The data needed to update a UserSession.
     */
    data: XOR<UserSessionUpdateInput, UserSessionUncheckedUpdateInput>
    /**
     * Choose, which UserSession to update.
     */
    where: UserSessionWhereUniqueInput
  }

  /**
   * UserSession updateMany
   */
  export type UserSessionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update UserSessions.
     */
    data: XOR<UserSessionUpdateManyMutationInput, UserSessionUncheckedUpdateManyInput>
    /**
     * Filter which UserSessions to update
     */
    where?: UserSessionWhereInput
    /**
     * Limit how many UserSessions to update.
     */
    limit?: number
  }

  /**
   * UserSession updateManyAndReturn
   */
  export type UserSessionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * The data used to update UserSessions.
     */
    data: XOR<UserSessionUpdateManyMutationInput, UserSessionUncheckedUpdateManyInput>
    /**
     * Filter which UserSessions to update
     */
    where?: UserSessionWhereInput
    /**
     * Limit how many UserSessions to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * UserSession upsert
   */
  export type UserSessionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * The filter to search for the UserSession to update in case it exists.
     */
    where: UserSessionWhereUniqueInput
    /**
     * In case the UserSession found by the `where` argument doesn't exist, create a new UserSession with this data.
     */
    create: XOR<UserSessionCreateInput, UserSessionUncheckedCreateInput>
    /**
     * In case the UserSession was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserSessionUpdateInput, UserSessionUncheckedUpdateInput>
  }

  /**
   * UserSession delete
   */
  export type UserSessionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
    /**
     * Filter which UserSession to delete.
     */
    where: UserSessionWhereUniqueInput
  }

  /**
   * UserSession deleteMany
   */
  export type UserSessionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserSessions to delete
     */
    where?: UserSessionWhereInput
    /**
     * Limit how many UserSessions to delete.
     */
    limit?: number
  }

  /**
   * UserSession without action
   */
  export type UserSessionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSession
     */
    select?: UserSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSession
     */
    omit?: UserSessionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSessionInclude<ExtArgs> | null
  }


  /**
   * Model UserSocialAccount
   */

  export type AggregateUserSocialAccount = {
    _count: UserSocialAccountCountAggregateOutputType | null
    _min: UserSocialAccountMinAggregateOutputType | null
    _max: UserSocialAccountMaxAggregateOutputType | null
  }

  export type UserSocialAccountMinAggregateOutputType = {
    userSocialAccountId: string | null
    userId: string | null
    provider: string | null
    providerId: string | null
    accessToken: string | null
    refreshToken: string | null
    tokenExpiry: Date | null
    profilePicture: string | null
    profileUrl: string | null
    scopes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserSocialAccountMaxAggregateOutputType = {
    userSocialAccountId: string | null
    userId: string | null
    provider: string | null
    providerId: string | null
    accessToken: string | null
    refreshToken: string | null
    tokenExpiry: Date | null
    profilePicture: string | null
    profileUrl: string | null
    scopes: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserSocialAccountCountAggregateOutputType = {
    userSocialAccountId: number
    userId: number
    provider: number
    providerId: number
    accessToken: number
    refreshToken: number
    tokenExpiry: number
    profilePicture: number
    profileUrl: number
    scopes: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserSocialAccountMinAggregateInputType = {
    userSocialAccountId?: true
    userId?: true
    provider?: true
    providerId?: true
    accessToken?: true
    refreshToken?: true
    tokenExpiry?: true
    profilePicture?: true
    profileUrl?: true
    scopes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserSocialAccountMaxAggregateInputType = {
    userSocialAccountId?: true
    userId?: true
    provider?: true
    providerId?: true
    accessToken?: true
    refreshToken?: true
    tokenExpiry?: true
    profilePicture?: true
    profileUrl?: true
    scopes?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserSocialAccountCountAggregateInputType = {
    userSocialAccountId?: true
    userId?: true
    provider?: true
    providerId?: true
    accessToken?: true
    refreshToken?: true
    tokenExpiry?: true
    profilePicture?: true
    profileUrl?: true
    scopes?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserSocialAccountAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserSocialAccount to aggregate.
     */
    where?: UserSocialAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSocialAccounts to fetch.
     */
    orderBy?: UserSocialAccountOrderByWithRelationInput | UserSocialAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserSocialAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSocialAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSocialAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned UserSocialAccounts
    **/
    _count?: true | UserSocialAccountCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserSocialAccountMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserSocialAccountMaxAggregateInputType
  }

  export type GetUserSocialAccountAggregateType<T extends UserSocialAccountAggregateArgs> = {
        [P in keyof T & keyof AggregateUserSocialAccount]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUserSocialAccount[P]>
      : GetScalarType<T[P], AggregateUserSocialAccount[P]>
  }




  export type UserSocialAccountGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserSocialAccountWhereInput
    orderBy?: UserSocialAccountOrderByWithAggregationInput | UserSocialAccountOrderByWithAggregationInput[]
    by: UserSocialAccountScalarFieldEnum[] | UserSocialAccountScalarFieldEnum
    having?: UserSocialAccountScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserSocialAccountCountAggregateInputType | true
    _min?: UserSocialAccountMinAggregateInputType
    _max?: UserSocialAccountMaxAggregateInputType
  }

  export type UserSocialAccountGroupByOutputType = {
    userSocialAccountId: string
    userId: string
    provider: string
    providerId: string
    accessToken: string | null
    refreshToken: string | null
    tokenExpiry: Date | null
    profilePicture: string | null
    profileUrl: string | null
    scopes: string | null
    createdAt: Date
    updatedAt: Date
    _count: UserSocialAccountCountAggregateOutputType | null
    _min: UserSocialAccountMinAggregateOutputType | null
    _max: UserSocialAccountMaxAggregateOutputType | null
  }

  type GetUserSocialAccountGroupByPayload<T extends UserSocialAccountGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserSocialAccountGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserSocialAccountGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserSocialAccountGroupByOutputType[P]>
            : GetScalarType<T[P], UserSocialAccountGroupByOutputType[P]>
        }
      >
    >


  export type UserSocialAccountSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSocialAccountId?: boolean
    userId?: boolean
    provider?: boolean
    providerId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    tokenExpiry?: boolean
    profilePicture?: boolean
    profileUrl?: boolean
    scopes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSocialAccount"]>

  export type UserSocialAccountSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSocialAccountId?: boolean
    userId?: boolean
    provider?: boolean
    providerId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    tokenExpiry?: boolean
    profilePicture?: boolean
    profileUrl?: boolean
    scopes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSocialAccount"]>

  export type UserSocialAccountSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userSocialAccountId?: boolean
    userId?: boolean
    provider?: boolean
    providerId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    tokenExpiry?: boolean
    profilePicture?: boolean
    profileUrl?: boolean
    scopes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["userSocialAccount"]>

  export type UserSocialAccountSelectScalar = {
    userSocialAccountId?: boolean
    userId?: boolean
    provider?: boolean
    providerId?: boolean
    accessToken?: boolean
    refreshToken?: boolean
    tokenExpiry?: boolean
    profilePicture?: boolean
    profileUrl?: boolean
    scopes?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserSocialAccountOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"userSocialAccountId" | "userId" | "provider" | "providerId" | "accessToken" | "refreshToken" | "tokenExpiry" | "profilePicture" | "profileUrl" | "scopes" | "createdAt" | "updatedAt", ExtArgs["result"]["userSocialAccount"]>
  export type UserSocialAccountInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type UserSocialAccountIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type UserSocialAccountIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }

  export type $UserSocialAccountPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "UserSocialAccount"
    objects: {
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      userSocialAccountId: string
      userId: string
      provider: string
      providerId: string
      accessToken: string | null
      refreshToken: string | null
      tokenExpiry: Date | null
      profilePicture: string | null
      profileUrl: string | null
      scopes: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["userSocialAccount"]>
    composites: {}
  }

  type UserSocialAccountGetPayload<S extends boolean | null | undefined | UserSocialAccountDefaultArgs> = $Result.GetResult<Prisma.$UserSocialAccountPayload, S>

  type UserSocialAccountCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<UserSocialAccountFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: UserSocialAccountCountAggregateInputType | true
    }

  export interface UserSocialAccountDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['UserSocialAccount'], meta: { name: 'UserSocialAccount' } }
    /**
     * Find zero or one UserSocialAccount that matches the filter.
     * @param {UserSocialAccountFindUniqueArgs} args - Arguments to find a UserSocialAccount
     * @example
     * // Get one UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserSocialAccountFindUniqueArgs>(args: SelectSubset<T, UserSocialAccountFindUniqueArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one UserSocialAccount that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {UserSocialAccountFindUniqueOrThrowArgs} args - Arguments to find a UserSocialAccount
     * @example
     * // Get one UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserSocialAccountFindUniqueOrThrowArgs>(args: SelectSubset<T, UserSocialAccountFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first UserSocialAccount that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountFindFirstArgs} args - Arguments to find a UserSocialAccount
     * @example
     * // Get one UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserSocialAccountFindFirstArgs>(args?: SelectSubset<T, UserSocialAccountFindFirstArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first UserSocialAccount that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountFindFirstOrThrowArgs} args - Arguments to find a UserSocialAccount
     * @example
     * // Get one UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserSocialAccountFindFirstOrThrowArgs>(args?: SelectSubset<T, UserSocialAccountFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more UserSocialAccounts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all UserSocialAccounts
     * const userSocialAccounts = await prisma.userSocialAccount.findMany()
     * 
     * // Get first 10 UserSocialAccounts
     * const userSocialAccounts = await prisma.userSocialAccount.findMany({ take: 10 })
     * 
     * // Only select the `userSocialAccountId`
     * const userSocialAccountWithUserSocialAccountIdOnly = await prisma.userSocialAccount.findMany({ select: { userSocialAccountId: true } })
     * 
     */
    findMany<T extends UserSocialAccountFindManyArgs>(args?: SelectSubset<T, UserSocialAccountFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a UserSocialAccount.
     * @param {UserSocialAccountCreateArgs} args - Arguments to create a UserSocialAccount.
     * @example
     * // Create one UserSocialAccount
     * const UserSocialAccount = await prisma.userSocialAccount.create({
     *   data: {
     *     // ... data to create a UserSocialAccount
     *   }
     * })
     * 
     */
    create<T extends UserSocialAccountCreateArgs>(args: SelectSubset<T, UserSocialAccountCreateArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many UserSocialAccounts.
     * @param {UserSocialAccountCreateManyArgs} args - Arguments to create many UserSocialAccounts.
     * @example
     * // Create many UserSocialAccounts
     * const userSocialAccount = await prisma.userSocialAccount.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserSocialAccountCreateManyArgs>(args?: SelectSubset<T, UserSocialAccountCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many UserSocialAccounts and returns the data saved in the database.
     * @param {UserSocialAccountCreateManyAndReturnArgs} args - Arguments to create many UserSocialAccounts.
     * @example
     * // Create many UserSocialAccounts
     * const userSocialAccount = await prisma.userSocialAccount.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many UserSocialAccounts and only return the `userSocialAccountId`
     * const userSocialAccountWithUserSocialAccountIdOnly = await prisma.userSocialAccount.createManyAndReturn({
     *   select: { userSocialAccountId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserSocialAccountCreateManyAndReturnArgs>(args?: SelectSubset<T, UserSocialAccountCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a UserSocialAccount.
     * @param {UserSocialAccountDeleteArgs} args - Arguments to delete one UserSocialAccount.
     * @example
     * // Delete one UserSocialAccount
     * const UserSocialAccount = await prisma.userSocialAccount.delete({
     *   where: {
     *     // ... filter to delete one UserSocialAccount
     *   }
     * })
     * 
     */
    delete<T extends UserSocialAccountDeleteArgs>(args: SelectSubset<T, UserSocialAccountDeleteArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one UserSocialAccount.
     * @param {UserSocialAccountUpdateArgs} args - Arguments to update one UserSocialAccount.
     * @example
     * // Update one UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserSocialAccountUpdateArgs>(args: SelectSubset<T, UserSocialAccountUpdateArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more UserSocialAccounts.
     * @param {UserSocialAccountDeleteManyArgs} args - Arguments to filter UserSocialAccounts to delete.
     * @example
     * // Delete a few UserSocialAccounts
     * const { count } = await prisma.userSocialAccount.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserSocialAccountDeleteManyArgs>(args?: SelectSubset<T, UserSocialAccountDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserSocialAccounts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many UserSocialAccounts
     * const userSocialAccount = await prisma.userSocialAccount.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserSocialAccountUpdateManyArgs>(args: SelectSubset<T, UserSocialAccountUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more UserSocialAccounts and returns the data updated in the database.
     * @param {UserSocialAccountUpdateManyAndReturnArgs} args - Arguments to update many UserSocialAccounts.
     * @example
     * // Update many UserSocialAccounts
     * const userSocialAccount = await prisma.userSocialAccount.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more UserSocialAccounts and only return the `userSocialAccountId`
     * const userSocialAccountWithUserSocialAccountIdOnly = await prisma.userSocialAccount.updateManyAndReturn({
     *   select: { userSocialAccountId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends UserSocialAccountUpdateManyAndReturnArgs>(args: SelectSubset<T, UserSocialAccountUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one UserSocialAccount.
     * @param {UserSocialAccountUpsertArgs} args - Arguments to update or create a UserSocialAccount.
     * @example
     * // Update or create a UserSocialAccount
     * const userSocialAccount = await prisma.userSocialAccount.upsert({
     *   create: {
     *     // ... data to create a UserSocialAccount
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the UserSocialAccount we want to update
     *   }
     * })
     */
    upsert<T extends UserSocialAccountUpsertArgs>(args: SelectSubset<T, UserSocialAccountUpsertArgs<ExtArgs>>): Prisma__UserSocialAccountClient<$Result.GetResult<Prisma.$UserSocialAccountPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of UserSocialAccounts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountCountArgs} args - Arguments to filter UserSocialAccounts to count.
     * @example
     * // Count the number of UserSocialAccounts
     * const count = await prisma.userSocialAccount.count({
     *   where: {
     *     // ... the filter for the UserSocialAccounts we want to count
     *   }
     * })
    **/
    count<T extends UserSocialAccountCountArgs>(
      args?: Subset<T, UserSocialAccountCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserSocialAccountCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a UserSocialAccount.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserSocialAccountAggregateArgs>(args: Subset<T, UserSocialAccountAggregateArgs>): Prisma.PrismaPromise<GetUserSocialAccountAggregateType<T>>

    /**
     * Group by UserSocialAccount.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserSocialAccountGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserSocialAccountGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserSocialAccountGroupByArgs['orderBy'] }
        : { orderBy?: UserSocialAccountGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserSocialAccountGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserSocialAccountGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the UserSocialAccount model
   */
  readonly fields: UserSocialAccountFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for UserSocialAccount.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserSocialAccountClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the UserSocialAccount model
   */
  interface UserSocialAccountFieldRefs {
    readonly userSocialAccountId: FieldRef<"UserSocialAccount", 'String'>
    readonly userId: FieldRef<"UserSocialAccount", 'String'>
    readonly provider: FieldRef<"UserSocialAccount", 'String'>
    readonly providerId: FieldRef<"UserSocialAccount", 'String'>
    readonly accessToken: FieldRef<"UserSocialAccount", 'String'>
    readonly refreshToken: FieldRef<"UserSocialAccount", 'String'>
    readonly tokenExpiry: FieldRef<"UserSocialAccount", 'DateTime'>
    readonly profilePicture: FieldRef<"UserSocialAccount", 'String'>
    readonly profileUrl: FieldRef<"UserSocialAccount", 'String'>
    readonly scopes: FieldRef<"UserSocialAccount", 'String'>
    readonly createdAt: FieldRef<"UserSocialAccount", 'DateTime'>
    readonly updatedAt: FieldRef<"UserSocialAccount", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * UserSocialAccount findUnique
   */
  export type UserSocialAccountFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter, which UserSocialAccount to fetch.
     */
    where: UserSocialAccountWhereUniqueInput
  }

  /**
   * UserSocialAccount findUniqueOrThrow
   */
  export type UserSocialAccountFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter, which UserSocialAccount to fetch.
     */
    where: UserSocialAccountWhereUniqueInput
  }

  /**
   * UserSocialAccount findFirst
   */
  export type UserSocialAccountFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter, which UserSocialAccount to fetch.
     */
    where?: UserSocialAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSocialAccounts to fetch.
     */
    orderBy?: UserSocialAccountOrderByWithRelationInput | UserSocialAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserSocialAccounts.
     */
    cursor?: UserSocialAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSocialAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSocialAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserSocialAccounts.
     */
    distinct?: UserSocialAccountScalarFieldEnum | UserSocialAccountScalarFieldEnum[]
  }

  /**
   * UserSocialAccount findFirstOrThrow
   */
  export type UserSocialAccountFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter, which UserSocialAccount to fetch.
     */
    where?: UserSocialAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSocialAccounts to fetch.
     */
    orderBy?: UserSocialAccountOrderByWithRelationInput | UserSocialAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for UserSocialAccounts.
     */
    cursor?: UserSocialAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSocialAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSocialAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of UserSocialAccounts.
     */
    distinct?: UserSocialAccountScalarFieldEnum | UserSocialAccountScalarFieldEnum[]
  }

  /**
   * UserSocialAccount findMany
   */
  export type UserSocialAccountFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter, which UserSocialAccounts to fetch.
     */
    where?: UserSocialAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of UserSocialAccounts to fetch.
     */
    orderBy?: UserSocialAccountOrderByWithRelationInput | UserSocialAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing UserSocialAccounts.
     */
    cursor?: UserSocialAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` UserSocialAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` UserSocialAccounts.
     */
    skip?: number
    distinct?: UserSocialAccountScalarFieldEnum | UserSocialAccountScalarFieldEnum[]
  }

  /**
   * UserSocialAccount create
   */
  export type UserSocialAccountCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * The data needed to create a UserSocialAccount.
     */
    data: XOR<UserSocialAccountCreateInput, UserSocialAccountUncheckedCreateInput>
  }

  /**
   * UserSocialAccount createMany
   */
  export type UserSocialAccountCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many UserSocialAccounts.
     */
    data: UserSocialAccountCreateManyInput | UserSocialAccountCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * UserSocialAccount createManyAndReturn
   */
  export type UserSocialAccountCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * The data used to create many UserSocialAccounts.
     */
    data: UserSocialAccountCreateManyInput | UserSocialAccountCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * UserSocialAccount update
   */
  export type UserSocialAccountUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * The data needed to update a UserSocialAccount.
     */
    data: XOR<UserSocialAccountUpdateInput, UserSocialAccountUncheckedUpdateInput>
    /**
     * Choose, which UserSocialAccount to update.
     */
    where: UserSocialAccountWhereUniqueInput
  }

  /**
   * UserSocialAccount updateMany
   */
  export type UserSocialAccountUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update UserSocialAccounts.
     */
    data: XOR<UserSocialAccountUpdateManyMutationInput, UserSocialAccountUncheckedUpdateManyInput>
    /**
     * Filter which UserSocialAccounts to update
     */
    where?: UserSocialAccountWhereInput
    /**
     * Limit how many UserSocialAccounts to update.
     */
    limit?: number
  }

  /**
   * UserSocialAccount updateManyAndReturn
   */
  export type UserSocialAccountUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * The data used to update UserSocialAccounts.
     */
    data: XOR<UserSocialAccountUpdateManyMutationInput, UserSocialAccountUncheckedUpdateManyInput>
    /**
     * Filter which UserSocialAccounts to update
     */
    where?: UserSocialAccountWhereInput
    /**
     * Limit how many UserSocialAccounts to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * UserSocialAccount upsert
   */
  export type UserSocialAccountUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * The filter to search for the UserSocialAccount to update in case it exists.
     */
    where: UserSocialAccountWhereUniqueInput
    /**
     * In case the UserSocialAccount found by the `where` argument doesn't exist, create a new UserSocialAccount with this data.
     */
    create: XOR<UserSocialAccountCreateInput, UserSocialAccountUncheckedCreateInput>
    /**
     * In case the UserSocialAccount was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserSocialAccountUpdateInput, UserSocialAccountUncheckedUpdateInput>
  }

  /**
   * UserSocialAccount delete
   */
  export type UserSocialAccountDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
    /**
     * Filter which UserSocialAccount to delete.
     */
    where: UserSocialAccountWhereUniqueInput
  }

  /**
   * UserSocialAccount deleteMany
   */
  export type UserSocialAccountDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which UserSocialAccounts to delete
     */
    where?: UserSocialAccountWhereInput
    /**
     * Limit how many UserSocialAccounts to delete.
     */
    limit?: number
  }

  /**
   * UserSocialAccount without action
   */
  export type UserSocialAccountDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserSocialAccount
     */
    select?: UserSocialAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the UserSocialAccount
     */
    omit?: UserSocialAccountOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserSocialAccountInclude<ExtArgs> | null
  }


  /**
   * Model Tenant
   */

  export type AggregateTenant = {
    _count: TenantCountAggregateOutputType | null
    _min: TenantMinAggregateOutputType | null
    _max: TenantMaxAggregateOutputType | null
  }

  export type TenantMinAggregateOutputType = {
    tenantId: string | null
    name: string | null
    description: string | null
    tenantStatus: $Enums.TenantStatus | null
    domain: string | null
    region: string | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
  }

  export type TenantMaxAggregateOutputType = {
    tenantId: string | null
    name: string | null
    description: string | null
    tenantStatus: $Enums.TenantStatus | null
    domain: string | null
    region: string | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
  }

  export type TenantCountAggregateOutputType = {
    tenantId: number
    name: number
    description: number
    tenantStatus: number
    domain: number
    region: number
    createdAt: number
    updatedAt: number
    deletedAt: number
    _all: number
  }


  export type TenantMinAggregateInputType = {
    tenantId?: true
    name?: true
    description?: true
    tenantStatus?: true
    domain?: true
    region?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
  }

  export type TenantMaxAggregateInputType = {
    tenantId?: true
    name?: true
    description?: true
    tenantStatus?: true
    domain?: true
    region?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
  }

  export type TenantCountAggregateInputType = {
    tenantId?: true
    name?: true
    description?: true
    tenantStatus?: true
    domain?: true
    region?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
    _all?: true
  }

  export type TenantAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tenant to aggregate.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Tenants
    **/
    _count?: true | TenantCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TenantMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TenantMaxAggregateInputType
  }

  export type GetTenantAggregateType<T extends TenantAggregateArgs> = {
        [P in keyof T & keyof AggregateTenant]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTenant[P]>
      : GetScalarType<T[P], AggregateTenant[P]>
  }




  export type TenantGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TenantWhereInput
    orderBy?: TenantOrderByWithAggregationInput | TenantOrderByWithAggregationInput[]
    by: TenantScalarFieldEnum[] | TenantScalarFieldEnum
    having?: TenantScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TenantCountAggregateInputType | true
    _min?: TenantMinAggregateInputType
    _max?: TenantMaxAggregateInputType
  }

  export type TenantGroupByOutputType = {
    tenantId: string
    name: string
    description: string | null
    tenantStatus: $Enums.TenantStatus
    domain: string
    region: string
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    _count: TenantCountAggregateOutputType | null
    _min: TenantMinAggregateOutputType | null
    _max: TenantMaxAggregateOutputType | null
  }

  type GetTenantGroupByPayload<T extends TenantGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TenantGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TenantGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TenantGroupByOutputType[P]>
            : GetScalarType<T[P], TenantGroupByOutputType[P]>
        }
      >
    >


  export type TenantSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantId?: boolean
    name?: boolean
    description?: boolean
    tenantStatus?: boolean
    domain?: boolean
    region?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    tenantUsers?: boolean | Tenant$tenantUsersArgs<ExtArgs>
    subscriptions?: boolean | Tenant$subscriptionsArgs<ExtArgs>
    _count?: boolean | TenantCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tenant"]>

  export type TenantSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantId?: boolean
    name?: boolean
    description?: boolean
    tenantStatus?: boolean
    domain?: boolean
    region?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
  }, ExtArgs["result"]["tenant"]>

  export type TenantSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantId?: boolean
    name?: boolean
    description?: boolean
    tenantStatus?: boolean
    domain?: boolean
    region?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
  }, ExtArgs["result"]["tenant"]>

  export type TenantSelectScalar = {
    tenantId?: boolean
    name?: boolean
    description?: boolean
    tenantStatus?: boolean
    domain?: boolean
    region?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
  }

  export type TenantOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"tenantId" | "name" | "description" | "tenantStatus" | "domain" | "region" | "createdAt" | "updatedAt" | "deletedAt", ExtArgs["result"]["tenant"]>
  export type TenantInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenantUsers?: boolean | Tenant$tenantUsersArgs<ExtArgs>
    subscriptions?: boolean | Tenant$subscriptionsArgs<ExtArgs>
    _count?: boolean | TenantCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TenantIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type TenantIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $TenantPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Tenant"
    objects: {
      tenantUsers: Prisma.$TenantUserPayload<ExtArgs>[]
      subscriptions: Prisma.$SubscriptionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      tenantId: string
      name: string
      description: string | null
      tenantStatus: $Enums.TenantStatus
      domain: string
      region: string
      createdAt: Date
      updatedAt: Date
      deletedAt: Date | null
    }, ExtArgs["result"]["tenant"]>
    composites: {}
  }

  type TenantGetPayload<S extends boolean | null | undefined | TenantDefaultArgs> = $Result.GetResult<Prisma.$TenantPayload, S>

  type TenantCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<TenantFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: TenantCountAggregateInputType | true
    }

  export interface TenantDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Tenant'], meta: { name: 'Tenant' } }
    /**
     * Find zero or one Tenant that matches the filter.
     * @param {TenantFindUniqueArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TenantFindUniqueArgs>(args: SelectSubset<T, TenantFindUniqueArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Tenant that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {TenantFindUniqueOrThrowArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TenantFindUniqueOrThrowArgs>(args: SelectSubset<T, TenantFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Tenant that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindFirstArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TenantFindFirstArgs>(args?: SelectSubset<T, TenantFindFirstArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Tenant that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindFirstOrThrowArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TenantFindFirstOrThrowArgs>(args?: SelectSubset<T, TenantFindFirstOrThrowArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Tenants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Tenants
     * const tenants = await prisma.tenant.findMany()
     * 
     * // Get first 10 Tenants
     * const tenants = await prisma.tenant.findMany({ take: 10 })
     * 
     * // Only select the `tenantId`
     * const tenantWithTenantIdOnly = await prisma.tenant.findMany({ select: { tenantId: true } })
     * 
     */
    findMany<T extends TenantFindManyArgs>(args?: SelectSubset<T, TenantFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Tenant.
     * @param {TenantCreateArgs} args - Arguments to create a Tenant.
     * @example
     * // Create one Tenant
     * const Tenant = await prisma.tenant.create({
     *   data: {
     *     // ... data to create a Tenant
     *   }
     * })
     * 
     */
    create<T extends TenantCreateArgs>(args: SelectSubset<T, TenantCreateArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Tenants.
     * @param {TenantCreateManyArgs} args - Arguments to create many Tenants.
     * @example
     * // Create many Tenants
     * const tenant = await prisma.tenant.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TenantCreateManyArgs>(args?: SelectSubset<T, TenantCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Tenants and returns the data saved in the database.
     * @param {TenantCreateManyAndReturnArgs} args - Arguments to create many Tenants.
     * @example
     * // Create many Tenants
     * const tenant = await prisma.tenant.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Tenants and only return the `tenantId`
     * const tenantWithTenantIdOnly = await prisma.tenant.createManyAndReturn({
     *   select: { tenantId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TenantCreateManyAndReturnArgs>(args?: SelectSubset<T, TenantCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Tenant.
     * @param {TenantDeleteArgs} args - Arguments to delete one Tenant.
     * @example
     * // Delete one Tenant
     * const Tenant = await prisma.tenant.delete({
     *   where: {
     *     // ... filter to delete one Tenant
     *   }
     * })
     * 
     */
    delete<T extends TenantDeleteArgs>(args: SelectSubset<T, TenantDeleteArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Tenant.
     * @param {TenantUpdateArgs} args - Arguments to update one Tenant.
     * @example
     * // Update one Tenant
     * const tenant = await prisma.tenant.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TenantUpdateArgs>(args: SelectSubset<T, TenantUpdateArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Tenants.
     * @param {TenantDeleteManyArgs} args - Arguments to filter Tenants to delete.
     * @example
     * // Delete a few Tenants
     * const { count } = await prisma.tenant.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TenantDeleteManyArgs>(args?: SelectSubset<T, TenantDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Tenants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Tenants
     * const tenant = await prisma.tenant.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TenantUpdateManyArgs>(args: SelectSubset<T, TenantUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Tenants and returns the data updated in the database.
     * @param {TenantUpdateManyAndReturnArgs} args - Arguments to update many Tenants.
     * @example
     * // Update many Tenants
     * const tenant = await prisma.tenant.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Tenants and only return the `tenantId`
     * const tenantWithTenantIdOnly = await prisma.tenant.updateManyAndReturn({
     *   select: { tenantId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends TenantUpdateManyAndReturnArgs>(args: SelectSubset<T, TenantUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Tenant.
     * @param {TenantUpsertArgs} args - Arguments to update or create a Tenant.
     * @example
     * // Update or create a Tenant
     * const tenant = await prisma.tenant.upsert({
     *   create: {
     *     // ... data to create a Tenant
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Tenant we want to update
     *   }
     * })
     */
    upsert<T extends TenantUpsertArgs>(args: SelectSubset<T, TenantUpsertArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Tenants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantCountArgs} args - Arguments to filter Tenants to count.
     * @example
     * // Count the number of Tenants
     * const count = await prisma.tenant.count({
     *   where: {
     *     // ... the filter for the Tenants we want to count
     *   }
     * })
    **/
    count<T extends TenantCountArgs>(
      args?: Subset<T, TenantCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TenantCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Tenant.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TenantAggregateArgs>(args: Subset<T, TenantAggregateArgs>): Prisma.PrismaPromise<GetTenantAggregateType<T>>

    /**
     * Group by Tenant.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TenantGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TenantGroupByArgs['orderBy'] }
        : { orderBy?: TenantGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TenantGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTenantGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Tenant model
   */
  readonly fields: TenantFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Tenant.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TenantClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenantUsers<T extends Tenant$tenantUsersArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$tenantUsersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    subscriptions<T extends Tenant$subscriptionsArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$subscriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Tenant model
   */
  interface TenantFieldRefs {
    readonly tenantId: FieldRef<"Tenant", 'String'>
    readonly name: FieldRef<"Tenant", 'String'>
    readonly description: FieldRef<"Tenant", 'String'>
    readonly tenantStatus: FieldRef<"Tenant", 'TenantStatus'>
    readonly domain: FieldRef<"Tenant", 'String'>
    readonly region: FieldRef<"Tenant", 'String'>
    readonly createdAt: FieldRef<"Tenant", 'DateTime'>
    readonly updatedAt: FieldRef<"Tenant", 'DateTime'>
    readonly deletedAt: FieldRef<"Tenant", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Tenant findUnique
   */
  export type TenantFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant findUniqueOrThrow
   */
  export type TenantFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant findFirst
   */
  export type TenantFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tenants.
     */
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant findFirstOrThrow
   */
  export type TenantFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tenants.
     */
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant findMany
   */
  export type TenantFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenants to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant create
   */
  export type TenantCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The data needed to create a Tenant.
     */
    data: XOR<TenantCreateInput, TenantUncheckedCreateInput>
  }

  /**
   * Tenant createMany
   */
  export type TenantCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Tenants.
     */
    data: TenantCreateManyInput | TenantCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tenant createManyAndReturn
   */
  export type TenantCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * The data used to create many Tenants.
     */
    data: TenantCreateManyInput | TenantCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tenant update
   */
  export type TenantUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The data needed to update a Tenant.
     */
    data: XOR<TenantUpdateInput, TenantUncheckedUpdateInput>
    /**
     * Choose, which Tenant to update.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant updateMany
   */
  export type TenantUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Tenants.
     */
    data: XOR<TenantUpdateManyMutationInput, TenantUncheckedUpdateManyInput>
    /**
     * Filter which Tenants to update
     */
    where?: TenantWhereInput
    /**
     * Limit how many Tenants to update.
     */
    limit?: number
  }

  /**
   * Tenant updateManyAndReturn
   */
  export type TenantUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * The data used to update Tenants.
     */
    data: XOR<TenantUpdateManyMutationInput, TenantUncheckedUpdateManyInput>
    /**
     * Filter which Tenants to update
     */
    where?: TenantWhereInput
    /**
     * Limit how many Tenants to update.
     */
    limit?: number
  }

  /**
   * Tenant upsert
   */
  export type TenantUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The filter to search for the Tenant to update in case it exists.
     */
    where: TenantWhereUniqueInput
    /**
     * In case the Tenant found by the `where` argument doesn't exist, create a new Tenant with this data.
     */
    create: XOR<TenantCreateInput, TenantUncheckedCreateInput>
    /**
     * In case the Tenant was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TenantUpdateInput, TenantUncheckedUpdateInput>
  }

  /**
   * Tenant delete
   */
  export type TenantDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter which Tenant to delete.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant deleteMany
   */
  export type TenantDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tenants to delete
     */
    where?: TenantWhereInput
    /**
     * Limit how many Tenants to delete.
     */
    limit?: number
  }

  /**
   * Tenant.tenantUsers
   */
  export type Tenant$tenantUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    where?: TenantUserWhereInput
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    cursor?: TenantUserWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TenantUserScalarFieldEnum | TenantUserScalarFieldEnum[]
  }

  /**
   * Tenant.subscriptions
   */
  export type Tenant$subscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Tenant without action
   */
  export type TenantDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Tenant
     */
    omit?: TenantOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
  }


  /**
   * Model TenantUser
   */

  export type AggregateTenantUser = {
    _count: TenantUserCountAggregateOutputType | null
    _min: TenantUserMinAggregateOutputType | null
    _max: TenantUserMaxAggregateOutputType | null
  }

  export type TenantUserMinAggregateOutputType = {
    tenantUserId: string | null
    tenantId: string | null
    userId: string | null
    tenantUserRole: $Enums.TenantUserRole | null
    tenantUserStatus: $Enums.TenantUserStatus | null
    userSessionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
  }

  export type TenantUserMaxAggregateOutputType = {
    tenantUserId: string | null
    tenantId: string | null
    userId: string | null
    tenantUserRole: $Enums.TenantUserRole | null
    tenantUserStatus: $Enums.TenantUserStatus | null
    userSessionId: string | null
    createdAt: Date | null
    updatedAt: Date | null
    deletedAt: Date | null
  }

  export type TenantUserCountAggregateOutputType = {
    tenantUserId: number
    tenantId: number
    userId: number
    tenantUserRole: number
    tenantUserStatus: number
    userSessionId: number
    createdAt: number
    updatedAt: number
    deletedAt: number
    _all: number
  }


  export type TenantUserMinAggregateInputType = {
    tenantUserId?: true
    tenantId?: true
    userId?: true
    tenantUserRole?: true
    tenantUserStatus?: true
    userSessionId?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
  }

  export type TenantUserMaxAggregateInputType = {
    tenantUserId?: true
    tenantId?: true
    userId?: true
    tenantUserRole?: true
    tenantUserStatus?: true
    userSessionId?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
  }

  export type TenantUserCountAggregateInputType = {
    tenantUserId?: true
    tenantId?: true
    userId?: true
    tenantUserRole?: true
    tenantUserStatus?: true
    userSessionId?: true
    createdAt?: true
    updatedAt?: true
    deletedAt?: true
    _all?: true
  }

  export type TenantUserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TenantUser to aggregate.
     */
    where?: TenantUserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TenantUsers to fetch.
     */
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TenantUserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TenantUsers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TenantUsers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TenantUsers
    **/
    _count?: true | TenantUserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TenantUserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TenantUserMaxAggregateInputType
  }

  export type GetTenantUserAggregateType<T extends TenantUserAggregateArgs> = {
        [P in keyof T & keyof AggregateTenantUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTenantUser[P]>
      : GetScalarType<T[P], AggregateTenantUser[P]>
  }




  export type TenantUserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TenantUserWhereInput
    orderBy?: TenantUserOrderByWithAggregationInput | TenantUserOrderByWithAggregationInput[]
    by: TenantUserScalarFieldEnum[] | TenantUserScalarFieldEnum
    having?: TenantUserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TenantUserCountAggregateInputType | true
    _min?: TenantUserMinAggregateInputType
    _max?: TenantUserMaxAggregateInputType
  }

  export type TenantUserGroupByOutputType = {
    tenantUserId: string
    tenantId: string
    userId: string
    tenantUserRole: $Enums.TenantUserRole
    tenantUserStatus: $Enums.TenantUserStatus
    userSessionId: string | null
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
    _count: TenantUserCountAggregateOutputType | null
    _min: TenantUserMinAggregateOutputType | null
    _max: TenantUserMaxAggregateOutputType | null
  }

  type GetTenantUserGroupByPayload<T extends TenantUserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TenantUserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TenantUserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TenantUserGroupByOutputType[P]>
            : GetScalarType<T[P], TenantUserGroupByOutputType[P]>
        }
      >
    >


  export type TenantUserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantUserId?: boolean
    tenantId?: boolean
    userId?: boolean
    tenantUserRole?: boolean
    tenantUserStatus?: boolean
    userSessionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tenantUser"]>

  export type TenantUserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantUserId?: boolean
    tenantId?: boolean
    userId?: boolean
    tenantUserRole?: boolean
    tenantUserStatus?: boolean
    userSessionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tenantUser"]>

  export type TenantUserSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantUserId?: boolean
    tenantId?: boolean
    userId?: boolean
    tenantUserRole?: boolean
    tenantUserStatus?: boolean
    userSessionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tenantUser"]>

  export type TenantUserSelectScalar = {
    tenantUserId?: boolean
    tenantId?: boolean
    userId?: boolean
    tenantUserRole?: boolean
    tenantUserStatus?: boolean
    userSessionId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    deletedAt?: boolean
  }

  export type TenantUserOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"tenantUserId" | "tenantId" | "userId" | "tenantUserRole" | "tenantUserStatus" | "userSessionId" | "createdAt" | "updatedAt" | "deletedAt", ExtArgs["result"]["tenantUser"]>
  export type TenantUserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type TenantUserIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type TenantUserIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }

  export type $TenantUserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TenantUser"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      tenantUserId: string
      tenantId: string
      userId: string
      tenantUserRole: $Enums.TenantUserRole
      tenantUserStatus: $Enums.TenantUserStatus
      userSessionId: string | null
      createdAt: Date
      updatedAt: Date
      deletedAt: Date | null
    }, ExtArgs["result"]["tenantUser"]>
    composites: {}
  }

  type TenantUserGetPayload<S extends boolean | null | undefined | TenantUserDefaultArgs> = $Result.GetResult<Prisma.$TenantUserPayload, S>

  type TenantUserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<TenantUserFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: TenantUserCountAggregateInputType | true
    }

  export interface TenantUserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TenantUser'], meta: { name: 'TenantUser' } }
    /**
     * Find zero or one TenantUser that matches the filter.
     * @param {TenantUserFindUniqueArgs} args - Arguments to find a TenantUser
     * @example
     * // Get one TenantUser
     * const tenantUser = await prisma.tenantUser.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TenantUserFindUniqueArgs>(args: SelectSubset<T, TenantUserFindUniqueArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one TenantUser that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {TenantUserFindUniqueOrThrowArgs} args - Arguments to find a TenantUser
     * @example
     * // Get one TenantUser
     * const tenantUser = await prisma.tenantUser.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TenantUserFindUniqueOrThrowArgs>(args: SelectSubset<T, TenantUserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first TenantUser that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserFindFirstArgs} args - Arguments to find a TenantUser
     * @example
     * // Get one TenantUser
     * const tenantUser = await prisma.tenantUser.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TenantUserFindFirstArgs>(args?: SelectSubset<T, TenantUserFindFirstArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first TenantUser that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserFindFirstOrThrowArgs} args - Arguments to find a TenantUser
     * @example
     * // Get one TenantUser
     * const tenantUser = await prisma.tenantUser.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TenantUserFindFirstOrThrowArgs>(args?: SelectSubset<T, TenantUserFindFirstOrThrowArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more TenantUsers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TenantUsers
     * const tenantUsers = await prisma.tenantUser.findMany()
     * 
     * // Get first 10 TenantUsers
     * const tenantUsers = await prisma.tenantUser.findMany({ take: 10 })
     * 
     * // Only select the `tenantUserId`
     * const tenantUserWithTenantUserIdOnly = await prisma.tenantUser.findMany({ select: { tenantUserId: true } })
     * 
     */
    findMany<T extends TenantUserFindManyArgs>(args?: SelectSubset<T, TenantUserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a TenantUser.
     * @param {TenantUserCreateArgs} args - Arguments to create a TenantUser.
     * @example
     * // Create one TenantUser
     * const TenantUser = await prisma.tenantUser.create({
     *   data: {
     *     // ... data to create a TenantUser
     *   }
     * })
     * 
     */
    create<T extends TenantUserCreateArgs>(args: SelectSubset<T, TenantUserCreateArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many TenantUsers.
     * @param {TenantUserCreateManyArgs} args - Arguments to create many TenantUsers.
     * @example
     * // Create many TenantUsers
     * const tenantUser = await prisma.tenantUser.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TenantUserCreateManyArgs>(args?: SelectSubset<T, TenantUserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TenantUsers and returns the data saved in the database.
     * @param {TenantUserCreateManyAndReturnArgs} args - Arguments to create many TenantUsers.
     * @example
     * // Create many TenantUsers
     * const tenantUser = await prisma.tenantUser.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TenantUsers and only return the `tenantUserId`
     * const tenantUserWithTenantUserIdOnly = await prisma.tenantUser.createManyAndReturn({
     *   select: { tenantUserId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TenantUserCreateManyAndReturnArgs>(args?: SelectSubset<T, TenantUserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a TenantUser.
     * @param {TenantUserDeleteArgs} args - Arguments to delete one TenantUser.
     * @example
     * // Delete one TenantUser
     * const TenantUser = await prisma.tenantUser.delete({
     *   where: {
     *     // ... filter to delete one TenantUser
     *   }
     * })
     * 
     */
    delete<T extends TenantUserDeleteArgs>(args: SelectSubset<T, TenantUserDeleteArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one TenantUser.
     * @param {TenantUserUpdateArgs} args - Arguments to update one TenantUser.
     * @example
     * // Update one TenantUser
     * const tenantUser = await prisma.tenantUser.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TenantUserUpdateArgs>(args: SelectSubset<T, TenantUserUpdateArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more TenantUsers.
     * @param {TenantUserDeleteManyArgs} args - Arguments to filter TenantUsers to delete.
     * @example
     * // Delete a few TenantUsers
     * const { count } = await prisma.tenantUser.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TenantUserDeleteManyArgs>(args?: SelectSubset<T, TenantUserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TenantUsers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TenantUsers
     * const tenantUser = await prisma.tenantUser.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TenantUserUpdateManyArgs>(args: SelectSubset<T, TenantUserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TenantUsers and returns the data updated in the database.
     * @param {TenantUserUpdateManyAndReturnArgs} args - Arguments to update many TenantUsers.
     * @example
     * // Update many TenantUsers
     * const tenantUser = await prisma.tenantUser.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more TenantUsers and only return the `tenantUserId`
     * const tenantUserWithTenantUserIdOnly = await prisma.tenantUser.updateManyAndReturn({
     *   select: { tenantUserId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends TenantUserUpdateManyAndReturnArgs>(args: SelectSubset<T, TenantUserUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one TenantUser.
     * @param {TenantUserUpsertArgs} args - Arguments to update or create a TenantUser.
     * @example
     * // Update or create a TenantUser
     * const tenantUser = await prisma.tenantUser.upsert({
     *   create: {
     *     // ... data to create a TenantUser
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TenantUser we want to update
     *   }
     * })
     */
    upsert<T extends TenantUserUpsertArgs>(args: SelectSubset<T, TenantUserUpsertArgs<ExtArgs>>): Prisma__TenantUserClient<$Result.GetResult<Prisma.$TenantUserPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of TenantUsers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserCountArgs} args - Arguments to filter TenantUsers to count.
     * @example
     * // Count the number of TenantUsers
     * const count = await prisma.tenantUser.count({
     *   where: {
     *     // ... the filter for the TenantUsers we want to count
     *   }
     * })
    **/
    count<T extends TenantUserCountArgs>(
      args?: Subset<T, TenantUserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TenantUserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TenantUser.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TenantUserAggregateArgs>(args: Subset<T, TenantUserAggregateArgs>): Prisma.PrismaPromise<GetTenantUserAggregateType<T>>

    /**
     * Group by TenantUser.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TenantUserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TenantUserGroupByArgs['orderBy'] }
        : { orderBy?: TenantUserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TenantUserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTenantUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TenantUser model
   */
  readonly fields: TenantUserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TenantUser.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TenantUserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TenantUser model
   */
  interface TenantUserFieldRefs {
    readonly tenantUserId: FieldRef<"TenantUser", 'String'>
    readonly tenantId: FieldRef<"TenantUser", 'String'>
    readonly userId: FieldRef<"TenantUser", 'String'>
    readonly tenantUserRole: FieldRef<"TenantUser", 'TenantUserRole'>
    readonly tenantUserStatus: FieldRef<"TenantUser", 'TenantUserStatus'>
    readonly userSessionId: FieldRef<"TenantUser", 'String'>
    readonly createdAt: FieldRef<"TenantUser", 'DateTime'>
    readonly updatedAt: FieldRef<"TenantUser", 'DateTime'>
    readonly deletedAt: FieldRef<"TenantUser", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TenantUser findUnique
   */
  export type TenantUserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter, which TenantUser to fetch.
     */
    where: TenantUserWhereUniqueInput
  }

  /**
   * TenantUser findUniqueOrThrow
   */
  export type TenantUserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter, which TenantUser to fetch.
     */
    where: TenantUserWhereUniqueInput
  }

  /**
   * TenantUser findFirst
   */
  export type TenantUserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter, which TenantUser to fetch.
     */
    where?: TenantUserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TenantUsers to fetch.
     */
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TenantUsers.
     */
    cursor?: TenantUserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TenantUsers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TenantUsers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TenantUsers.
     */
    distinct?: TenantUserScalarFieldEnum | TenantUserScalarFieldEnum[]
  }

  /**
   * TenantUser findFirstOrThrow
   */
  export type TenantUserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter, which TenantUser to fetch.
     */
    where?: TenantUserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TenantUsers to fetch.
     */
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TenantUsers.
     */
    cursor?: TenantUserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TenantUsers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TenantUsers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TenantUsers.
     */
    distinct?: TenantUserScalarFieldEnum | TenantUserScalarFieldEnum[]
  }

  /**
   * TenantUser findMany
   */
  export type TenantUserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter, which TenantUsers to fetch.
     */
    where?: TenantUserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TenantUsers to fetch.
     */
    orderBy?: TenantUserOrderByWithRelationInput | TenantUserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TenantUsers.
     */
    cursor?: TenantUserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TenantUsers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TenantUsers.
     */
    skip?: number
    distinct?: TenantUserScalarFieldEnum | TenantUserScalarFieldEnum[]
  }

  /**
   * TenantUser create
   */
  export type TenantUserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * The data needed to create a TenantUser.
     */
    data: XOR<TenantUserCreateInput, TenantUserUncheckedCreateInput>
  }

  /**
   * TenantUser createMany
   */
  export type TenantUserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TenantUsers.
     */
    data: TenantUserCreateManyInput | TenantUserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TenantUser createManyAndReturn
   */
  export type TenantUserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * The data used to create many TenantUsers.
     */
    data: TenantUserCreateManyInput | TenantUserCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TenantUser update
   */
  export type TenantUserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * The data needed to update a TenantUser.
     */
    data: XOR<TenantUserUpdateInput, TenantUserUncheckedUpdateInput>
    /**
     * Choose, which TenantUser to update.
     */
    where: TenantUserWhereUniqueInput
  }

  /**
   * TenantUser updateMany
   */
  export type TenantUserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TenantUsers.
     */
    data: XOR<TenantUserUpdateManyMutationInput, TenantUserUncheckedUpdateManyInput>
    /**
     * Filter which TenantUsers to update
     */
    where?: TenantUserWhereInput
    /**
     * Limit how many TenantUsers to update.
     */
    limit?: number
  }

  /**
   * TenantUser updateManyAndReturn
   */
  export type TenantUserUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * The data used to update TenantUsers.
     */
    data: XOR<TenantUserUpdateManyMutationInput, TenantUserUncheckedUpdateManyInput>
    /**
     * Filter which TenantUsers to update
     */
    where?: TenantUserWhereInput
    /**
     * Limit how many TenantUsers to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * TenantUser upsert
   */
  export type TenantUserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * The filter to search for the TenantUser to update in case it exists.
     */
    where: TenantUserWhereUniqueInput
    /**
     * In case the TenantUser found by the `where` argument doesn't exist, create a new TenantUser with this data.
     */
    create: XOR<TenantUserCreateInput, TenantUserUncheckedCreateInput>
    /**
     * In case the TenantUser was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TenantUserUpdateInput, TenantUserUncheckedUpdateInput>
  }

  /**
   * TenantUser delete
   */
  export type TenantUserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
    /**
     * Filter which TenantUser to delete.
     */
    where: TenantUserWhereUniqueInput
  }

  /**
   * TenantUser deleteMany
   */
  export type TenantUserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TenantUsers to delete
     */
    where?: TenantUserWhereInput
    /**
     * Limit how many TenantUsers to delete.
     */
    limit?: number
  }

  /**
   * TenantUser without action
   */
  export type TenantUserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantUser
     */
    select?: TenantUserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the TenantUser
     */
    omit?: TenantUserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantUserInclude<ExtArgs> | null
  }


  /**
   * Model Settings
   */

  export type AggregateSettings = {
    _count: SettingsCountAggregateOutputType | null
    _min: SettingsMinAggregateOutputType | null
    _max: SettingsMaxAggregateOutputType | null
  }

  export type SettingsMinAggregateOutputType = {
    tenantSettingId: string | null
    tenantId: string | null
    key: string | null
    value: string | null
  }

  export type SettingsMaxAggregateOutputType = {
    tenantSettingId: string | null
    tenantId: string | null
    key: string | null
    value: string | null
  }

  export type SettingsCountAggregateOutputType = {
    tenantSettingId: number
    tenantId: number
    key: number
    value: number
    _all: number
  }


  export type SettingsMinAggregateInputType = {
    tenantSettingId?: true
    tenantId?: true
    key?: true
    value?: true
  }

  export type SettingsMaxAggregateInputType = {
    tenantSettingId?: true
    tenantId?: true
    key?: true
    value?: true
  }

  export type SettingsCountAggregateInputType = {
    tenantSettingId?: true
    tenantId?: true
    key?: true
    value?: true
    _all?: true
  }

  export type SettingsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Settings to aggregate.
     */
    where?: SettingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingsOrderByWithRelationInput | SettingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SettingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Settings
    **/
    _count?: true | SettingsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SettingsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SettingsMaxAggregateInputType
  }

  export type GetSettingsAggregateType<T extends SettingsAggregateArgs> = {
        [P in keyof T & keyof AggregateSettings]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSettings[P]>
      : GetScalarType<T[P], AggregateSettings[P]>
  }




  export type SettingsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SettingsWhereInput
    orderBy?: SettingsOrderByWithAggregationInput | SettingsOrderByWithAggregationInput[]
    by: SettingsScalarFieldEnum[] | SettingsScalarFieldEnum
    having?: SettingsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SettingsCountAggregateInputType | true
    _min?: SettingsMinAggregateInputType
    _max?: SettingsMaxAggregateInputType
  }

  export type SettingsGroupByOutputType = {
    tenantSettingId: string
    tenantId: string
    key: string
    value: string
    _count: SettingsCountAggregateOutputType | null
    _min: SettingsMinAggregateOutputType | null
    _max: SettingsMaxAggregateOutputType | null
  }

  type GetSettingsGroupByPayload<T extends SettingsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SettingsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SettingsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SettingsGroupByOutputType[P]>
            : GetScalarType<T[P], SettingsGroupByOutputType[P]>
        }
      >
    >


  export type SettingsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantSettingId?: boolean
    tenantId?: boolean
    key?: boolean
    value?: boolean
  }, ExtArgs["result"]["settings"]>

  export type SettingsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantSettingId?: boolean
    tenantId?: boolean
    key?: boolean
    value?: boolean
  }, ExtArgs["result"]["settings"]>

  export type SettingsSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    tenantSettingId?: boolean
    tenantId?: boolean
    key?: boolean
    value?: boolean
  }, ExtArgs["result"]["settings"]>

  export type SettingsSelectScalar = {
    tenantSettingId?: boolean
    tenantId?: boolean
    key?: boolean
    value?: boolean
  }

  export type SettingsOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"tenantSettingId" | "tenantId" | "key" | "value", ExtArgs["result"]["settings"]>

  export type $SettingsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Settings"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      tenantSettingId: string
      tenantId: string
      key: string
      value: string
    }, ExtArgs["result"]["settings"]>
    composites: {}
  }

  type SettingsGetPayload<S extends boolean | null | undefined | SettingsDefaultArgs> = $Result.GetResult<Prisma.$SettingsPayload, S>

  type SettingsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SettingsFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SettingsCountAggregateInputType | true
    }

  export interface SettingsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Settings'], meta: { name: 'Settings' } }
    /**
     * Find zero or one Settings that matches the filter.
     * @param {SettingsFindUniqueArgs} args - Arguments to find a Settings
     * @example
     * // Get one Settings
     * const settings = await prisma.settings.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SettingsFindUniqueArgs>(args: SelectSubset<T, SettingsFindUniqueArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Settings that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SettingsFindUniqueOrThrowArgs} args - Arguments to find a Settings
     * @example
     * // Get one Settings
     * const settings = await prisma.settings.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SettingsFindUniqueOrThrowArgs>(args: SelectSubset<T, SettingsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Settings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsFindFirstArgs} args - Arguments to find a Settings
     * @example
     * // Get one Settings
     * const settings = await prisma.settings.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SettingsFindFirstArgs>(args?: SelectSubset<T, SettingsFindFirstArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Settings that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsFindFirstOrThrowArgs} args - Arguments to find a Settings
     * @example
     * // Get one Settings
     * const settings = await prisma.settings.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SettingsFindFirstOrThrowArgs>(args?: SelectSubset<T, SettingsFindFirstOrThrowArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Settings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Settings
     * const settings = await prisma.settings.findMany()
     * 
     * // Get first 10 Settings
     * const settings = await prisma.settings.findMany({ take: 10 })
     * 
     * // Only select the `tenantSettingId`
     * const settingsWithTenantSettingIdOnly = await prisma.settings.findMany({ select: { tenantSettingId: true } })
     * 
     */
    findMany<T extends SettingsFindManyArgs>(args?: SelectSubset<T, SettingsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Settings.
     * @param {SettingsCreateArgs} args - Arguments to create a Settings.
     * @example
     * // Create one Settings
     * const Settings = await prisma.settings.create({
     *   data: {
     *     // ... data to create a Settings
     *   }
     * })
     * 
     */
    create<T extends SettingsCreateArgs>(args: SelectSubset<T, SettingsCreateArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Settings.
     * @param {SettingsCreateManyArgs} args - Arguments to create many Settings.
     * @example
     * // Create many Settings
     * const settings = await prisma.settings.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SettingsCreateManyArgs>(args?: SelectSubset<T, SettingsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Settings and returns the data saved in the database.
     * @param {SettingsCreateManyAndReturnArgs} args - Arguments to create many Settings.
     * @example
     * // Create many Settings
     * const settings = await prisma.settings.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Settings and only return the `tenantSettingId`
     * const settingsWithTenantSettingIdOnly = await prisma.settings.createManyAndReturn({
     *   select: { tenantSettingId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SettingsCreateManyAndReturnArgs>(args?: SelectSubset<T, SettingsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Settings.
     * @param {SettingsDeleteArgs} args - Arguments to delete one Settings.
     * @example
     * // Delete one Settings
     * const Settings = await prisma.settings.delete({
     *   where: {
     *     // ... filter to delete one Settings
     *   }
     * })
     * 
     */
    delete<T extends SettingsDeleteArgs>(args: SelectSubset<T, SettingsDeleteArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Settings.
     * @param {SettingsUpdateArgs} args - Arguments to update one Settings.
     * @example
     * // Update one Settings
     * const settings = await prisma.settings.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SettingsUpdateArgs>(args: SelectSubset<T, SettingsUpdateArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Settings.
     * @param {SettingsDeleteManyArgs} args - Arguments to filter Settings to delete.
     * @example
     * // Delete a few Settings
     * const { count } = await prisma.settings.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SettingsDeleteManyArgs>(args?: SelectSubset<T, SettingsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Settings
     * const settings = await prisma.settings.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SettingsUpdateManyArgs>(args: SelectSubset<T, SettingsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Settings and returns the data updated in the database.
     * @param {SettingsUpdateManyAndReturnArgs} args - Arguments to update many Settings.
     * @example
     * // Update many Settings
     * const settings = await prisma.settings.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Settings and only return the `tenantSettingId`
     * const settingsWithTenantSettingIdOnly = await prisma.settings.updateManyAndReturn({
     *   select: { tenantSettingId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SettingsUpdateManyAndReturnArgs>(args: SelectSubset<T, SettingsUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Settings.
     * @param {SettingsUpsertArgs} args - Arguments to update or create a Settings.
     * @example
     * // Update or create a Settings
     * const settings = await prisma.settings.upsert({
     *   create: {
     *     // ... data to create a Settings
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Settings we want to update
     *   }
     * })
     */
    upsert<T extends SettingsUpsertArgs>(args: SelectSubset<T, SettingsUpsertArgs<ExtArgs>>): Prisma__SettingsClient<$Result.GetResult<Prisma.$SettingsPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsCountArgs} args - Arguments to filter Settings to count.
     * @example
     * // Count the number of Settings
     * const count = await prisma.settings.count({
     *   where: {
     *     // ... the filter for the Settings we want to count
     *   }
     * })
    **/
    count<T extends SettingsCountArgs>(
      args?: Subset<T, SettingsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SettingsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SettingsAggregateArgs>(args: Subset<T, SettingsAggregateArgs>): Prisma.PrismaPromise<GetSettingsAggregateType<T>>

    /**
     * Group by Settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SettingsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SettingsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SettingsGroupByArgs['orderBy'] }
        : { orderBy?: SettingsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SettingsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSettingsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Settings model
   */
  readonly fields: SettingsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Settings.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SettingsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Settings model
   */
  interface SettingsFieldRefs {
    readonly tenantSettingId: FieldRef<"Settings", 'String'>
    readonly tenantId: FieldRef<"Settings", 'String'>
    readonly key: FieldRef<"Settings", 'String'>
    readonly value: FieldRef<"Settings", 'String'>
  }
    

  // Custom InputTypes
  /**
   * Settings findUnique
   */
  export type SettingsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where: SettingsWhereUniqueInput
  }

  /**
   * Settings findUniqueOrThrow
   */
  export type SettingsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where: SettingsWhereUniqueInput
  }

  /**
   * Settings findFirst
   */
  export type SettingsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where?: SettingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingsOrderByWithRelationInput | SettingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Settings.
     */
    cursor?: SettingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Settings.
     */
    distinct?: SettingsScalarFieldEnum | SettingsScalarFieldEnum[]
  }

  /**
   * Settings findFirstOrThrow
   */
  export type SettingsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where?: SettingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingsOrderByWithRelationInput | SettingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Settings.
     */
    cursor?: SettingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Settings.
     */
    distinct?: SettingsScalarFieldEnum | SettingsScalarFieldEnum[]
  }

  /**
   * Settings findMany
   */
  export type SettingsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter, which Settings to fetch.
     */
    where?: SettingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Settings to fetch.
     */
    orderBy?: SettingsOrderByWithRelationInput | SettingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Settings.
     */
    cursor?: SettingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Settings.
     */
    skip?: number
    distinct?: SettingsScalarFieldEnum | SettingsScalarFieldEnum[]
  }

  /**
   * Settings create
   */
  export type SettingsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * The data needed to create a Settings.
     */
    data: XOR<SettingsCreateInput, SettingsUncheckedCreateInput>
  }

  /**
   * Settings createMany
   */
  export type SettingsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Settings.
     */
    data: SettingsCreateManyInput | SettingsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Settings createManyAndReturn
   */
  export type SettingsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * The data used to create many Settings.
     */
    data: SettingsCreateManyInput | SettingsCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Settings update
   */
  export type SettingsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * The data needed to update a Settings.
     */
    data: XOR<SettingsUpdateInput, SettingsUncheckedUpdateInput>
    /**
     * Choose, which Settings to update.
     */
    where: SettingsWhereUniqueInput
  }

  /**
   * Settings updateMany
   */
  export type SettingsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Settings.
     */
    data: XOR<SettingsUpdateManyMutationInput, SettingsUncheckedUpdateManyInput>
    /**
     * Filter which Settings to update
     */
    where?: SettingsWhereInput
    /**
     * Limit how many Settings to update.
     */
    limit?: number
  }

  /**
   * Settings updateManyAndReturn
   */
  export type SettingsUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * The data used to update Settings.
     */
    data: XOR<SettingsUpdateManyMutationInput, SettingsUncheckedUpdateManyInput>
    /**
     * Filter which Settings to update
     */
    where?: SettingsWhereInput
    /**
     * Limit how many Settings to update.
     */
    limit?: number
  }

  /**
   * Settings upsert
   */
  export type SettingsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * The filter to search for the Settings to update in case it exists.
     */
    where: SettingsWhereUniqueInput
    /**
     * In case the Settings found by the `where` argument doesn't exist, create a new Settings with this data.
     */
    create: XOR<SettingsCreateInput, SettingsUncheckedCreateInput>
    /**
     * In case the Settings was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SettingsUpdateInput, SettingsUncheckedUpdateInput>
  }

  /**
   * Settings delete
   */
  export type SettingsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
    /**
     * Filter which Settings to delete.
     */
    where: SettingsWhereUniqueInput
  }

  /**
   * Settings deleteMany
   */
  export type SettingsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Settings to delete
     */
    where?: SettingsWhereInput
    /**
     * Limit how many Settings to delete.
     */
    limit?: number
  }

  /**
   * Settings without action
   */
  export type SettingsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Settings
     */
    select?: SettingsSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Settings
     */
    omit?: SettingsOmit<ExtArgs> | null
  }


  /**
   * Model SubscriptionPrice
   */

  export type AggregateSubscriptionPrice = {
    _count: SubscriptionPriceCountAggregateOutputType | null
    _avg: SubscriptionPriceAvgAggregateOutputType | null
    _sum: SubscriptionPriceSumAggregateOutputType | null
    _min: SubscriptionPriceMinAggregateOutputType | null
    _max: SubscriptionPriceMaxAggregateOutputType | null
  }

  export type SubscriptionPriceAvgAggregateOutputType = {
    price: number | null
  }

  export type SubscriptionPriceSumAggregateOutputType = {
    price: number | null
  }

  export type SubscriptionPriceMinAggregateOutputType = {
    subscriptionPriceId: string | null
    default: boolean | null
    currency: $Enums.Currency | null
    price: number | null
    subscriptionPlanId: string | null
    iyzicoPricingPlanRefId: string | null
    createdAt: Date | null
    updatedAt: Date | null
    cancelledAt: Date | null
  }

  export type SubscriptionPriceMaxAggregateOutputType = {
    subscriptionPriceId: string | null
    default: boolean | null
    currency: $Enums.Currency | null
    price: number | null
    subscriptionPlanId: string | null
    iyzicoPricingPlanRefId: string | null
    createdAt: Date | null
    updatedAt: Date | null
    cancelledAt: Date | null
  }

  export type SubscriptionPriceCountAggregateOutputType = {
    subscriptionPriceId: number
    default: number
    region: number
    currency: number
    price: number
    methods: number
    subscriptionPlanId: number
    iyzicoPricingPlanRefId: number
    createdAt: number
    updatedAt: number
    cancelledAt: number
    _all: number
  }


  export type SubscriptionPriceAvgAggregateInputType = {
    price?: true
  }

  export type SubscriptionPriceSumAggregateInputType = {
    price?: true
  }

  export type SubscriptionPriceMinAggregateInputType = {
    subscriptionPriceId?: true
    default?: true
    currency?: true
    price?: true
    subscriptionPlanId?: true
    iyzicoPricingPlanRefId?: true
    createdAt?: true
    updatedAt?: true
    cancelledAt?: true
  }

  export type SubscriptionPriceMaxAggregateInputType = {
    subscriptionPriceId?: true
    default?: true
    currency?: true
    price?: true
    subscriptionPlanId?: true
    iyzicoPricingPlanRefId?: true
    createdAt?: true
    updatedAt?: true
    cancelledAt?: true
  }

  export type SubscriptionPriceCountAggregateInputType = {
    subscriptionPriceId?: true
    default?: true
    region?: true
    currency?: true
    price?: true
    methods?: true
    subscriptionPlanId?: true
    iyzicoPricingPlanRefId?: true
    createdAt?: true
    updatedAt?: true
    cancelledAt?: true
    _all?: true
  }

  export type SubscriptionPriceAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SubscriptionPrice to aggregate.
     */
    where?: SubscriptionPriceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPrices to fetch.
     */
    orderBy?: SubscriptionPriceOrderByWithRelationInput | SubscriptionPriceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SubscriptionPriceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPrices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPrices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned SubscriptionPrices
    **/
    _count?: true | SubscriptionPriceCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SubscriptionPriceAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SubscriptionPriceSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SubscriptionPriceMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SubscriptionPriceMaxAggregateInputType
  }

  export type GetSubscriptionPriceAggregateType<T extends SubscriptionPriceAggregateArgs> = {
        [P in keyof T & keyof AggregateSubscriptionPrice]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSubscriptionPrice[P]>
      : GetScalarType<T[P], AggregateSubscriptionPrice[P]>
  }




  export type SubscriptionPriceGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionPriceWhereInput
    orderBy?: SubscriptionPriceOrderByWithAggregationInput | SubscriptionPriceOrderByWithAggregationInput[]
    by: SubscriptionPriceScalarFieldEnum[] | SubscriptionPriceScalarFieldEnum
    having?: SubscriptionPriceScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SubscriptionPriceCountAggregateInputType | true
    _avg?: SubscriptionPriceAvgAggregateInputType
    _sum?: SubscriptionPriceSumAggregateInputType
    _min?: SubscriptionPriceMinAggregateInputType
    _max?: SubscriptionPriceMaxAggregateInputType
  }

  export type SubscriptionPriceGroupByOutputType = {
    subscriptionPriceId: string
    default: boolean
    region: string[]
    currency: $Enums.Currency
    price: number
    methods: $Enums.PaymentMethod[]
    subscriptionPlanId: string
    iyzicoPricingPlanRefId: string | null
    createdAt: Date
    updatedAt: Date
    cancelledAt: Date | null
    _count: SubscriptionPriceCountAggregateOutputType | null
    _avg: SubscriptionPriceAvgAggregateOutputType | null
    _sum: SubscriptionPriceSumAggregateOutputType | null
    _min: SubscriptionPriceMinAggregateOutputType | null
    _max: SubscriptionPriceMaxAggregateOutputType | null
  }

  type GetSubscriptionPriceGroupByPayload<T extends SubscriptionPriceGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SubscriptionPriceGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SubscriptionPriceGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SubscriptionPriceGroupByOutputType[P]>
            : GetScalarType<T[P], SubscriptionPriceGroupByOutputType[P]>
        }
      >
    >


  export type SubscriptionPriceSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPriceId?: boolean
    default?: boolean
    region?: boolean
    currency?: boolean
    price?: boolean
    methods?: boolean
    subscriptionPlanId?: boolean
    iyzicoPricingPlanRefId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    cancelledAt?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    Subscription?: boolean | SubscriptionPrice$SubscriptionArgs<ExtArgs>
    _count?: boolean | SubscriptionPriceCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscriptionPrice"]>

  export type SubscriptionPriceSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPriceId?: boolean
    default?: boolean
    region?: boolean
    currency?: boolean
    price?: boolean
    methods?: boolean
    subscriptionPlanId?: boolean
    iyzicoPricingPlanRefId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    cancelledAt?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscriptionPrice"]>

  export type SubscriptionPriceSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPriceId?: boolean
    default?: boolean
    region?: boolean
    currency?: boolean
    price?: boolean
    methods?: boolean
    subscriptionPlanId?: boolean
    iyzicoPricingPlanRefId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    cancelledAt?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscriptionPrice"]>

  export type SubscriptionPriceSelectScalar = {
    subscriptionPriceId?: boolean
    default?: boolean
    region?: boolean
    currency?: boolean
    price?: boolean
    methods?: boolean
    subscriptionPlanId?: boolean
    iyzicoPricingPlanRefId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    cancelledAt?: boolean
  }

  export type SubscriptionPriceOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"subscriptionPriceId" | "default" | "region" | "currency" | "price" | "methods" | "subscriptionPlanId" | "iyzicoPricingPlanRefId" | "createdAt" | "updatedAt" | "cancelledAt", ExtArgs["result"]["subscriptionPrice"]>
  export type SubscriptionPriceInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    Subscription?: boolean | SubscriptionPrice$SubscriptionArgs<ExtArgs>
    _count?: boolean | SubscriptionPriceCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type SubscriptionPriceIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
  }
  export type SubscriptionPriceIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
  }

  export type $SubscriptionPricePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "SubscriptionPrice"
    objects: {
      subscriptionPlan: Prisma.$SubscriptionPlanPayload<ExtArgs>
      Subscription: Prisma.$SubscriptionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      subscriptionPriceId: string
      default: boolean
      region: string[]
      currency: $Enums.Currency
      price: number
      methods: $Enums.PaymentMethod[]
      subscriptionPlanId: string
      iyzicoPricingPlanRefId: string | null
      createdAt: Date
      updatedAt: Date
      cancelledAt: Date | null
    }, ExtArgs["result"]["subscriptionPrice"]>
    composites: {}
  }

  type SubscriptionPriceGetPayload<S extends boolean | null | undefined | SubscriptionPriceDefaultArgs> = $Result.GetResult<Prisma.$SubscriptionPricePayload, S>

  type SubscriptionPriceCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SubscriptionPriceFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SubscriptionPriceCountAggregateInputType | true
    }

  export interface SubscriptionPriceDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['SubscriptionPrice'], meta: { name: 'SubscriptionPrice' } }
    /**
     * Find zero or one SubscriptionPrice that matches the filter.
     * @param {SubscriptionPriceFindUniqueArgs} args - Arguments to find a SubscriptionPrice
     * @example
     * // Get one SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SubscriptionPriceFindUniqueArgs>(args: SelectSubset<T, SubscriptionPriceFindUniqueArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one SubscriptionPrice that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SubscriptionPriceFindUniqueOrThrowArgs} args - Arguments to find a SubscriptionPrice
     * @example
     * // Get one SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SubscriptionPriceFindUniqueOrThrowArgs>(args: SelectSubset<T, SubscriptionPriceFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SubscriptionPrice that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceFindFirstArgs} args - Arguments to find a SubscriptionPrice
     * @example
     * // Get one SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SubscriptionPriceFindFirstArgs>(args?: SelectSubset<T, SubscriptionPriceFindFirstArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SubscriptionPrice that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceFindFirstOrThrowArgs} args - Arguments to find a SubscriptionPrice
     * @example
     * // Get one SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SubscriptionPriceFindFirstOrThrowArgs>(args?: SelectSubset<T, SubscriptionPriceFindFirstOrThrowArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more SubscriptionPrices that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all SubscriptionPrices
     * const subscriptionPrices = await prisma.subscriptionPrice.findMany()
     * 
     * // Get first 10 SubscriptionPrices
     * const subscriptionPrices = await prisma.subscriptionPrice.findMany({ take: 10 })
     * 
     * // Only select the `subscriptionPriceId`
     * const subscriptionPriceWithSubscriptionPriceIdOnly = await prisma.subscriptionPrice.findMany({ select: { subscriptionPriceId: true } })
     * 
     */
    findMany<T extends SubscriptionPriceFindManyArgs>(args?: SelectSubset<T, SubscriptionPriceFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a SubscriptionPrice.
     * @param {SubscriptionPriceCreateArgs} args - Arguments to create a SubscriptionPrice.
     * @example
     * // Create one SubscriptionPrice
     * const SubscriptionPrice = await prisma.subscriptionPrice.create({
     *   data: {
     *     // ... data to create a SubscriptionPrice
     *   }
     * })
     * 
     */
    create<T extends SubscriptionPriceCreateArgs>(args: SelectSubset<T, SubscriptionPriceCreateArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many SubscriptionPrices.
     * @param {SubscriptionPriceCreateManyArgs} args - Arguments to create many SubscriptionPrices.
     * @example
     * // Create many SubscriptionPrices
     * const subscriptionPrice = await prisma.subscriptionPrice.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SubscriptionPriceCreateManyArgs>(args?: SelectSubset<T, SubscriptionPriceCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many SubscriptionPrices and returns the data saved in the database.
     * @param {SubscriptionPriceCreateManyAndReturnArgs} args - Arguments to create many SubscriptionPrices.
     * @example
     * // Create many SubscriptionPrices
     * const subscriptionPrice = await prisma.subscriptionPrice.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many SubscriptionPrices and only return the `subscriptionPriceId`
     * const subscriptionPriceWithSubscriptionPriceIdOnly = await prisma.subscriptionPrice.createManyAndReturn({
     *   select: { subscriptionPriceId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SubscriptionPriceCreateManyAndReturnArgs>(args?: SelectSubset<T, SubscriptionPriceCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a SubscriptionPrice.
     * @param {SubscriptionPriceDeleteArgs} args - Arguments to delete one SubscriptionPrice.
     * @example
     * // Delete one SubscriptionPrice
     * const SubscriptionPrice = await prisma.subscriptionPrice.delete({
     *   where: {
     *     // ... filter to delete one SubscriptionPrice
     *   }
     * })
     * 
     */
    delete<T extends SubscriptionPriceDeleteArgs>(args: SelectSubset<T, SubscriptionPriceDeleteArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one SubscriptionPrice.
     * @param {SubscriptionPriceUpdateArgs} args - Arguments to update one SubscriptionPrice.
     * @example
     * // Update one SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SubscriptionPriceUpdateArgs>(args: SelectSubset<T, SubscriptionPriceUpdateArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more SubscriptionPrices.
     * @param {SubscriptionPriceDeleteManyArgs} args - Arguments to filter SubscriptionPrices to delete.
     * @example
     * // Delete a few SubscriptionPrices
     * const { count } = await prisma.subscriptionPrice.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SubscriptionPriceDeleteManyArgs>(args?: SelectSubset<T, SubscriptionPriceDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SubscriptionPrices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many SubscriptionPrices
     * const subscriptionPrice = await prisma.subscriptionPrice.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SubscriptionPriceUpdateManyArgs>(args: SelectSubset<T, SubscriptionPriceUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SubscriptionPrices and returns the data updated in the database.
     * @param {SubscriptionPriceUpdateManyAndReturnArgs} args - Arguments to update many SubscriptionPrices.
     * @example
     * // Update many SubscriptionPrices
     * const subscriptionPrice = await prisma.subscriptionPrice.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more SubscriptionPrices and only return the `subscriptionPriceId`
     * const subscriptionPriceWithSubscriptionPriceIdOnly = await prisma.subscriptionPrice.updateManyAndReturn({
     *   select: { subscriptionPriceId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SubscriptionPriceUpdateManyAndReturnArgs>(args: SelectSubset<T, SubscriptionPriceUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one SubscriptionPrice.
     * @param {SubscriptionPriceUpsertArgs} args - Arguments to update or create a SubscriptionPrice.
     * @example
     * // Update or create a SubscriptionPrice
     * const subscriptionPrice = await prisma.subscriptionPrice.upsert({
     *   create: {
     *     // ... data to create a SubscriptionPrice
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the SubscriptionPrice we want to update
     *   }
     * })
     */
    upsert<T extends SubscriptionPriceUpsertArgs>(args: SelectSubset<T, SubscriptionPriceUpsertArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of SubscriptionPrices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceCountArgs} args - Arguments to filter SubscriptionPrices to count.
     * @example
     * // Count the number of SubscriptionPrices
     * const count = await prisma.subscriptionPrice.count({
     *   where: {
     *     // ... the filter for the SubscriptionPrices we want to count
     *   }
     * })
    **/
    count<T extends SubscriptionPriceCountArgs>(
      args?: Subset<T, SubscriptionPriceCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SubscriptionPriceCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a SubscriptionPrice.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SubscriptionPriceAggregateArgs>(args: Subset<T, SubscriptionPriceAggregateArgs>): Prisma.PrismaPromise<GetSubscriptionPriceAggregateType<T>>

    /**
     * Group by SubscriptionPrice.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPriceGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SubscriptionPriceGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SubscriptionPriceGroupByArgs['orderBy'] }
        : { orderBy?: SubscriptionPriceGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SubscriptionPriceGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSubscriptionPriceGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the SubscriptionPrice model
   */
  readonly fields: SubscriptionPriceFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for SubscriptionPrice.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SubscriptionPriceClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    subscriptionPlan<T extends SubscriptionPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPlanDefaultArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    Subscription<T extends SubscriptionPrice$SubscriptionArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPrice$SubscriptionArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the SubscriptionPrice model
   */
  interface SubscriptionPriceFieldRefs {
    readonly subscriptionPriceId: FieldRef<"SubscriptionPrice", 'String'>
    readonly default: FieldRef<"SubscriptionPrice", 'Boolean'>
    readonly region: FieldRef<"SubscriptionPrice", 'String[]'>
    readonly currency: FieldRef<"SubscriptionPrice", 'Currency'>
    readonly price: FieldRef<"SubscriptionPrice", 'Float'>
    readonly methods: FieldRef<"SubscriptionPrice", 'PaymentMethod[]'>
    readonly subscriptionPlanId: FieldRef<"SubscriptionPrice", 'String'>
    readonly iyzicoPricingPlanRefId: FieldRef<"SubscriptionPrice", 'String'>
    readonly createdAt: FieldRef<"SubscriptionPrice", 'DateTime'>
    readonly updatedAt: FieldRef<"SubscriptionPrice", 'DateTime'>
    readonly cancelledAt: FieldRef<"SubscriptionPrice", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * SubscriptionPrice findUnique
   */
  export type SubscriptionPriceFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPrice to fetch.
     */
    where: SubscriptionPriceWhereUniqueInput
  }

  /**
   * SubscriptionPrice findUniqueOrThrow
   */
  export type SubscriptionPriceFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPrice to fetch.
     */
    where: SubscriptionPriceWhereUniqueInput
  }

  /**
   * SubscriptionPrice findFirst
   */
  export type SubscriptionPriceFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPrice to fetch.
     */
    where?: SubscriptionPriceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPrices to fetch.
     */
    orderBy?: SubscriptionPriceOrderByWithRelationInput | SubscriptionPriceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SubscriptionPrices.
     */
    cursor?: SubscriptionPriceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPrices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPrices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SubscriptionPrices.
     */
    distinct?: SubscriptionPriceScalarFieldEnum | SubscriptionPriceScalarFieldEnum[]
  }

  /**
   * SubscriptionPrice findFirstOrThrow
   */
  export type SubscriptionPriceFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPrice to fetch.
     */
    where?: SubscriptionPriceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPrices to fetch.
     */
    orderBy?: SubscriptionPriceOrderByWithRelationInput | SubscriptionPriceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SubscriptionPrices.
     */
    cursor?: SubscriptionPriceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPrices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPrices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SubscriptionPrices.
     */
    distinct?: SubscriptionPriceScalarFieldEnum | SubscriptionPriceScalarFieldEnum[]
  }

  /**
   * SubscriptionPrice findMany
   */
  export type SubscriptionPriceFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPrices to fetch.
     */
    where?: SubscriptionPriceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPrices to fetch.
     */
    orderBy?: SubscriptionPriceOrderByWithRelationInput | SubscriptionPriceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing SubscriptionPrices.
     */
    cursor?: SubscriptionPriceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPrices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPrices.
     */
    skip?: number
    distinct?: SubscriptionPriceScalarFieldEnum | SubscriptionPriceScalarFieldEnum[]
  }

  /**
   * SubscriptionPrice create
   */
  export type SubscriptionPriceCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * The data needed to create a SubscriptionPrice.
     */
    data: XOR<SubscriptionPriceCreateInput, SubscriptionPriceUncheckedCreateInput>
  }

  /**
   * SubscriptionPrice createMany
   */
  export type SubscriptionPriceCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many SubscriptionPrices.
     */
    data: SubscriptionPriceCreateManyInput | SubscriptionPriceCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SubscriptionPrice createManyAndReturn
   */
  export type SubscriptionPriceCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * The data used to create many SubscriptionPrices.
     */
    data: SubscriptionPriceCreateManyInput | SubscriptionPriceCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * SubscriptionPrice update
   */
  export type SubscriptionPriceUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * The data needed to update a SubscriptionPrice.
     */
    data: XOR<SubscriptionPriceUpdateInput, SubscriptionPriceUncheckedUpdateInput>
    /**
     * Choose, which SubscriptionPrice to update.
     */
    where: SubscriptionPriceWhereUniqueInput
  }

  /**
   * SubscriptionPrice updateMany
   */
  export type SubscriptionPriceUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update SubscriptionPrices.
     */
    data: XOR<SubscriptionPriceUpdateManyMutationInput, SubscriptionPriceUncheckedUpdateManyInput>
    /**
     * Filter which SubscriptionPrices to update
     */
    where?: SubscriptionPriceWhereInput
    /**
     * Limit how many SubscriptionPrices to update.
     */
    limit?: number
  }

  /**
   * SubscriptionPrice updateManyAndReturn
   */
  export type SubscriptionPriceUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * The data used to update SubscriptionPrices.
     */
    data: XOR<SubscriptionPriceUpdateManyMutationInput, SubscriptionPriceUncheckedUpdateManyInput>
    /**
     * Filter which SubscriptionPrices to update
     */
    where?: SubscriptionPriceWhereInput
    /**
     * Limit how many SubscriptionPrices to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * SubscriptionPrice upsert
   */
  export type SubscriptionPriceUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * The filter to search for the SubscriptionPrice to update in case it exists.
     */
    where: SubscriptionPriceWhereUniqueInput
    /**
     * In case the SubscriptionPrice found by the `where` argument doesn't exist, create a new SubscriptionPrice with this data.
     */
    create: XOR<SubscriptionPriceCreateInput, SubscriptionPriceUncheckedCreateInput>
    /**
     * In case the SubscriptionPrice was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SubscriptionPriceUpdateInput, SubscriptionPriceUncheckedUpdateInput>
  }

  /**
   * SubscriptionPrice delete
   */
  export type SubscriptionPriceDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    /**
     * Filter which SubscriptionPrice to delete.
     */
    where: SubscriptionPriceWhereUniqueInput
  }

  /**
   * SubscriptionPrice deleteMany
   */
  export type SubscriptionPriceDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SubscriptionPrices to delete
     */
    where?: SubscriptionPriceWhereInput
    /**
     * Limit how many SubscriptionPrices to delete.
     */
    limit?: number
  }

  /**
   * SubscriptionPrice.Subscription
   */
  export type SubscriptionPrice$SubscriptionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * SubscriptionPrice without action
   */
  export type SubscriptionPriceDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
  }


  /**
   * Model SubscriptionPlan
   */

  export type AggregateSubscriptionPlan = {
    _count: SubscriptionPlanCountAggregateOutputType | null
    _min: SubscriptionPlanMinAggregateOutputType | null
    _max: SubscriptionPlanMaxAggregateOutputType | null
  }

  export type SubscriptionPlanMinAggregateOutputType = {
    subscriptionPlanId: string | null
    name: string | null
    description: string | null
    billingCycle: $Enums.SubscriptionBillingCycle | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SubscriptionPlanMaxAggregateOutputType = {
    subscriptionPlanId: string | null
    name: string | null
    description: string | null
    billingCycle: $Enums.SubscriptionBillingCycle | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SubscriptionPlanCountAggregateOutputType = {
    subscriptionPlanId: number
    name: number
    description: number
    billingCycle: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type SubscriptionPlanMinAggregateInputType = {
    subscriptionPlanId?: true
    name?: true
    description?: true
    billingCycle?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SubscriptionPlanMaxAggregateInputType = {
    subscriptionPlanId?: true
    name?: true
    description?: true
    billingCycle?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SubscriptionPlanCountAggregateInputType = {
    subscriptionPlanId?: true
    name?: true
    description?: true
    billingCycle?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type SubscriptionPlanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SubscriptionPlan to aggregate.
     */
    where?: SubscriptionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPlans to fetch.
     */
    orderBy?: SubscriptionPlanOrderByWithRelationInput | SubscriptionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SubscriptionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned SubscriptionPlans
    **/
    _count?: true | SubscriptionPlanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SubscriptionPlanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SubscriptionPlanMaxAggregateInputType
  }

  export type GetSubscriptionPlanAggregateType<T extends SubscriptionPlanAggregateArgs> = {
        [P in keyof T & keyof AggregateSubscriptionPlan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSubscriptionPlan[P]>
      : GetScalarType<T[P], AggregateSubscriptionPlan[P]>
  }




  export type SubscriptionPlanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionPlanWhereInput
    orderBy?: SubscriptionPlanOrderByWithAggregationInput | SubscriptionPlanOrderByWithAggregationInput[]
    by: SubscriptionPlanScalarFieldEnum[] | SubscriptionPlanScalarFieldEnum
    having?: SubscriptionPlanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SubscriptionPlanCountAggregateInputType | true
    _min?: SubscriptionPlanMinAggregateInputType
    _max?: SubscriptionPlanMaxAggregateInputType
  }

  export type SubscriptionPlanGroupByOutputType = {
    subscriptionPlanId: string
    name: string
    description: string | null
    billingCycle: $Enums.SubscriptionBillingCycle
    createdAt: Date
    updatedAt: Date
    _count: SubscriptionPlanCountAggregateOutputType | null
    _min: SubscriptionPlanMinAggregateOutputType | null
    _max: SubscriptionPlanMaxAggregateOutputType | null
  }

  type GetSubscriptionPlanGroupByPayload<T extends SubscriptionPlanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SubscriptionPlanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SubscriptionPlanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SubscriptionPlanGroupByOutputType[P]>
            : GetScalarType<T[P], SubscriptionPlanGroupByOutputType[P]>
        }
      >
    >


  export type SubscriptionPlanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPlanId?: boolean
    name?: boolean
    description?: boolean
    billingCycle?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    price?: boolean | SubscriptionPlan$priceArgs<ExtArgs>
    subscriptions?: boolean | SubscriptionPlan$subscriptionsArgs<ExtArgs>
    _count?: boolean | SubscriptionPlanCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscriptionPlan"]>

  export type SubscriptionPlanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPlanId?: boolean
    name?: boolean
    description?: boolean
    billingCycle?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["subscriptionPlan"]>

  export type SubscriptionPlanSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionPlanId?: boolean
    name?: boolean
    description?: boolean
    billingCycle?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["subscriptionPlan"]>

  export type SubscriptionPlanSelectScalar = {
    subscriptionPlanId?: boolean
    name?: boolean
    description?: boolean
    billingCycle?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type SubscriptionPlanOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"subscriptionPlanId" | "name" | "description" | "billingCycle" | "createdAt" | "updatedAt", ExtArgs["result"]["subscriptionPlan"]>
  export type SubscriptionPlanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    price?: boolean | SubscriptionPlan$priceArgs<ExtArgs>
    subscriptions?: boolean | SubscriptionPlan$subscriptionsArgs<ExtArgs>
    _count?: boolean | SubscriptionPlanCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type SubscriptionPlanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type SubscriptionPlanIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $SubscriptionPlanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "SubscriptionPlan"
    objects: {
      price: Prisma.$SubscriptionPricePayload<ExtArgs>[]
      subscriptions: Prisma.$SubscriptionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      subscriptionPlanId: string
      name: string
      description: string | null
      billingCycle: $Enums.SubscriptionBillingCycle
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["subscriptionPlan"]>
    composites: {}
  }

  type SubscriptionPlanGetPayload<S extends boolean | null | undefined | SubscriptionPlanDefaultArgs> = $Result.GetResult<Prisma.$SubscriptionPlanPayload, S>

  type SubscriptionPlanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SubscriptionPlanFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SubscriptionPlanCountAggregateInputType | true
    }

  export interface SubscriptionPlanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['SubscriptionPlan'], meta: { name: 'SubscriptionPlan' } }
    /**
     * Find zero or one SubscriptionPlan that matches the filter.
     * @param {SubscriptionPlanFindUniqueArgs} args - Arguments to find a SubscriptionPlan
     * @example
     * // Get one SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SubscriptionPlanFindUniqueArgs>(args: SelectSubset<T, SubscriptionPlanFindUniqueArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one SubscriptionPlan that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SubscriptionPlanFindUniqueOrThrowArgs} args - Arguments to find a SubscriptionPlan
     * @example
     * // Get one SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SubscriptionPlanFindUniqueOrThrowArgs>(args: SelectSubset<T, SubscriptionPlanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SubscriptionPlan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanFindFirstArgs} args - Arguments to find a SubscriptionPlan
     * @example
     * // Get one SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SubscriptionPlanFindFirstArgs>(args?: SelectSubset<T, SubscriptionPlanFindFirstArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SubscriptionPlan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanFindFirstOrThrowArgs} args - Arguments to find a SubscriptionPlan
     * @example
     * // Get one SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SubscriptionPlanFindFirstOrThrowArgs>(args?: SelectSubset<T, SubscriptionPlanFindFirstOrThrowArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more SubscriptionPlans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all SubscriptionPlans
     * const subscriptionPlans = await prisma.subscriptionPlan.findMany()
     * 
     * // Get first 10 SubscriptionPlans
     * const subscriptionPlans = await prisma.subscriptionPlan.findMany({ take: 10 })
     * 
     * // Only select the `subscriptionPlanId`
     * const subscriptionPlanWithSubscriptionPlanIdOnly = await prisma.subscriptionPlan.findMany({ select: { subscriptionPlanId: true } })
     * 
     */
    findMany<T extends SubscriptionPlanFindManyArgs>(args?: SelectSubset<T, SubscriptionPlanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a SubscriptionPlan.
     * @param {SubscriptionPlanCreateArgs} args - Arguments to create a SubscriptionPlan.
     * @example
     * // Create one SubscriptionPlan
     * const SubscriptionPlan = await prisma.subscriptionPlan.create({
     *   data: {
     *     // ... data to create a SubscriptionPlan
     *   }
     * })
     * 
     */
    create<T extends SubscriptionPlanCreateArgs>(args: SelectSubset<T, SubscriptionPlanCreateArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many SubscriptionPlans.
     * @param {SubscriptionPlanCreateManyArgs} args - Arguments to create many SubscriptionPlans.
     * @example
     * // Create many SubscriptionPlans
     * const subscriptionPlan = await prisma.subscriptionPlan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SubscriptionPlanCreateManyArgs>(args?: SelectSubset<T, SubscriptionPlanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many SubscriptionPlans and returns the data saved in the database.
     * @param {SubscriptionPlanCreateManyAndReturnArgs} args - Arguments to create many SubscriptionPlans.
     * @example
     * // Create many SubscriptionPlans
     * const subscriptionPlan = await prisma.subscriptionPlan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many SubscriptionPlans and only return the `subscriptionPlanId`
     * const subscriptionPlanWithSubscriptionPlanIdOnly = await prisma.subscriptionPlan.createManyAndReturn({
     *   select: { subscriptionPlanId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SubscriptionPlanCreateManyAndReturnArgs>(args?: SelectSubset<T, SubscriptionPlanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a SubscriptionPlan.
     * @param {SubscriptionPlanDeleteArgs} args - Arguments to delete one SubscriptionPlan.
     * @example
     * // Delete one SubscriptionPlan
     * const SubscriptionPlan = await prisma.subscriptionPlan.delete({
     *   where: {
     *     // ... filter to delete one SubscriptionPlan
     *   }
     * })
     * 
     */
    delete<T extends SubscriptionPlanDeleteArgs>(args: SelectSubset<T, SubscriptionPlanDeleteArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one SubscriptionPlan.
     * @param {SubscriptionPlanUpdateArgs} args - Arguments to update one SubscriptionPlan.
     * @example
     * // Update one SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SubscriptionPlanUpdateArgs>(args: SelectSubset<T, SubscriptionPlanUpdateArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more SubscriptionPlans.
     * @param {SubscriptionPlanDeleteManyArgs} args - Arguments to filter SubscriptionPlans to delete.
     * @example
     * // Delete a few SubscriptionPlans
     * const { count } = await prisma.subscriptionPlan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SubscriptionPlanDeleteManyArgs>(args?: SelectSubset<T, SubscriptionPlanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SubscriptionPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many SubscriptionPlans
     * const subscriptionPlan = await prisma.subscriptionPlan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SubscriptionPlanUpdateManyArgs>(args: SelectSubset<T, SubscriptionPlanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SubscriptionPlans and returns the data updated in the database.
     * @param {SubscriptionPlanUpdateManyAndReturnArgs} args - Arguments to update many SubscriptionPlans.
     * @example
     * // Update many SubscriptionPlans
     * const subscriptionPlan = await prisma.subscriptionPlan.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more SubscriptionPlans and only return the `subscriptionPlanId`
     * const subscriptionPlanWithSubscriptionPlanIdOnly = await prisma.subscriptionPlan.updateManyAndReturn({
     *   select: { subscriptionPlanId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SubscriptionPlanUpdateManyAndReturnArgs>(args: SelectSubset<T, SubscriptionPlanUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one SubscriptionPlan.
     * @param {SubscriptionPlanUpsertArgs} args - Arguments to update or create a SubscriptionPlan.
     * @example
     * // Update or create a SubscriptionPlan
     * const subscriptionPlan = await prisma.subscriptionPlan.upsert({
     *   create: {
     *     // ... data to create a SubscriptionPlan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the SubscriptionPlan we want to update
     *   }
     * })
     */
    upsert<T extends SubscriptionPlanUpsertArgs>(args: SelectSubset<T, SubscriptionPlanUpsertArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of SubscriptionPlans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanCountArgs} args - Arguments to filter SubscriptionPlans to count.
     * @example
     * // Count the number of SubscriptionPlans
     * const count = await prisma.subscriptionPlan.count({
     *   where: {
     *     // ... the filter for the SubscriptionPlans we want to count
     *   }
     * })
    **/
    count<T extends SubscriptionPlanCountArgs>(
      args?: Subset<T, SubscriptionPlanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SubscriptionPlanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a SubscriptionPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SubscriptionPlanAggregateArgs>(args: Subset<T, SubscriptionPlanAggregateArgs>): Prisma.PrismaPromise<GetSubscriptionPlanAggregateType<T>>

    /**
     * Group by SubscriptionPlan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionPlanGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SubscriptionPlanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SubscriptionPlanGroupByArgs['orderBy'] }
        : { orderBy?: SubscriptionPlanGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SubscriptionPlanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSubscriptionPlanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the SubscriptionPlan model
   */
  readonly fields: SubscriptionPlanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for SubscriptionPlan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SubscriptionPlanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    price<T extends SubscriptionPlan$priceArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPlan$priceArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    subscriptions<T extends SubscriptionPlan$subscriptionsArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPlan$subscriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the SubscriptionPlan model
   */
  interface SubscriptionPlanFieldRefs {
    readonly subscriptionPlanId: FieldRef<"SubscriptionPlan", 'String'>
    readonly name: FieldRef<"SubscriptionPlan", 'String'>
    readonly description: FieldRef<"SubscriptionPlan", 'String'>
    readonly billingCycle: FieldRef<"SubscriptionPlan", 'SubscriptionBillingCycle'>
    readonly createdAt: FieldRef<"SubscriptionPlan", 'DateTime'>
    readonly updatedAt: FieldRef<"SubscriptionPlan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * SubscriptionPlan findUnique
   */
  export type SubscriptionPlanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPlan to fetch.
     */
    where: SubscriptionPlanWhereUniqueInput
  }

  /**
   * SubscriptionPlan findUniqueOrThrow
   */
  export type SubscriptionPlanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPlan to fetch.
     */
    where: SubscriptionPlanWhereUniqueInput
  }

  /**
   * SubscriptionPlan findFirst
   */
  export type SubscriptionPlanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPlan to fetch.
     */
    where?: SubscriptionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPlans to fetch.
     */
    orderBy?: SubscriptionPlanOrderByWithRelationInput | SubscriptionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SubscriptionPlans.
     */
    cursor?: SubscriptionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SubscriptionPlans.
     */
    distinct?: SubscriptionPlanScalarFieldEnum | SubscriptionPlanScalarFieldEnum[]
  }

  /**
   * SubscriptionPlan findFirstOrThrow
   */
  export type SubscriptionPlanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPlan to fetch.
     */
    where?: SubscriptionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPlans to fetch.
     */
    orderBy?: SubscriptionPlanOrderByWithRelationInput | SubscriptionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SubscriptionPlans.
     */
    cursor?: SubscriptionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPlans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SubscriptionPlans.
     */
    distinct?: SubscriptionPlanScalarFieldEnum | SubscriptionPlanScalarFieldEnum[]
  }

  /**
   * SubscriptionPlan findMany
   */
  export type SubscriptionPlanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter, which SubscriptionPlans to fetch.
     */
    where?: SubscriptionPlanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SubscriptionPlans to fetch.
     */
    orderBy?: SubscriptionPlanOrderByWithRelationInput | SubscriptionPlanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing SubscriptionPlans.
     */
    cursor?: SubscriptionPlanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SubscriptionPlans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SubscriptionPlans.
     */
    skip?: number
    distinct?: SubscriptionPlanScalarFieldEnum | SubscriptionPlanScalarFieldEnum[]
  }

  /**
   * SubscriptionPlan create
   */
  export type SubscriptionPlanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * The data needed to create a SubscriptionPlan.
     */
    data: XOR<SubscriptionPlanCreateInput, SubscriptionPlanUncheckedCreateInput>
  }

  /**
   * SubscriptionPlan createMany
   */
  export type SubscriptionPlanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many SubscriptionPlans.
     */
    data: SubscriptionPlanCreateManyInput | SubscriptionPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SubscriptionPlan createManyAndReturn
   */
  export type SubscriptionPlanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * The data used to create many SubscriptionPlans.
     */
    data: SubscriptionPlanCreateManyInput | SubscriptionPlanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SubscriptionPlan update
   */
  export type SubscriptionPlanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * The data needed to update a SubscriptionPlan.
     */
    data: XOR<SubscriptionPlanUpdateInput, SubscriptionPlanUncheckedUpdateInput>
    /**
     * Choose, which SubscriptionPlan to update.
     */
    where: SubscriptionPlanWhereUniqueInput
  }

  /**
   * SubscriptionPlan updateMany
   */
  export type SubscriptionPlanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update SubscriptionPlans.
     */
    data: XOR<SubscriptionPlanUpdateManyMutationInput, SubscriptionPlanUncheckedUpdateManyInput>
    /**
     * Filter which SubscriptionPlans to update
     */
    where?: SubscriptionPlanWhereInput
    /**
     * Limit how many SubscriptionPlans to update.
     */
    limit?: number
  }

  /**
   * SubscriptionPlan updateManyAndReturn
   */
  export type SubscriptionPlanUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * The data used to update SubscriptionPlans.
     */
    data: XOR<SubscriptionPlanUpdateManyMutationInput, SubscriptionPlanUncheckedUpdateManyInput>
    /**
     * Filter which SubscriptionPlans to update
     */
    where?: SubscriptionPlanWhereInput
    /**
     * Limit how many SubscriptionPlans to update.
     */
    limit?: number
  }

  /**
   * SubscriptionPlan upsert
   */
  export type SubscriptionPlanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * The filter to search for the SubscriptionPlan to update in case it exists.
     */
    where: SubscriptionPlanWhereUniqueInput
    /**
     * In case the SubscriptionPlan found by the `where` argument doesn't exist, create a new SubscriptionPlan with this data.
     */
    create: XOR<SubscriptionPlanCreateInput, SubscriptionPlanUncheckedCreateInput>
    /**
     * In case the SubscriptionPlan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SubscriptionPlanUpdateInput, SubscriptionPlanUncheckedUpdateInput>
  }

  /**
   * SubscriptionPlan delete
   */
  export type SubscriptionPlanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
    /**
     * Filter which SubscriptionPlan to delete.
     */
    where: SubscriptionPlanWhereUniqueInput
  }

  /**
   * SubscriptionPlan deleteMany
   */
  export type SubscriptionPlanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SubscriptionPlans to delete
     */
    where?: SubscriptionPlanWhereInput
    /**
     * Limit how many SubscriptionPlans to delete.
     */
    limit?: number
  }

  /**
   * SubscriptionPlan.price
   */
  export type SubscriptionPlan$priceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPrice
     */
    select?: SubscriptionPriceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPrice
     */
    omit?: SubscriptionPriceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPriceInclude<ExtArgs> | null
    where?: SubscriptionPriceWhereInput
    orderBy?: SubscriptionPriceOrderByWithRelationInput | SubscriptionPriceOrderByWithRelationInput[]
    cursor?: SubscriptionPriceWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionPriceScalarFieldEnum | SubscriptionPriceScalarFieldEnum[]
  }

  /**
   * SubscriptionPlan.subscriptions
   */
  export type SubscriptionPlan$subscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * SubscriptionPlan without action
   */
  export type SubscriptionPlanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SubscriptionPlan
     */
    select?: SubscriptionPlanSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SubscriptionPlan
     */
    omit?: SubscriptionPlanOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionPlanInclude<ExtArgs> | null
  }


  /**
   * Model Subscription
   */

  export type AggregateSubscription = {
    _count: SubscriptionCountAggregateOutputType | null
    _avg: SubscriptionAvgAggregateOutputType | null
    _sum: SubscriptionSumAggregateOutputType | null
    _min: SubscriptionMinAggregateOutputType | null
    _max: SubscriptionMaxAggregateOutputType | null
  }

  export type SubscriptionAvgAggregateOutputType = {
    discountAmount: number | null
    taxRate: number | null
    taxAmount: number | null
    paidPrice: number | null
  }

  export type SubscriptionSumAggregateOutputType = {
    discountAmount: number | null
    taxRate: number | null
    taxAmount: number | null
    paidPrice: number | null
  }

  export type SubscriptionMinAggregateOutputType = {
    subscriptionId: string | null
    stripePaymentIntentId: string | null
    stripePaymentIntentStatus: string | null
    stripePaymentIntentClientSecret: string | null
    paypalOrderId: string | null
    paypalApprovalUrl: string | null
    paypalCaptureId: string | null
    iyzicoPaymentId: string | null
    iyzicoToken: string | null
    subscriptionPlanId: string | null
    subscriptionPriceId: string | null
    discountCode: string | null
    discountAmount: number | null
    taxRate: number | null
    taxAmount: number | null
    paidPrice: number | null
    currency: $Enums.Currency | null
    subscriptionStatus: $Enums.SubscriptionStatus | null
    paymentMethod: $Enums.PaymentMethod | null
    createdAt: Date | null
    paidAt: Date | null
    cancelledAt: Date | null
    refundedAt: Date | null
    billingAddressId: string | null
    tenantId: string | null
  }

  export type SubscriptionMaxAggregateOutputType = {
    subscriptionId: string | null
    stripePaymentIntentId: string | null
    stripePaymentIntentStatus: string | null
    stripePaymentIntentClientSecret: string | null
    paypalOrderId: string | null
    paypalApprovalUrl: string | null
    paypalCaptureId: string | null
    iyzicoPaymentId: string | null
    iyzicoToken: string | null
    subscriptionPlanId: string | null
    subscriptionPriceId: string | null
    discountCode: string | null
    discountAmount: number | null
    taxRate: number | null
    taxAmount: number | null
    paidPrice: number | null
    currency: $Enums.Currency | null
    subscriptionStatus: $Enums.SubscriptionStatus | null
    paymentMethod: $Enums.PaymentMethod | null
    createdAt: Date | null
    paidAt: Date | null
    cancelledAt: Date | null
    refundedAt: Date | null
    billingAddressId: string | null
    tenantId: string | null
  }

  export type SubscriptionCountAggregateOutputType = {
    subscriptionId: number
    stripePaymentIntentId: number
    stripePaymentIntentStatus: number
    stripePaymentIntentClientSecret: number
    paypalOrderId: number
    paypalApprovalUrl: number
    paypalCaptureId: number
    iyzicoPaymentId: number
    iyzicoToken: number
    subscriptionPlanId: number
    subscriptionPriceId: number
    discountCode: number
    discountAmount: number
    taxRate: number
    taxAmount: number
    paidPrice: number
    currency: number
    subscriptionStatus: number
    paymentMethod: number
    createdAt: number
    paidAt: number
    cancelledAt: number
    refundedAt: number
    billingAddressId: number
    tenantId: number
    _all: number
  }


  export type SubscriptionAvgAggregateInputType = {
    discountAmount?: true
    taxRate?: true
    taxAmount?: true
    paidPrice?: true
  }

  export type SubscriptionSumAggregateInputType = {
    discountAmount?: true
    taxRate?: true
    taxAmount?: true
    paidPrice?: true
  }

  export type SubscriptionMinAggregateInputType = {
    subscriptionId?: true
    stripePaymentIntentId?: true
    stripePaymentIntentStatus?: true
    stripePaymentIntentClientSecret?: true
    paypalOrderId?: true
    paypalApprovalUrl?: true
    paypalCaptureId?: true
    iyzicoPaymentId?: true
    iyzicoToken?: true
    subscriptionPlanId?: true
    subscriptionPriceId?: true
    discountCode?: true
    discountAmount?: true
    taxRate?: true
    taxAmount?: true
    paidPrice?: true
    currency?: true
    subscriptionStatus?: true
    paymentMethod?: true
    createdAt?: true
    paidAt?: true
    cancelledAt?: true
    refundedAt?: true
    billingAddressId?: true
    tenantId?: true
  }

  export type SubscriptionMaxAggregateInputType = {
    subscriptionId?: true
    stripePaymentIntentId?: true
    stripePaymentIntentStatus?: true
    stripePaymentIntentClientSecret?: true
    paypalOrderId?: true
    paypalApprovalUrl?: true
    paypalCaptureId?: true
    iyzicoPaymentId?: true
    iyzicoToken?: true
    subscriptionPlanId?: true
    subscriptionPriceId?: true
    discountCode?: true
    discountAmount?: true
    taxRate?: true
    taxAmount?: true
    paidPrice?: true
    currency?: true
    subscriptionStatus?: true
    paymentMethod?: true
    createdAt?: true
    paidAt?: true
    cancelledAt?: true
    refundedAt?: true
    billingAddressId?: true
    tenantId?: true
  }

  export type SubscriptionCountAggregateInputType = {
    subscriptionId?: true
    stripePaymentIntentId?: true
    stripePaymentIntentStatus?: true
    stripePaymentIntentClientSecret?: true
    paypalOrderId?: true
    paypalApprovalUrl?: true
    paypalCaptureId?: true
    iyzicoPaymentId?: true
    iyzicoToken?: true
    subscriptionPlanId?: true
    subscriptionPriceId?: true
    discountCode?: true
    discountAmount?: true
    taxRate?: true
    taxAmount?: true
    paidPrice?: true
    currency?: true
    subscriptionStatus?: true
    paymentMethod?: true
    createdAt?: true
    paidAt?: true
    cancelledAt?: true
    refundedAt?: true
    billingAddressId?: true
    tenantId?: true
    _all?: true
  }

  export type SubscriptionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Subscription to aggregate.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Subscriptions
    **/
    _count?: true | SubscriptionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SubscriptionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SubscriptionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SubscriptionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SubscriptionMaxAggregateInputType
  }

  export type GetSubscriptionAggregateType<T extends SubscriptionAggregateArgs> = {
        [P in keyof T & keyof AggregateSubscription]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSubscription[P]>
      : GetScalarType<T[P], AggregateSubscription[P]>
  }




  export type SubscriptionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithAggregationInput | SubscriptionOrderByWithAggregationInput[]
    by: SubscriptionScalarFieldEnum[] | SubscriptionScalarFieldEnum
    having?: SubscriptionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SubscriptionCountAggregateInputType | true
    _avg?: SubscriptionAvgAggregateInputType
    _sum?: SubscriptionSumAggregateInputType
    _min?: SubscriptionMinAggregateInputType
    _max?: SubscriptionMaxAggregateInputType
  }

  export type SubscriptionGroupByOutputType = {
    subscriptionId: string
    stripePaymentIntentId: string | null
    stripePaymentIntentStatus: string | null
    stripePaymentIntentClientSecret: string | null
    paypalOrderId: string | null
    paypalApprovalUrl: string | null
    paypalCaptureId: string | null
    iyzicoPaymentId: string | null
    iyzicoToken: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode: string | null
    discountAmount: number | null
    taxRate: number | null
    taxAmount: number | null
    paidPrice: number
    currency: $Enums.Currency
    subscriptionStatus: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt: Date
    paidAt: Date | null
    cancelledAt: Date | null
    refundedAt: Date | null
    billingAddressId: string | null
    tenantId: string
    _count: SubscriptionCountAggregateOutputType | null
    _avg: SubscriptionAvgAggregateOutputType | null
    _sum: SubscriptionSumAggregateOutputType | null
    _min: SubscriptionMinAggregateOutputType | null
    _max: SubscriptionMaxAggregateOutputType | null
  }

  type GetSubscriptionGroupByPayload<T extends SubscriptionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SubscriptionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SubscriptionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SubscriptionGroupByOutputType[P]>
            : GetScalarType<T[P], SubscriptionGroupByOutputType[P]>
        }
      >
    >


  export type SubscriptionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionId?: boolean
    stripePaymentIntentId?: boolean
    stripePaymentIntentStatus?: boolean
    stripePaymentIntentClientSecret?: boolean
    paypalOrderId?: boolean
    paypalApprovalUrl?: boolean
    paypalCaptureId?: boolean
    iyzicoPaymentId?: boolean
    iyzicoToken?: boolean
    subscriptionPlanId?: boolean
    subscriptionPriceId?: boolean
    discountCode?: boolean
    discountAmount?: boolean
    taxRate?: boolean
    taxAmount?: boolean
    paidPrice?: boolean
    currency?: boolean
    subscriptionStatus?: boolean
    paymentMethod?: boolean
    createdAt?: boolean
    paidAt?: boolean
    cancelledAt?: boolean
    refundedAt?: boolean
    billingAddressId?: boolean
    tenantId?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionId?: boolean
    stripePaymentIntentId?: boolean
    stripePaymentIntentStatus?: boolean
    stripePaymentIntentClientSecret?: boolean
    paypalOrderId?: boolean
    paypalApprovalUrl?: boolean
    paypalCaptureId?: boolean
    iyzicoPaymentId?: boolean
    iyzicoToken?: boolean
    subscriptionPlanId?: boolean
    subscriptionPriceId?: boolean
    discountCode?: boolean
    discountAmount?: boolean
    taxRate?: boolean
    taxAmount?: boolean
    paidPrice?: boolean
    currency?: boolean
    subscriptionStatus?: boolean
    paymentMethod?: boolean
    createdAt?: boolean
    paidAt?: boolean
    cancelledAt?: boolean
    refundedAt?: boolean
    billingAddressId?: boolean
    tenantId?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    subscriptionId?: boolean
    stripePaymentIntentId?: boolean
    stripePaymentIntentStatus?: boolean
    stripePaymentIntentClientSecret?: boolean
    paypalOrderId?: boolean
    paypalApprovalUrl?: boolean
    paypalCaptureId?: boolean
    iyzicoPaymentId?: boolean
    iyzicoToken?: boolean
    subscriptionPlanId?: boolean
    subscriptionPriceId?: boolean
    discountCode?: boolean
    discountAmount?: boolean
    taxRate?: boolean
    taxAmount?: boolean
    paidPrice?: boolean
    currency?: boolean
    subscriptionStatus?: boolean
    paymentMethod?: boolean
    createdAt?: boolean
    paidAt?: boolean
    cancelledAt?: boolean
    refundedAt?: boolean
    billingAddressId?: boolean
    tenantId?: boolean
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectScalar = {
    subscriptionId?: boolean
    stripePaymentIntentId?: boolean
    stripePaymentIntentStatus?: boolean
    stripePaymentIntentClientSecret?: boolean
    paypalOrderId?: boolean
    paypalApprovalUrl?: boolean
    paypalCaptureId?: boolean
    iyzicoPaymentId?: boolean
    iyzicoToken?: boolean
    subscriptionPlanId?: boolean
    subscriptionPriceId?: boolean
    discountCode?: boolean
    discountAmount?: boolean
    taxRate?: boolean
    taxAmount?: boolean
    paidPrice?: boolean
    currency?: boolean
    subscriptionStatus?: boolean
    paymentMethod?: boolean
    createdAt?: boolean
    paidAt?: boolean
    cancelledAt?: boolean
    refundedAt?: boolean
    billingAddressId?: boolean
    tenantId?: boolean
  }

  export type SubscriptionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"subscriptionId" | "stripePaymentIntentId" | "stripePaymentIntentStatus" | "stripePaymentIntentClientSecret" | "paypalOrderId" | "paypalApprovalUrl" | "paypalCaptureId" | "iyzicoPaymentId" | "iyzicoToken" | "subscriptionPlanId" | "subscriptionPriceId" | "discountCode" | "discountAmount" | "taxRate" | "taxAmount" | "paidPrice" | "currency" | "subscriptionStatus" | "paymentMethod" | "createdAt" | "paidAt" | "cancelledAt" | "refundedAt" | "billingAddressId" | "tenantId", ExtArgs["result"]["subscription"]>
  export type SubscriptionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }
  export type SubscriptionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }
  export type SubscriptionIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptionPlan?: boolean | SubscriptionPlanDefaultArgs<ExtArgs>
    subscriptionPrice?: boolean | SubscriptionPriceDefaultArgs<ExtArgs>
    billingAddress?: boolean | Subscription$billingAddressArgs<ExtArgs>
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }

  export type $SubscriptionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Subscription"
    objects: {
      subscriptionPlan: Prisma.$SubscriptionPlanPayload<ExtArgs>
      subscriptionPrice: Prisma.$SubscriptionPricePayload<ExtArgs>
      billingAddress: Prisma.$AddressPayload<ExtArgs> | null
      tenant: Prisma.$TenantPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      subscriptionId: string
      stripePaymentIntentId: string | null
      stripePaymentIntentStatus: string | null
      stripePaymentIntentClientSecret: string | null
      paypalOrderId: string | null
      paypalApprovalUrl: string | null
      paypalCaptureId: string | null
      iyzicoPaymentId: string | null
      iyzicoToken: string | null
      subscriptionPlanId: string
      subscriptionPriceId: string
      discountCode: string | null
      discountAmount: number | null
      taxRate: number | null
      taxAmount: number | null
      paidPrice: number
      currency: $Enums.Currency
      subscriptionStatus: $Enums.SubscriptionStatus
      paymentMethod: $Enums.PaymentMethod
      createdAt: Date
      paidAt: Date | null
      cancelledAt: Date | null
      refundedAt: Date | null
      billingAddressId: string | null
      tenantId: string
    }, ExtArgs["result"]["subscription"]>
    composites: {}
  }

  type SubscriptionGetPayload<S extends boolean | null | undefined | SubscriptionDefaultArgs> = $Result.GetResult<Prisma.$SubscriptionPayload, S>

  type SubscriptionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SubscriptionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SubscriptionCountAggregateInputType | true
    }

  export interface SubscriptionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Subscription'], meta: { name: 'Subscription' } }
    /**
     * Find zero or one Subscription that matches the filter.
     * @param {SubscriptionFindUniqueArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SubscriptionFindUniqueArgs>(args: SelectSubset<T, SubscriptionFindUniqueArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Subscription that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SubscriptionFindUniqueOrThrowArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SubscriptionFindUniqueOrThrowArgs>(args: SelectSubset<T, SubscriptionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Subscription that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindFirstArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SubscriptionFindFirstArgs>(args?: SelectSubset<T, SubscriptionFindFirstArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Subscription that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindFirstOrThrowArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SubscriptionFindFirstOrThrowArgs>(args?: SelectSubset<T, SubscriptionFindFirstOrThrowArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Subscriptions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Subscriptions
     * const subscriptions = await prisma.subscription.findMany()
     * 
     * // Get first 10 Subscriptions
     * const subscriptions = await prisma.subscription.findMany({ take: 10 })
     * 
     * // Only select the `subscriptionId`
     * const subscriptionWithSubscriptionIdOnly = await prisma.subscription.findMany({ select: { subscriptionId: true } })
     * 
     */
    findMany<T extends SubscriptionFindManyArgs>(args?: SelectSubset<T, SubscriptionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Subscription.
     * @param {SubscriptionCreateArgs} args - Arguments to create a Subscription.
     * @example
     * // Create one Subscription
     * const Subscription = await prisma.subscription.create({
     *   data: {
     *     // ... data to create a Subscription
     *   }
     * })
     * 
     */
    create<T extends SubscriptionCreateArgs>(args: SelectSubset<T, SubscriptionCreateArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Subscriptions.
     * @param {SubscriptionCreateManyArgs} args - Arguments to create many Subscriptions.
     * @example
     * // Create many Subscriptions
     * const subscription = await prisma.subscription.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SubscriptionCreateManyArgs>(args?: SelectSubset<T, SubscriptionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Subscriptions and returns the data saved in the database.
     * @param {SubscriptionCreateManyAndReturnArgs} args - Arguments to create many Subscriptions.
     * @example
     * // Create many Subscriptions
     * const subscription = await prisma.subscription.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Subscriptions and only return the `subscriptionId`
     * const subscriptionWithSubscriptionIdOnly = await prisma.subscription.createManyAndReturn({
     *   select: { subscriptionId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SubscriptionCreateManyAndReturnArgs>(args?: SelectSubset<T, SubscriptionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Subscription.
     * @param {SubscriptionDeleteArgs} args - Arguments to delete one Subscription.
     * @example
     * // Delete one Subscription
     * const Subscription = await prisma.subscription.delete({
     *   where: {
     *     // ... filter to delete one Subscription
     *   }
     * })
     * 
     */
    delete<T extends SubscriptionDeleteArgs>(args: SelectSubset<T, SubscriptionDeleteArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Subscription.
     * @param {SubscriptionUpdateArgs} args - Arguments to update one Subscription.
     * @example
     * // Update one Subscription
     * const subscription = await prisma.subscription.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SubscriptionUpdateArgs>(args: SelectSubset<T, SubscriptionUpdateArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Subscriptions.
     * @param {SubscriptionDeleteManyArgs} args - Arguments to filter Subscriptions to delete.
     * @example
     * // Delete a few Subscriptions
     * const { count } = await prisma.subscription.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SubscriptionDeleteManyArgs>(args?: SelectSubset<T, SubscriptionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Subscriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Subscriptions
     * const subscription = await prisma.subscription.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SubscriptionUpdateManyArgs>(args: SelectSubset<T, SubscriptionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Subscriptions and returns the data updated in the database.
     * @param {SubscriptionUpdateManyAndReturnArgs} args - Arguments to update many Subscriptions.
     * @example
     * // Update many Subscriptions
     * const subscription = await prisma.subscription.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Subscriptions and only return the `subscriptionId`
     * const subscriptionWithSubscriptionIdOnly = await prisma.subscription.updateManyAndReturn({
     *   select: { subscriptionId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SubscriptionUpdateManyAndReturnArgs>(args: SelectSubset<T, SubscriptionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Subscription.
     * @param {SubscriptionUpsertArgs} args - Arguments to update or create a Subscription.
     * @example
     * // Update or create a Subscription
     * const subscription = await prisma.subscription.upsert({
     *   create: {
     *     // ... data to create a Subscription
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Subscription we want to update
     *   }
     * })
     */
    upsert<T extends SubscriptionUpsertArgs>(args: SelectSubset<T, SubscriptionUpsertArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Subscriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionCountArgs} args - Arguments to filter Subscriptions to count.
     * @example
     * // Count the number of Subscriptions
     * const count = await prisma.subscription.count({
     *   where: {
     *     // ... the filter for the Subscriptions we want to count
     *   }
     * })
    **/
    count<T extends SubscriptionCountArgs>(
      args?: Subset<T, SubscriptionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SubscriptionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Subscription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SubscriptionAggregateArgs>(args: Subset<T, SubscriptionAggregateArgs>): Prisma.PrismaPromise<GetSubscriptionAggregateType<T>>

    /**
     * Group by Subscription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SubscriptionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SubscriptionGroupByArgs['orderBy'] }
        : { orderBy?: SubscriptionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SubscriptionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSubscriptionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Subscription model
   */
  readonly fields: SubscriptionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Subscription.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SubscriptionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    subscriptionPlan<T extends SubscriptionPlanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPlanDefaultArgs<ExtArgs>>): Prisma__SubscriptionPlanClient<$Result.GetResult<Prisma.$SubscriptionPlanPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    subscriptionPrice<T extends SubscriptionPriceDefaultArgs<ExtArgs> = {}>(args?: Subset<T, SubscriptionPriceDefaultArgs<ExtArgs>>): Prisma__SubscriptionPriceClient<$Result.GetResult<Prisma.$SubscriptionPricePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    billingAddress<T extends Subscription$billingAddressArgs<ExtArgs> = {}>(args?: Subset<T, Subscription$billingAddressArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Subscription model
   */
  interface SubscriptionFieldRefs {
    readonly subscriptionId: FieldRef<"Subscription", 'String'>
    readonly stripePaymentIntentId: FieldRef<"Subscription", 'String'>
    readonly stripePaymentIntentStatus: FieldRef<"Subscription", 'String'>
    readonly stripePaymentIntentClientSecret: FieldRef<"Subscription", 'String'>
    readonly paypalOrderId: FieldRef<"Subscription", 'String'>
    readonly paypalApprovalUrl: FieldRef<"Subscription", 'String'>
    readonly paypalCaptureId: FieldRef<"Subscription", 'String'>
    readonly iyzicoPaymentId: FieldRef<"Subscription", 'String'>
    readonly iyzicoToken: FieldRef<"Subscription", 'String'>
    readonly subscriptionPlanId: FieldRef<"Subscription", 'String'>
    readonly subscriptionPriceId: FieldRef<"Subscription", 'String'>
    readonly discountCode: FieldRef<"Subscription", 'String'>
    readonly discountAmount: FieldRef<"Subscription", 'Float'>
    readonly taxRate: FieldRef<"Subscription", 'Float'>
    readonly taxAmount: FieldRef<"Subscription", 'Float'>
    readonly paidPrice: FieldRef<"Subscription", 'Float'>
    readonly currency: FieldRef<"Subscription", 'Currency'>
    readonly subscriptionStatus: FieldRef<"Subscription", 'SubscriptionStatus'>
    readonly paymentMethod: FieldRef<"Subscription", 'PaymentMethod'>
    readonly createdAt: FieldRef<"Subscription", 'DateTime'>
    readonly paidAt: FieldRef<"Subscription", 'DateTime'>
    readonly cancelledAt: FieldRef<"Subscription", 'DateTime'>
    readonly refundedAt: FieldRef<"Subscription", 'DateTime'>
    readonly billingAddressId: FieldRef<"Subscription", 'String'>
    readonly tenantId: FieldRef<"Subscription", 'String'>
  }
    

  // Custom InputTypes
  /**
   * Subscription findUnique
   */
  export type SubscriptionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription findUniqueOrThrow
   */
  export type SubscriptionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription findFirst
   */
  export type SubscriptionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Subscriptions.
     */
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription findFirstOrThrow
   */
  export type SubscriptionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Subscriptions.
     */
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription findMany
   */
  export type SubscriptionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscriptions to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription create
   */
  export type SubscriptionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The data needed to create a Subscription.
     */
    data: XOR<SubscriptionCreateInput, SubscriptionUncheckedCreateInput>
  }

  /**
   * Subscription createMany
   */
  export type SubscriptionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Subscriptions.
     */
    data: SubscriptionCreateManyInput | SubscriptionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Subscription createManyAndReturn
   */
  export type SubscriptionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * The data used to create many Subscriptions.
     */
    data: SubscriptionCreateManyInput | SubscriptionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Subscription update
   */
  export type SubscriptionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The data needed to update a Subscription.
     */
    data: XOR<SubscriptionUpdateInput, SubscriptionUncheckedUpdateInput>
    /**
     * Choose, which Subscription to update.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription updateMany
   */
  export type SubscriptionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Subscriptions.
     */
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyInput>
    /**
     * Filter which Subscriptions to update
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to update.
     */
    limit?: number
  }

  /**
   * Subscription updateManyAndReturn
   */
  export type SubscriptionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * The data used to update Subscriptions.
     */
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyInput>
    /**
     * Filter which Subscriptions to update
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Subscription upsert
   */
  export type SubscriptionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The filter to search for the Subscription to update in case it exists.
     */
    where: SubscriptionWhereUniqueInput
    /**
     * In case the Subscription found by the `where` argument doesn't exist, create a new Subscription with this data.
     */
    create: XOR<SubscriptionCreateInput, SubscriptionUncheckedCreateInput>
    /**
     * In case the Subscription was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SubscriptionUpdateInput, SubscriptionUncheckedUpdateInput>
  }

  /**
   * Subscription delete
   */
  export type SubscriptionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter which Subscription to delete.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription deleteMany
   */
  export type SubscriptionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Subscriptions to delete
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to delete.
     */
    limit?: number
  }

  /**
   * Subscription.billingAddress
   */
  export type Subscription$billingAddressArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    where?: AddressWhereInput
  }

  /**
   * Subscription without action
   */
  export type SubscriptionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
  }


  /**
   * Model Address
   */

  export type AggregateAddress = {
    _count: AddressCountAggregateOutputType | null
    _min: AddressMinAggregateOutputType | null
    _max: AddressMaxAggregateOutputType | null
  }

  export type AddressMinAggregateOutputType = {
    addressId: string | null
    tenantId: string | null
    addressType: $Enums.AddressType | null
    name: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    phoneNumber: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
    taxOffice: string | null
    taxId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AddressMaxAggregateOutputType = {
    addressId: string | null
    tenantId: string | null
    addressType: $Enums.AddressType | null
    name: string | null
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    country: string | null
    zipCode: string | null
    phoneNumber: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
    taxOffice: string | null
    taxId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AddressCountAggregateOutputType = {
    addressId: number
    tenantId: number
    addressIntents: number
    addressType: number
    name: number
    addressLine1: number
    addressLine2: number
    city: number
    state: number
    country: number
    zipCode: number
    phoneNumber: number
    email: number
    firstName: number
    lastName: number
    taxOffice: number
    taxId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type AddressMinAggregateInputType = {
    addressId?: true
    tenantId?: true
    addressType?: true
    name?: true
    addressLine1?: true
    addressLine2?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phoneNumber?: true
    email?: true
    firstName?: true
    lastName?: true
    taxOffice?: true
    taxId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AddressMaxAggregateInputType = {
    addressId?: true
    tenantId?: true
    addressType?: true
    name?: true
    addressLine1?: true
    addressLine2?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phoneNumber?: true
    email?: true
    firstName?: true
    lastName?: true
    taxOffice?: true
    taxId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AddressCountAggregateInputType = {
    addressId?: true
    tenantId?: true
    addressIntents?: true
    addressType?: true
    name?: true
    addressLine1?: true
    addressLine2?: true
    city?: true
    state?: true
    country?: true
    zipCode?: true
    phoneNumber?: true
    email?: true
    firstName?: true
    lastName?: true
    taxOffice?: true
    taxId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type AddressAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Address to aggregate.
     */
    where?: AddressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Addresses to fetch.
     */
    orderBy?: AddressOrderByWithRelationInput | AddressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AddressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Addresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Addresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Addresses
    **/
    _count?: true | AddressCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AddressMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AddressMaxAggregateInputType
  }

  export type GetAddressAggregateType<T extends AddressAggregateArgs> = {
        [P in keyof T & keyof AggregateAddress]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAddress[P]>
      : GetScalarType<T[P], AggregateAddress[P]>
  }




  export type AddressGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AddressWhereInput
    orderBy?: AddressOrderByWithAggregationInput | AddressOrderByWithAggregationInput[]
    by: AddressScalarFieldEnum[] | AddressScalarFieldEnum
    having?: AddressScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AddressCountAggregateInputType | true
    _min?: AddressMinAggregateInputType
    _max?: AddressMaxAggregateInputType
  }

  export type AddressGroupByOutputType = {
    addressId: string
    tenantId: string
    addressIntents: $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2: string | null
    city: string
    state: string | null
    country: string
    zipCode: string | null
    phoneNumber: string | null
    email: string | null
    firstName: string | null
    lastName: string | null
    taxOffice: string | null
    taxId: string | null
    createdAt: Date
    updatedAt: Date
    _count: AddressCountAggregateOutputType | null
    _min: AddressMinAggregateOutputType | null
    _max: AddressMaxAggregateOutputType | null
  }

  type GetAddressGroupByPayload<T extends AddressGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AddressGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AddressGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AddressGroupByOutputType[P]>
            : GetScalarType<T[P], AddressGroupByOutputType[P]>
        }
      >
    >


  export type AddressSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    addressId?: boolean
    tenantId?: boolean
    addressIntents?: boolean
    addressType?: boolean
    name?: boolean
    addressLine1?: boolean
    addressLine2?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phoneNumber?: boolean
    email?: boolean
    firstName?: boolean
    lastName?: boolean
    taxOffice?: boolean
    taxId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    billingOrders?: boolean | Address$billingOrdersArgs<ExtArgs>
    _count?: boolean | AddressCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["address"]>

  export type AddressSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    addressId?: boolean
    tenantId?: boolean
    addressIntents?: boolean
    addressType?: boolean
    name?: boolean
    addressLine1?: boolean
    addressLine2?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phoneNumber?: boolean
    email?: boolean
    firstName?: boolean
    lastName?: boolean
    taxOffice?: boolean
    taxId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["address"]>

  export type AddressSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    addressId?: boolean
    tenantId?: boolean
    addressIntents?: boolean
    addressType?: boolean
    name?: boolean
    addressLine1?: boolean
    addressLine2?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phoneNumber?: boolean
    email?: boolean
    firstName?: boolean
    lastName?: boolean
    taxOffice?: boolean
    taxId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["address"]>

  export type AddressSelectScalar = {
    addressId?: boolean
    tenantId?: boolean
    addressIntents?: boolean
    addressType?: boolean
    name?: boolean
    addressLine1?: boolean
    addressLine2?: boolean
    city?: boolean
    state?: boolean
    country?: boolean
    zipCode?: boolean
    phoneNumber?: boolean
    email?: boolean
    firstName?: boolean
    lastName?: boolean
    taxOffice?: boolean
    taxId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type AddressOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"addressId" | "tenantId" | "addressIntents" | "addressType" | "name" | "addressLine1" | "addressLine2" | "city" | "state" | "country" | "zipCode" | "phoneNumber" | "email" | "firstName" | "lastName" | "taxOffice" | "taxId" | "createdAt" | "updatedAt", ExtArgs["result"]["address"]>
  export type AddressInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    billingOrders?: boolean | Address$billingOrdersArgs<ExtArgs>
    _count?: boolean | AddressCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type AddressIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type AddressIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $AddressPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Address"
    objects: {
      billingOrders: Prisma.$SubscriptionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      addressId: string
      tenantId: string
      addressIntents: $Enums.AddressIntent[]
      addressType: $Enums.AddressType
      name: string
      addressLine1: string
      addressLine2: string | null
      city: string
      state: string | null
      country: string
      zipCode: string | null
      phoneNumber: string | null
      email: string | null
      firstName: string | null
      lastName: string | null
      taxOffice: string | null
      taxId: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["address"]>
    composites: {}
  }

  type AddressGetPayload<S extends boolean | null | undefined | AddressDefaultArgs> = $Result.GetResult<Prisma.$AddressPayload, S>

  type AddressCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<AddressFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: AddressCountAggregateInputType | true
    }

  export interface AddressDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Address'], meta: { name: 'Address' } }
    /**
     * Find zero or one Address that matches the filter.
     * @param {AddressFindUniqueArgs} args - Arguments to find a Address
     * @example
     * // Get one Address
     * const address = await prisma.address.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AddressFindUniqueArgs>(args: SelectSubset<T, AddressFindUniqueArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Address that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {AddressFindUniqueOrThrowArgs} args - Arguments to find a Address
     * @example
     * // Get one Address
     * const address = await prisma.address.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AddressFindUniqueOrThrowArgs>(args: SelectSubset<T, AddressFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Address that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressFindFirstArgs} args - Arguments to find a Address
     * @example
     * // Get one Address
     * const address = await prisma.address.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AddressFindFirstArgs>(args?: SelectSubset<T, AddressFindFirstArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Address that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressFindFirstOrThrowArgs} args - Arguments to find a Address
     * @example
     * // Get one Address
     * const address = await prisma.address.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AddressFindFirstOrThrowArgs>(args?: SelectSubset<T, AddressFindFirstOrThrowArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Addresses that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Addresses
     * const addresses = await prisma.address.findMany()
     * 
     * // Get first 10 Addresses
     * const addresses = await prisma.address.findMany({ take: 10 })
     * 
     * // Only select the `addressId`
     * const addressWithAddressIdOnly = await prisma.address.findMany({ select: { addressId: true } })
     * 
     */
    findMany<T extends AddressFindManyArgs>(args?: SelectSubset<T, AddressFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Address.
     * @param {AddressCreateArgs} args - Arguments to create a Address.
     * @example
     * // Create one Address
     * const Address = await prisma.address.create({
     *   data: {
     *     // ... data to create a Address
     *   }
     * })
     * 
     */
    create<T extends AddressCreateArgs>(args: SelectSubset<T, AddressCreateArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Addresses.
     * @param {AddressCreateManyArgs} args - Arguments to create many Addresses.
     * @example
     * // Create many Addresses
     * const address = await prisma.address.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AddressCreateManyArgs>(args?: SelectSubset<T, AddressCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Addresses and returns the data saved in the database.
     * @param {AddressCreateManyAndReturnArgs} args - Arguments to create many Addresses.
     * @example
     * // Create many Addresses
     * const address = await prisma.address.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Addresses and only return the `addressId`
     * const addressWithAddressIdOnly = await prisma.address.createManyAndReturn({
     *   select: { addressId: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AddressCreateManyAndReturnArgs>(args?: SelectSubset<T, AddressCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Address.
     * @param {AddressDeleteArgs} args - Arguments to delete one Address.
     * @example
     * // Delete one Address
     * const Address = await prisma.address.delete({
     *   where: {
     *     // ... filter to delete one Address
     *   }
     * })
     * 
     */
    delete<T extends AddressDeleteArgs>(args: SelectSubset<T, AddressDeleteArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Address.
     * @param {AddressUpdateArgs} args - Arguments to update one Address.
     * @example
     * // Update one Address
     * const address = await prisma.address.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AddressUpdateArgs>(args: SelectSubset<T, AddressUpdateArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Addresses.
     * @param {AddressDeleteManyArgs} args - Arguments to filter Addresses to delete.
     * @example
     * // Delete a few Addresses
     * const { count } = await prisma.address.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AddressDeleteManyArgs>(args?: SelectSubset<T, AddressDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Addresses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Addresses
     * const address = await prisma.address.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AddressUpdateManyArgs>(args: SelectSubset<T, AddressUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Addresses and returns the data updated in the database.
     * @param {AddressUpdateManyAndReturnArgs} args - Arguments to update many Addresses.
     * @example
     * // Update many Addresses
     * const address = await prisma.address.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Addresses and only return the `addressId`
     * const addressWithAddressIdOnly = await prisma.address.updateManyAndReturn({
     *   select: { addressId: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends AddressUpdateManyAndReturnArgs>(args: SelectSubset<T, AddressUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Address.
     * @param {AddressUpsertArgs} args - Arguments to update or create a Address.
     * @example
     * // Update or create a Address
     * const address = await prisma.address.upsert({
     *   create: {
     *     // ... data to create a Address
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Address we want to update
     *   }
     * })
     */
    upsert<T extends AddressUpsertArgs>(args: SelectSubset<T, AddressUpsertArgs<ExtArgs>>): Prisma__AddressClient<$Result.GetResult<Prisma.$AddressPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Addresses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressCountArgs} args - Arguments to filter Addresses to count.
     * @example
     * // Count the number of Addresses
     * const count = await prisma.address.count({
     *   where: {
     *     // ... the filter for the Addresses we want to count
     *   }
     * })
    **/
    count<T extends AddressCountArgs>(
      args?: Subset<T, AddressCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AddressCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Address.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AddressAggregateArgs>(args: Subset<T, AddressAggregateArgs>): Prisma.PrismaPromise<GetAddressAggregateType<T>>

    /**
     * Group by Address.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AddressGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AddressGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AddressGroupByArgs['orderBy'] }
        : { orderBy?: AddressGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AddressGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAddressGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Address model
   */
  readonly fields: AddressFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Address.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AddressClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    billingOrders<T extends Address$billingOrdersArgs<ExtArgs> = {}>(args?: Subset<T, Address$billingOrdersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Address model
   */
  interface AddressFieldRefs {
    readonly addressId: FieldRef<"Address", 'String'>
    readonly tenantId: FieldRef<"Address", 'String'>
    readonly addressIntents: FieldRef<"Address", 'AddressIntent[]'>
    readonly addressType: FieldRef<"Address", 'AddressType'>
    readonly name: FieldRef<"Address", 'String'>
    readonly addressLine1: FieldRef<"Address", 'String'>
    readonly addressLine2: FieldRef<"Address", 'String'>
    readonly city: FieldRef<"Address", 'String'>
    readonly state: FieldRef<"Address", 'String'>
    readonly country: FieldRef<"Address", 'String'>
    readonly zipCode: FieldRef<"Address", 'String'>
    readonly phoneNumber: FieldRef<"Address", 'String'>
    readonly email: FieldRef<"Address", 'String'>
    readonly firstName: FieldRef<"Address", 'String'>
    readonly lastName: FieldRef<"Address", 'String'>
    readonly taxOffice: FieldRef<"Address", 'String'>
    readonly taxId: FieldRef<"Address", 'String'>
    readonly createdAt: FieldRef<"Address", 'DateTime'>
    readonly updatedAt: FieldRef<"Address", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Address findUnique
   */
  export type AddressFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter, which Address to fetch.
     */
    where: AddressWhereUniqueInput
  }

  /**
   * Address findUniqueOrThrow
   */
  export type AddressFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter, which Address to fetch.
     */
    where: AddressWhereUniqueInput
  }

  /**
   * Address findFirst
   */
  export type AddressFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter, which Address to fetch.
     */
    where?: AddressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Addresses to fetch.
     */
    orderBy?: AddressOrderByWithRelationInput | AddressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Addresses.
     */
    cursor?: AddressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Addresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Addresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Addresses.
     */
    distinct?: AddressScalarFieldEnum | AddressScalarFieldEnum[]
  }

  /**
   * Address findFirstOrThrow
   */
  export type AddressFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter, which Address to fetch.
     */
    where?: AddressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Addresses to fetch.
     */
    orderBy?: AddressOrderByWithRelationInput | AddressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Addresses.
     */
    cursor?: AddressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Addresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Addresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Addresses.
     */
    distinct?: AddressScalarFieldEnum | AddressScalarFieldEnum[]
  }

  /**
   * Address findMany
   */
  export type AddressFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter, which Addresses to fetch.
     */
    where?: AddressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Addresses to fetch.
     */
    orderBy?: AddressOrderByWithRelationInput | AddressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Addresses.
     */
    cursor?: AddressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Addresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Addresses.
     */
    skip?: number
    distinct?: AddressScalarFieldEnum | AddressScalarFieldEnum[]
  }

  /**
   * Address create
   */
  export type AddressCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * The data needed to create a Address.
     */
    data: XOR<AddressCreateInput, AddressUncheckedCreateInput>
  }

  /**
   * Address createMany
   */
  export type AddressCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Addresses.
     */
    data: AddressCreateManyInput | AddressCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Address createManyAndReturn
   */
  export type AddressCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * The data used to create many Addresses.
     */
    data: AddressCreateManyInput | AddressCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Address update
   */
  export type AddressUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * The data needed to update a Address.
     */
    data: XOR<AddressUpdateInput, AddressUncheckedUpdateInput>
    /**
     * Choose, which Address to update.
     */
    where: AddressWhereUniqueInput
  }

  /**
   * Address updateMany
   */
  export type AddressUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Addresses.
     */
    data: XOR<AddressUpdateManyMutationInput, AddressUncheckedUpdateManyInput>
    /**
     * Filter which Addresses to update
     */
    where?: AddressWhereInput
    /**
     * Limit how many Addresses to update.
     */
    limit?: number
  }

  /**
   * Address updateManyAndReturn
   */
  export type AddressUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * The data used to update Addresses.
     */
    data: XOR<AddressUpdateManyMutationInput, AddressUncheckedUpdateManyInput>
    /**
     * Filter which Addresses to update
     */
    where?: AddressWhereInput
    /**
     * Limit how many Addresses to update.
     */
    limit?: number
  }

  /**
   * Address upsert
   */
  export type AddressUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * The filter to search for the Address to update in case it exists.
     */
    where: AddressWhereUniqueInput
    /**
     * In case the Address found by the `where` argument doesn't exist, create a new Address with this data.
     */
    create: XOR<AddressCreateInput, AddressUncheckedCreateInput>
    /**
     * In case the Address was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AddressUpdateInput, AddressUncheckedUpdateInput>
  }

  /**
   * Address delete
   */
  export type AddressDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
    /**
     * Filter which Address to delete.
     */
    where: AddressWhereUniqueInput
  }

  /**
   * Address deleteMany
   */
  export type AddressDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Addresses to delete
     */
    where?: AddressWhereInput
    /**
     * Limit how many Addresses to delete.
     */
    limit?: number
  }

  /**
   * Address.billingOrders
   */
  export type Address$billingOrdersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Address without action
   */
  export type AddressDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Address
     */
    select?: AddressSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Address
     */
    omit?: AddressOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AddressInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const UserScalarFieldEnum: {
    userId: 'userId',
    email: 'email',
    phone: 'phone',
    password: 'password',
    name: 'name',
    lastName: 'lastName',
    userRole: 'userRole',
    userStatus: 'userStatus',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt',
    profilePicture: 'profilePicture',
    otpMethods: 'otpMethods',
    otpSecret: 'otpSecret',
    userNationalityId: 'userNationalityId',
    userNationalityCountry: 'userNationalityCountry'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const UserSessionScalarFieldEnum: {
    userSessionId: 'userSessionId',
    userId: 'userId',
    accessToken: 'accessToken',
    refreshToken: 'refreshToken',
    sessionExpiry: 'sessionExpiry',
    otpVerifyNeeded: 'otpVerifyNeeded',
    otpVerifiedAt: 'otpVerifiedAt',
    ip: 'ip',
    os: 'os',
    device: 'device',
    browser: 'browser',
    city: 'city',
    state: 'state',
    country: 'country',
    deviceFingerprint: 'deviceFingerprint',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserSessionScalarFieldEnum = (typeof UserSessionScalarFieldEnum)[keyof typeof UserSessionScalarFieldEnum]


  export const UserSocialAccountScalarFieldEnum: {
    userSocialAccountId: 'userSocialAccountId',
    userId: 'userId',
    provider: 'provider',
    providerId: 'providerId',
    accessToken: 'accessToken',
    refreshToken: 'refreshToken',
    tokenExpiry: 'tokenExpiry',
    profilePicture: 'profilePicture',
    profileUrl: 'profileUrl',
    scopes: 'scopes',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserSocialAccountScalarFieldEnum = (typeof UserSocialAccountScalarFieldEnum)[keyof typeof UserSocialAccountScalarFieldEnum]


  export const TenantScalarFieldEnum: {
    tenantId: 'tenantId',
    name: 'name',
    description: 'description',
    tenantStatus: 'tenantStatus',
    domain: 'domain',
    region: 'region',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt'
  };

  export type TenantScalarFieldEnum = (typeof TenantScalarFieldEnum)[keyof typeof TenantScalarFieldEnum]


  export const TenantUserScalarFieldEnum: {
    tenantUserId: 'tenantUserId',
    tenantId: 'tenantId',
    userId: 'userId',
    tenantUserRole: 'tenantUserRole',
    tenantUserStatus: 'tenantUserStatus',
    userSessionId: 'userSessionId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    deletedAt: 'deletedAt'
  };

  export type TenantUserScalarFieldEnum = (typeof TenantUserScalarFieldEnum)[keyof typeof TenantUserScalarFieldEnum]


  export const SettingsScalarFieldEnum: {
    tenantSettingId: 'tenantSettingId',
    tenantId: 'tenantId',
    key: 'key',
    value: 'value'
  };

  export type SettingsScalarFieldEnum = (typeof SettingsScalarFieldEnum)[keyof typeof SettingsScalarFieldEnum]


  export const SubscriptionPriceScalarFieldEnum: {
    subscriptionPriceId: 'subscriptionPriceId',
    default: 'default',
    region: 'region',
    currency: 'currency',
    price: 'price',
    methods: 'methods',
    subscriptionPlanId: 'subscriptionPlanId',
    iyzicoPricingPlanRefId: 'iyzicoPricingPlanRefId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    cancelledAt: 'cancelledAt'
  };

  export type SubscriptionPriceScalarFieldEnum = (typeof SubscriptionPriceScalarFieldEnum)[keyof typeof SubscriptionPriceScalarFieldEnum]


  export const SubscriptionPlanScalarFieldEnum: {
    subscriptionPlanId: 'subscriptionPlanId',
    name: 'name',
    description: 'description',
    billingCycle: 'billingCycle',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type SubscriptionPlanScalarFieldEnum = (typeof SubscriptionPlanScalarFieldEnum)[keyof typeof SubscriptionPlanScalarFieldEnum]


  export const SubscriptionScalarFieldEnum: {
    subscriptionId: 'subscriptionId',
    stripePaymentIntentId: 'stripePaymentIntentId',
    stripePaymentIntentStatus: 'stripePaymentIntentStatus',
    stripePaymentIntentClientSecret: 'stripePaymentIntentClientSecret',
    paypalOrderId: 'paypalOrderId',
    paypalApprovalUrl: 'paypalApprovalUrl',
    paypalCaptureId: 'paypalCaptureId',
    iyzicoPaymentId: 'iyzicoPaymentId',
    iyzicoToken: 'iyzicoToken',
    subscriptionPlanId: 'subscriptionPlanId',
    subscriptionPriceId: 'subscriptionPriceId',
    discountCode: 'discountCode',
    discountAmount: 'discountAmount',
    taxRate: 'taxRate',
    taxAmount: 'taxAmount',
    paidPrice: 'paidPrice',
    currency: 'currency',
    subscriptionStatus: 'subscriptionStatus',
    paymentMethod: 'paymentMethod',
    createdAt: 'createdAt',
    paidAt: 'paidAt',
    cancelledAt: 'cancelledAt',
    refundedAt: 'refundedAt',
    billingAddressId: 'billingAddressId',
    tenantId: 'tenantId'
  };

  export type SubscriptionScalarFieldEnum = (typeof SubscriptionScalarFieldEnum)[keyof typeof SubscriptionScalarFieldEnum]


  export const AddressScalarFieldEnum: {
    addressId: 'addressId',
    tenantId: 'tenantId',
    addressIntents: 'addressIntents',
    addressType: 'addressType',
    name: 'name',
    addressLine1: 'addressLine1',
    addressLine2: 'addressLine2',
    city: 'city',
    state: 'state',
    country: 'country',
    zipCode: 'zipCode',
    phoneNumber: 'phoneNumber',
    email: 'email',
    firstName: 'firstName',
    lastName: 'lastName',
    taxOffice: 'taxOffice',
    taxId: 'taxId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type AddressScalarFieldEnum = (typeof AddressScalarFieldEnum)[keyof typeof AddressScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'UserRole'
   */
  export type EnumUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserRole'>
    


  /**
   * Reference to a field of type 'UserRole[]'
   */
  export type ListEnumUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserRole[]'>
    


  /**
   * Reference to a field of type 'UserStatus'
   */
  export type EnumUserStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserStatus'>
    


  /**
   * Reference to a field of type 'UserStatus[]'
   */
  export type ListEnumUserStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'UserStatus[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'OTPMethod[]'
   */
  export type ListEnumOTPMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OTPMethod[]'>
    


  /**
   * Reference to a field of type 'OTPMethod'
   */
  export type EnumOTPMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OTPMethod'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'TenantStatus'
   */
  export type EnumTenantStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantStatus'>
    


  /**
   * Reference to a field of type 'TenantStatus[]'
   */
  export type ListEnumTenantStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantStatus[]'>
    


  /**
   * Reference to a field of type 'TenantUserRole'
   */
  export type EnumTenantUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantUserRole'>
    


  /**
   * Reference to a field of type 'TenantUserRole[]'
   */
  export type ListEnumTenantUserRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantUserRole[]'>
    


  /**
   * Reference to a field of type 'TenantUserStatus'
   */
  export type EnumTenantUserStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantUserStatus'>
    


  /**
   * Reference to a field of type 'TenantUserStatus[]'
   */
  export type ListEnumTenantUserStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TenantUserStatus[]'>
    


  /**
   * Reference to a field of type 'Currency'
   */
  export type EnumCurrencyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Currency'>
    


  /**
   * Reference to a field of type 'Currency[]'
   */
  export type ListEnumCurrencyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Currency[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'PaymentMethod[]'
   */
  export type ListEnumPaymentMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentMethod[]'>
    


  /**
   * Reference to a field of type 'PaymentMethod'
   */
  export type EnumPaymentMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PaymentMethod'>
    


  /**
   * Reference to a field of type 'SubscriptionBillingCycle'
   */
  export type EnumSubscriptionBillingCycleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionBillingCycle'>
    


  /**
   * Reference to a field of type 'SubscriptionBillingCycle[]'
   */
  export type ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionBillingCycle[]'>
    


  /**
   * Reference to a field of type 'SubscriptionStatus'
   */
  export type EnumSubscriptionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionStatus'>
    


  /**
   * Reference to a field of type 'SubscriptionStatus[]'
   */
  export type ListEnumSubscriptionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionStatus[]'>
    


  /**
   * Reference to a field of type 'AddressIntent[]'
   */
  export type ListEnumAddressIntentFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AddressIntent[]'>
    


  /**
   * Reference to a field of type 'AddressIntent'
   */
  export type EnumAddressIntentFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AddressIntent'>
    


  /**
   * Reference to a field of type 'AddressType'
   */
  export type EnumAddressTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AddressType'>
    


  /**
   * Reference to a field of type 'AddressType[]'
   */
  export type ListEnumAddressTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AddressType[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    
  /**
   * Deep Input Types
   */


  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    userId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    phone?: StringNullableFilter<"User"> | string | null
    password?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    lastName?: StringNullableFilter<"User"> | string | null
    userRole?: EnumUserRoleFilter<"User"> | $Enums.UserRole
    userStatus?: EnumUserStatusFilter<"User"> | $Enums.UserStatus
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    deletedAt?: DateTimeNullableFilter<"User"> | Date | string | null
    profilePicture?: StringNullableFilter<"User"> | string | null
    otpMethods?: EnumOTPMethodNullableListFilter<"User">
    otpSecret?: StringNullableFilter<"User"> | string | null
    userNationalityId?: StringNullableFilter<"User"> | string | null
    userNationalityCountry?: StringNullableFilter<"User"> | string | null
    userSessions?: UserSessionListRelationFilter
    userSocialAccounts?: UserSocialAccountListRelationFilter
    tenantUsers?: TenantUserListRelationFilter
  }

  export type UserOrderByWithRelationInput = {
    userId?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    password?: SortOrder
    name?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    userRole?: SortOrder
    userStatus?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    profilePicture?: SortOrderInput | SortOrder
    otpMethods?: SortOrder
    otpSecret?: SortOrderInput | SortOrder
    userNationalityId?: SortOrderInput | SortOrder
    userNationalityCountry?: SortOrderInput | SortOrder
    userSessions?: UserSessionOrderByRelationAggregateInput
    userSocialAccounts?: UserSocialAccountOrderByRelationAggregateInput
    tenantUsers?: TenantUserOrderByRelationAggregateInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    userId?: string
    email?: string
    phone?: string
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    password?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    lastName?: StringNullableFilter<"User"> | string | null
    userRole?: EnumUserRoleFilter<"User"> | $Enums.UserRole
    userStatus?: EnumUserStatusFilter<"User"> | $Enums.UserStatus
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    deletedAt?: DateTimeNullableFilter<"User"> | Date | string | null
    profilePicture?: StringNullableFilter<"User"> | string | null
    otpMethods?: EnumOTPMethodNullableListFilter<"User">
    otpSecret?: StringNullableFilter<"User"> | string | null
    userNationalityId?: StringNullableFilter<"User"> | string | null
    userNationalityCountry?: StringNullableFilter<"User"> | string | null
    userSessions?: UserSessionListRelationFilter
    userSocialAccounts?: UserSocialAccountListRelationFilter
    tenantUsers?: TenantUserListRelationFilter
  }, "userId" | "email" | "phone">

  export type UserOrderByWithAggregationInput = {
    userId?: SortOrder
    email?: SortOrder
    phone?: SortOrderInput | SortOrder
    password?: SortOrder
    name?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    userRole?: SortOrder
    userStatus?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    profilePicture?: SortOrderInput | SortOrder
    otpMethods?: SortOrder
    otpSecret?: SortOrderInput | SortOrder
    userNationalityId?: SortOrderInput | SortOrder
    userNationalityCountry?: SortOrderInput | SortOrder
    _count?: UserCountOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    userId?: StringWithAggregatesFilter<"User"> | string
    email?: StringWithAggregatesFilter<"User"> | string
    phone?: StringNullableWithAggregatesFilter<"User"> | string | null
    password?: StringWithAggregatesFilter<"User"> | string
    name?: StringNullableWithAggregatesFilter<"User"> | string | null
    lastName?: StringNullableWithAggregatesFilter<"User"> | string | null
    userRole?: EnumUserRoleWithAggregatesFilter<"User"> | $Enums.UserRole
    userStatus?: EnumUserStatusWithAggregatesFilter<"User"> | $Enums.UserStatus
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    deletedAt?: DateTimeNullableWithAggregatesFilter<"User"> | Date | string | null
    profilePicture?: StringNullableWithAggregatesFilter<"User"> | string | null
    otpMethods?: EnumOTPMethodNullableListFilter<"User">
    otpSecret?: StringNullableWithAggregatesFilter<"User"> | string | null
    userNationalityId?: StringNullableWithAggregatesFilter<"User"> | string | null
    userNationalityCountry?: StringNullableWithAggregatesFilter<"User"> | string | null
  }

  export type UserSessionWhereInput = {
    AND?: UserSessionWhereInput | UserSessionWhereInput[]
    OR?: UserSessionWhereInput[]
    NOT?: UserSessionWhereInput | UserSessionWhereInput[]
    userSessionId?: StringFilter<"UserSession"> | string
    userId?: StringFilter<"UserSession"> | string
    accessToken?: StringFilter<"UserSession"> | string
    refreshToken?: StringFilter<"UserSession"> | string
    sessionExpiry?: DateTimeFilter<"UserSession"> | Date | string
    otpVerifyNeeded?: BoolFilter<"UserSession"> | boolean
    otpVerifiedAt?: DateTimeNullableFilter<"UserSession"> | Date | string | null
    ip?: StringNullableFilter<"UserSession"> | string | null
    os?: StringNullableFilter<"UserSession"> | string | null
    device?: StringNullableFilter<"UserSession"> | string | null
    browser?: StringNullableFilter<"UserSession"> | string | null
    city?: StringNullableFilter<"UserSession"> | string | null
    state?: StringNullableFilter<"UserSession"> | string | null
    country?: StringNullableFilter<"UserSession"> | string | null
    deviceFingerprint?: StringNullableFilter<"UserSession"> | string | null
    createdAt?: DateTimeFilter<"UserSession"> | Date | string
    updatedAt?: DateTimeFilter<"UserSession"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }

  export type UserSessionOrderByWithRelationInput = {
    userSessionId?: SortOrder
    userId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    sessionExpiry?: SortOrder
    otpVerifyNeeded?: SortOrder
    otpVerifiedAt?: SortOrderInput | SortOrder
    ip?: SortOrderInput | SortOrder
    os?: SortOrderInput | SortOrder
    device?: SortOrderInput | SortOrder
    browser?: SortOrderInput | SortOrder
    city?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrderInput | SortOrder
    deviceFingerprint?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    user?: UserOrderByWithRelationInput
  }

  export type UserSessionWhereUniqueInput = Prisma.AtLeast<{
    userSessionId?: string
    accessToken?: string
    refreshToken?: string
    AND?: UserSessionWhereInput | UserSessionWhereInput[]
    OR?: UserSessionWhereInput[]
    NOT?: UserSessionWhereInput | UserSessionWhereInput[]
    userId?: StringFilter<"UserSession"> | string
    sessionExpiry?: DateTimeFilter<"UserSession"> | Date | string
    otpVerifyNeeded?: BoolFilter<"UserSession"> | boolean
    otpVerifiedAt?: DateTimeNullableFilter<"UserSession"> | Date | string | null
    ip?: StringNullableFilter<"UserSession"> | string | null
    os?: StringNullableFilter<"UserSession"> | string | null
    device?: StringNullableFilter<"UserSession"> | string | null
    browser?: StringNullableFilter<"UserSession"> | string | null
    city?: StringNullableFilter<"UserSession"> | string | null
    state?: StringNullableFilter<"UserSession"> | string | null
    country?: StringNullableFilter<"UserSession"> | string | null
    deviceFingerprint?: StringNullableFilter<"UserSession"> | string | null
    createdAt?: DateTimeFilter<"UserSession"> | Date | string
    updatedAt?: DateTimeFilter<"UserSession"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }, "userSessionId" | "accessToken" | "refreshToken">

  export type UserSessionOrderByWithAggregationInput = {
    userSessionId?: SortOrder
    userId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    sessionExpiry?: SortOrder
    otpVerifyNeeded?: SortOrder
    otpVerifiedAt?: SortOrderInput | SortOrder
    ip?: SortOrderInput | SortOrder
    os?: SortOrderInput | SortOrder
    device?: SortOrderInput | SortOrder
    browser?: SortOrderInput | SortOrder
    city?: SortOrderInput | SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrderInput | SortOrder
    deviceFingerprint?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserSessionCountOrderByAggregateInput
    _max?: UserSessionMaxOrderByAggregateInput
    _min?: UserSessionMinOrderByAggregateInput
  }

  export type UserSessionScalarWhereWithAggregatesInput = {
    AND?: UserSessionScalarWhereWithAggregatesInput | UserSessionScalarWhereWithAggregatesInput[]
    OR?: UserSessionScalarWhereWithAggregatesInput[]
    NOT?: UserSessionScalarWhereWithAggregatesInput | UserSessionScalarWhereWithAggregatesInput[]
    userSessionId?: StringWithAggregatesFilter<"UserSession"> | string
    userId?: StringWithAggregatesFilter<"UserSession"> | string
    accessToken?: StringWithAggregatesFilter<"UserSession"> | string
    refreshToken?: StringWithAggregatesFilter<"UserSession"> | string
    sessionExpiry?: DateTimeWithAggregatesFilter<"UserSession"> | Date | string
    otpVerifyNeeded?: BoolWithAggregatesFilter<"UserSession"> | boolean
    otpVerifiedAt?: DateTimeNullableWithAggregatesFilter<"UserSession"> | Date | string | null
    ip?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    os?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    device?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    browser?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    city?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    state?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    country?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    deviceFingerprint?: StringNullableWithAggregatesFilter<"UserSession"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"UserSession"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"UserSession"> | Date | string
  }

  export type UserSocialAccountWhereInput = {
    AND?: UserSocialAccountWhereInput | UserSocialAccountWhereInput[]
    OR?: UserSocialAccountWhereInput[]
    NOT?: UserSocialAccountWhereInput | UserSocialAccountWhereInput[]
    userSocialAccountId?: StringFilter<"UserSocialAccount"> | string
    userId?: StringFilter<"UserSocialAccount"> | string
    provider?: StringFilter<"UserSocialAccount"> | string
    providerId?: StringFilter<"UserSocialAccount"> | string
    accessToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    refreshToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    tokenExpiry?: DateTimeNullableFilter<"UserSocialAccount"> | Date | string | null
    profilePicture?: StringNullableFilter<"UserSocialAccount"> | string | null
    profileUrl?: StringNullableFilter<"UserSocialAccount"> | string | null
    scopes?: StringNullableFilter<"UserSocialAccount"> | string | null
    createdAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
    updatedAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }

  export type UserSocialAccountOrderByWithRelationInput = {
    userSocialAccountId?: SortOrder
    userId?: SortOrder
    provider?: SortOrder
    providerId?: SortOrder
    accessToken?: SortOrderInput | SortOrder
    refreshToken?: SortOrderInput | SortOrder
    tokenExpiry?: SortOrderInput | SortOrder
    profilePicture?: SortOrderInput | SortOrder
    profileUrl?: SortOrderInput | SortOrder
    scopes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    user?: UserOrderByWithRelationInput
  }

  export type UserSocialAccountWhereUniqueInput = Prisma.AtLeast<{
    userSocialAccountId?: string
    providerId?: string
    AND?: UserSocialAccountWhereInput | UserSocialAccountWhereInput[]
    OR?: UserSocialAccountWhereInput[]
    NOT?: UserSocialAccountWhereInput | UserSocialAccountWhereInput[]
    userId?: StringFilter<"UserSocialAccount"> | string
    provider?: StringFilter<"UserSocialAccount"> | string
    accessToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    refreshToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    tokenExpiry?: DateTimeNullableFilter<"UserSocialAccount"> | Date | string | null
    profilePicture?: StringNullableFilter<"UserSocialAccount"> | string | null
    profileUrl?: StringNullableFilter<"UserSocialAccount"> | string | null
    scopes?: StringNullableFilter<"UserSocialAccount"> | string | null
    createdAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
    updatedAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }, "userSocialAccountId" | "providerId">

  export type UserSocialAccountOrderByWithAggregationInput = {
    userSocialAccountId?: SortOrder
    userId?: SortOrder
    provider?: SortOrder
    providerId?: SortOrder
    accessToken?: SortOrderInput | SortOrder
    refreshToken?: SortOrderInput | SortOrder
    tokenExpiry?: SortOrderInput | SortOrder
    profilePicture?: SortOrderInput | SortOrder
    profileUrl?: SortOrderInput | SortOrder
    scopes?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserSocialAccountCountOrderByAggregateInput
    _max?: UserSocialAccountMaxOrderByAggregateInput
    _min?: UserSocialAccountMinOrderByAggregateInput
  }

  export type UserSocialAccountScalarWhereWithAggregatesInput = {
    AND?: UserSocialAccountScalarWhereWithAggregatesInput | UserSocialAccountScalarWhereWithAggregatesInput[]
    OR?: UserSocialAccountScalarWhereWithAggregatesInput[]
    NOT?: UserSocialAccountScalarWhereWithAggregatesInput | UserSocialAccountScalarWhereWithAggregatesInput[]
    userSocialAccountId?: StringWithAggregatesFilter<"UserSocialAccount"> | string
    userId?: StringWithAggregatesFilter<"UserSocialAccount"> | string
    provider?: StringWithAggregatesFilter<"UserSocialAccount"> | string
    providerId?: StringWithAggregatesFilter<"UserSocialAccount"> | string
    accessToken?: StringNullableWithAggregatesFilter<"UserSocialAccount"> | string | null
    refreshToken?: StringNullableWithAggregatesFilter<"UserSocialAccount"> | string | null
    tokenExpiry?: DateTimeNullableWithAggregatesFilter<"UserSocialAccount"> | Date | string | null
    profilePicture?: StringNullableWithAggregatesFilter<"UserSocialAccount"> | string | null
    profileUrl?: StringNullableWithAggregatesFilter<"UserSocialAccount"> | string | null
    scopes?: StringNullableWithAggregatesFilter<"UserSocialAccount"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"UserSocialAccount"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"UserSocialAccount"> | Date | string
  }

  export type TenantWhereInput = {
    AND?: TenantWhereInput | TenantWhereInput[]
    OR?: TenantWhereInput[]
    NOT?: TenantWhereInput | TenantWhereInput[]
    tenantId?: StringFilter<"Tenant"> | string
    name?: StringFilter<"Tenant"> | string
    description?: StringNullableFilter<"Tenant"> | string | null
    tenantStatus?: EnumTenantStatusFilter<"Tenant"> | $Enums.TenantStatus
    domain?: StringFilter<"Tenant"> | string
    region?: StringFilter<"Tenant"> | string
    createdAt?: DateTimeFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeFilter<"Tenant"> | Date | string
    deletedAt?: DateTimeNullableFilter<"Tenant"> | Date | string | null
    tenantUsers?: TenantUserListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }

  export type TenantOrderByWithRelationInput = {
    tenantId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    tenantStatus?: SortOrder
    domain?: SortOrder
    region?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    tenantUsers?: TenantUserOrderByRelationAggregateInput
    subscriptions?: SubscriptionOrderByRelationAggregateInput
  }

  export type TenantWhereUniqueInput = Prisma.AtLeast<{
    tenantId?: string
    AND?: TenantWhereInput | TenantWhereInput[]
    OR?: TenantWhereInput[]
    NOT?: TenantWhereInput | TenantWhereInput[]
    name?: StringFilter<"Tenant"> | string
    description?: StringNullableFilter<"Tenant"> | string | null
    tenantStatus?: EnumTenantStatusFilter<"Tenant"> | $Enums.TenantStatus
    domain?: StringFilter<"Tenant"> | string
    region?: StringFilter<"Tenant"> | string
    createdAt?: DateTimeFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeFilter<"Tenant"> | Date | string
    deletedAt?: DateTimeNullableFilter<"Tenant"> | Date | string | null
    tenantUsers?: TenantUserListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }, "tenantId">

  export type TenantOrderByWithAggregationInput = {
    tenantId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    tenantStatus?: SortOrder
    domain?: SortOrder
    region?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    _count?: TenantCountOrderByAggregateInput
    _max?: TenantMaxOrderByAggregateInput
    _min?: TenantMinOrderByAggregateInput
  }

  export type TenantScalarWhereWithAggregatesInput = {
    AND?: TenantScalarWhereWithAggregatesInput | TenantScalarWhereWithAggregatesInput[]
    OR?: TenantScalarWhereWithAggregatesInput[]
    NOT?: TenantScalarWhereWithAggregatesInput | TenantScalarWhereWithAggregatesInput[]
    tenantId?: StringWithAggregatesFilter<"Tenant"> | string
    name?: StringWithAggregatesFilter<"Tenant"> | string
    description?: StringNullableWithAggregatesFilter<"Tenant"> | string | null
    tenantStatus?: EnumTenantStatusWithAggregatesFilter<"Tenant"> | $Enums.TenantStatus
    domain?: StringWithAggregatesFilter<"Tenant"> | string
    region?: StringWithAggregatesFilter<"Tenant"> | string
    createdAt?: DateTimeWithAggregatesFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Tenant"> | Date | string
    deletedAt?: DateTimeNullableWithAggregatesFilter<"Tenant"> | Date | string | null
  }

  export type TenantUserWhereInput = {
    AND?: TenantUserWhereInput | TenantUserWhereInput[]
    OR?: TenantUserWhereInput[]
    NOT?: TenantUserWhereInput | TenantUserWhereInput[]
    tenantUserId?: StringFilter<"TenantUser"> | string
    tenantId?: StringFilter<"TenantUser"> | string
    userId?: StringFilter<"TenantUser"> | string
    tenantUserRole?: EnumTenantUserRoleFilter<"TenantUser"> | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFilter<"TenantUser"> | $Enums.TenantUserStatus
    userSessionId?: StringNullableFilter<"TenantUser"> | string | null
    createdAt?: DateTimeFilter<"TenantUser"> | Date | string
    updatedAt?: DateTimeFilter<"TenantUser"> | Date | string
    deletedAt?: DateTimeNullableFilter<"TenantUser"> | Date | string | null
    tenant?: XOR<TenantScalarRelationFilter, TenantWhereInput>
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }

  export type TenantUserOrderByWithRelationInput = {
    tenantUserId?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    tenantUserRole?: SortOrder
    tenantUserStatus?: SortOrder
    userSessionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    tenant?: TenantOrderByWithRelationInput
    user?: UserOrderByWithRelationInput
  }

  export type TenantUserWhereUniqueInput = Prisma.AtLeast<{
    tenantUserId?: string
    userSessionId?: string
    AND?: TenantUserWhereInput | TenantUserWhereInput[]
    OR?: TenantUserWhereInput[]
    NOT?: TenantUserWhereInput | TenantUserWhereInput[]
    tenantId?: StringFilter<"TenantUser"> | string
    userId?: StringFilter<"TenantUser"> | string
    tenantUserRole?: EnumTenantUserRoleFilter<"TenantUser"> | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFilter<"TenantUser"> | $Enums.TenantUserStatus
    createdAt?: DateTimeFilter<"TenantUser"> | Date | string
    updatedAt?: DateTimeFilter<"TenantUser"> | Date | string
    deletedAt?: DateTimeNullableFilter<"TenantUser"> | Date | string | null
    tenant?: XOR<TenantScalarRelationFilter, TenantWhereInput>
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
  }, "tenantUserId" | "userSessionId">

  export type TenantUserOrderByWithAggregationInput = {
    tenantUserId?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    tenantUserRole?: SortOrder
    tenantUserStatus?: SortOrder
    userSessionId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrderInput | SortOrder
    _count?: TenantUserCountOrderByAggregateInput
    _max?: TenantUserMaxOrderByAggregateInput
    _min?: TenantUserMinOrderByAggregateInput
  }

  export type TenantUserScalarWhereWithAggregatesInput = {
    AND?: TenantUserScalarWhereWithAggregatesInput | TenantUserScalarWhereWithAggregatesInput[]
    OR?: TenantUserScalarWhereWithAggregatesInput[]
    NOT?: TenantUserScalarWhereWithAggregatesInput | TenantUserScalarWhereWithAggregatesInput[]
    tenantUserId?: StringWithAggregatesFilter<"TenantUser"> | string
    tenantId?: StringWithAggregatesFilter<"TenantUser"> | string
    userId?: StringWithAggregatesFilter<"TenantUser"> | string
    tenantUserRole?: EnumTenantUserRoleWithAggregatesFilter<"TenantUser"> | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusWithAggregatesFilter<"TenantUser"> | $Enums.TenantUserStatus
    userSessionId?: StringNullableWithAggregatesFilter<"TenantUser"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"TenantUser"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"TenantUser"> | Date | string
    deletedAt?: DateTimeNullableWithAggregatesFilter<"TenantUser"> | Date | string | null
  }

  export type SettingsWhereInput = {
    AND?: SettingsWhereInput | SettingsWhereInput[]
    OR?: SettingsWhereInput[]
    NOT?: SettingsWhereInput | SettingsWhereInput[]
    tenantSettingId?: StringFilter<"Settings"> | string
    tenantId?: StringFilter<"Settings"> | string
    key?: StringFilter<"Settings"> | string
    value?: StringFilter<"Settings"> | string
  }

  export type SettingsOrderByWithRelationInput = {
    tenantSettingId?: SortOrder
    tenantId?: SortOrder
    key?: SortOrder
    value?: SortOrder
  }

  export type SettingsWhereUniqueInput = Prisma.AtLeast<{
    tenantSettingId?: string
    tenantId_key?: SettingsTenantIdKeyCompoundUniqueInput
    AND?: SettingsWhereInput | SettingsWhereInput[]
    OR?: SettingsWhereInput[]
    NOT?: SettingsWhereInput | SettingsWhereInput[]
    tenantId?: StringFilter<"Settings"> | string
    key?: StringFilter<"Settings"> | string
    value?: StringFilter<"Settings"> | string
  }, "tenantSettingId" | "tenantId_key">

  export type SettingsOrderByWithAggregationInput = {
    tenantSettingId?: SortOrder
    tenantId?: SortOrder
    key?: SortOrder
    value?: SortOrder
    _count?: SettingsCountOrderByAggregateInput
    _max?: SettingsMaxOrderByAggregateInput
    _min?: SettingsMinOrderByAggregateInput
  }

  export type SettingsScalarWhereWithAggregatesInput = {
    AND?: SettingsScalarWhereWithAggregatesInput | SettingsScalarWhereWithAggregatesInput[]
    OR?: SettingsScalarWhereWithAggregatesInput[]
    NOT?: SettingsScalarWhereWithAggregatesInput | SettingsScalarWhereWithAggregatesInput[]
    tenantSettingId?: StringWithAggregatesFilter<"Settings"> | string
    tenantId?: StringWithAggregatesFilter<"Settings"> | string
    key?: StringWithAggregatesFilter<"Settings"> | string
    value?: StringWithAggregatesFilter<"Settings"> | string
  }

  export type SubscriptionPriceWhereInput = {
    AND?: SubscriptionPriceWhereInput | SubscriptionPriceWhereInput[]
    OR?: SubscriptionPriceWhereInput[]
    NOT?: SubscriptionPriceWhereInput | SubscriptionPriceWhereInput[]
    subscriptionPriceId?: StringFilter<"SubscriptionPrice"> | string
    default?: BoolFilter<"SubscriptionPrice"> | boolean
    region?: StringNullableListFilter<"SubscriptionPrice">
    currency?: EnumCurrencyFilter<"SubscriptionPrice"> | $Enums.Currency
    price?: FloatFilter<"SubscriptionPrice"> | number
    methods?: EnumPaymentMethodNullableListFilter<"SubscriptionPrice">
    subscriptionPlanId?: StringFilter<"SubscriptionPrice"> | string
    iyzicoPricingPlanRefId?: StringNullableFilter<"SubscriptionPrice"> | string | null
    createdAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    updatedAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    cancelledAt?: DateTimeNullableFilter<"SubscriptionPrice"> | Date | string | null
    subscriptionPlan?: XOR<SubscriptionPlanScalarRelationFilter, SubscriptionPlanWhereInput>
    Subscription?: SubscriptionListRelationFilter
  }

  export type SubscriptionPriceOrderByWithRelationInput = {
    subscriptionPriceId?: SortOrder
    default?: SortOrder
    region?: SortOrder
    currency?: SortOrder
    price?: SortOrder
    methods?: SortOrder
    subscriptionPlanId?: SortOrder
    iyzicoPricingPlanRefId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    cancelledAt?: SortOrderInput | SortOrder
    subscriptionPlan?: SubscriptionPlanOrderByWithRelationInput
    Subscription?: SubscriptionOrderByRelationAggregateInput
  }

  export type SubscriptionPriceWhereUniqueInput = Prisma.AtLeast<{
    subscriptionPriceId?: string
    region_currency?: SubscriptionPriceRegionCurrencyCompoundUniqueInput
    AND?: SubscriptionPriceWhereInput | SubscriptionPriceWhereInput[]
    OR?: SubscriptionPriceWhereInput[]
    NOT?: SubscriptionPriceWhereInput | SubscriptionPriceWhereInput[]
    default?: BoolFilter<"SubscriptionPrice"> | boolean
    region?: StringNullableListFilter<"SubscriptionPrice">
    currency?: EnumCurrencyFilter<"SubscriptionPrice"> | $Enums.Currency
    price?: FloatFilter<"SubscriptionPrice"> | number
    methods?: EnumPaymentMethodNullableListFilter<"SubscriptionPrice">
    subscriptionPlanId?: StringFilter<"SubscriptionPrice"> | string
    iyzicoPricingPlanRefId?: StringNullableFilter<"SubscriptionPrice"> | string | null
    createdAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    updatedAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    cancelledAt?: DateTimeNullableFilter<"SubscriptionPrice"> | Date | string | null
    subscriptionPlan?: XOR<SubscriptionPlanScalarRelationFilter, SubscriptionPlanWhereInput>
    Subscription?: SubscriptionListRelationFilter
  }, "subscriptionPriceId" | "region_currency">

  export type SubscriptionPriceOrderByWithAggregationInput = {
    subscriptionPriceId?: SortOrder
    default?: SortOrder
    region?: SortOrder
    currency?: SortOrder
    price?: SortOrder
    methods?: SortOrder
    subscriptionPlanId?: SortOrder
    iyzicoPricingPlanRefId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    cancelledAt?: SortOrderInput | SortOrder
    _count?: SubscriptionPriceCountOrderByAggregateInput
    _avg?: SubscriptionPriceAvgOrderByAggregateInput
    _max?: SubscriptionPriceMaxOrderByAggregateInput
    _min?: SubscriptionPriceMinOrderByAggregateInput
    _sum?: SubscriptionPriceSumOrderByAggregateInput
  }

  export type SubscriptionPriceScalarWhereWithAggregatesInput = {
    AND?: SubscriptionPriceScalarWhereWithAggregatesInput | SubscriptionPriceScalarWhereWithAggregatesInput[]
    OR?: SubscriptionPriceScalarWhereWithAggregatesInput[]
    NOT?: SubscriptionPriceScalarWhereWithAggregatesInput | SubscriptionPriceScalarWhereWithAggregatesInput[]
    subscriptionPriceId?: StringWithAggregatesFilter<"SubscriptionPrice"> | string
    default?: BoolWithAggregatesFilter<"SubscriptionPrice"> | boolean
    region?: StringNullableListFilter<"SubscriptionPrice">
    currency?: EnumCurrencyWithAggregatesFilter<"SubscriptionPrice"> | $Enums.Currency
    price?: FloatWithAggregatesFilter<"SubscriptionPrice"> | number
    methods?: EnumPaymentMethodNullableListFilter<"SubscriptionPrice">
    subscriptionPlanId?: StringWithAggregatesFilter<"SubscriptionPrice"> | string
    iyzicoPricingPlanRefId?: StringNullableWithAggregatesFilter<"SubscriptionPrice"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"SubscriptionPrice"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"SubscriptionPrice"> | Date | string
    cancelledAt?: DateTimeNullableWithAggregatesFilter<"SubscriptionPrice"> | Date | string | null
  }

  export type SubscriptionPlanWhereInput = {
    AND?: SubscriptionPlanWhereInput | SubscriptionPlanWhereInput[]
    OR?: SubscriptionPlanWhereInput[]
    NOT?: SubscriptionPlanWhereInput | SubscriptionPlanWhereInput[]
    subscriptionPlanId?: StringFilter<"SubscriptionPlan"> | string
    name?: StringFilter<"SubscriptionPlan"> | string
    description?: StringNullableFilter<"SubscriptionPlan"> | string | null
    billingCycle?: EnumSubscriptionBillingCycleFilter<"SubscriptionPlan"> | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFilter<"SubscriptionPlan"> | Date | string
    updatedAt?: DateTimeFilter<"SubscriptionPlan"> | Date | string
    price?: SubscriptionPriceListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }

  export type SubscriptionPlanOrderByWithRelationInput = {
    subscriptionPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    billingCycle?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    price?: SubscriptionPriceOrderByRelationAggregateInput
    subscriptions?: SubscriptionOrderByRelationAggregateInput
  }

  export type SubscriptionPlanWhereUniqueInput = Prisma.AtLeast<{
    subscriptionPlanId?: string
    AND?: SubscriptionPlanWhereInput | SubscriptionPlanWhereInput[]
    OR?: SubscriptionPlanWhereInput[]
    NOT?: SubscriptionPlanWhereInput | SubscriptionPlanWhereInput[]
    name?: StringFilter<"SubscriptionPlan"> | string
    description?: StringNullableFilter<"SubscriptionPlan"> | string | null
    billingCycle?: EnumSubscriptionBillingCycleFilter<"SubscriptionPlan"> | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFilter<"SubscriptionPlan"> | Date | string
    updatedAt?: DateTimeFilter<"SubscriptionPlan"> | Date | string
    price?: SubscriptionPriceListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }, "subscriptionPlanId">

  export type SubscriptionPlanOrderByWithAggregationInput = {
    subscriptionPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    billingCycle?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: SubscriptionPlanCountOrderByAggregateInput
    _max?: SubscriptionPlanMaxOrderByAggregateInput
    _min?: SubscriptionPlanMinOrderByAggregateInput
  }

  export type SubscriptionPlanScalarWhereWithAggregatesInput = {
    AND?: SubscriptionPlanScalarWhereWithAggregatesInput | SubscriptionPlanScalarWhereWithAggregatesInput[]
    OR?: SubscriptionPlanScalarWhereWithAggregatesInput[]
    NOT?: SubscriptionPlanScalarWhereWithAggregatesInput | SubscriptionPlanScalarWhereWithAggregatesInput[]
    subscriptionPlanId?: StringWithAggregatesFilter<"SubscriptionPlan"> | string
    name?: StringWithAggregatesFilter<"SubscriptionPlan"> | string
    description?: StringNullableWithAggregatesFilter<"SubscriptionPlan"> | string | null
    billingCycle?: EnumSubscriptionBillingCycleWithAggregatesFilter<"SubscriptionPlan"> | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeWithAggregatesFilter<"SubscriptionPlan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"SubscriptionPlan"> | Date | string
  }

  export type SubscriptionWhereInput = {
    AND?: SubscriptionWhereInput | SubscriptionWhereInput[]
    OR?: SubscriptionWhereInput[]
    NOT?: SubscriptionWhereInput | SubscriptionWhereInput[]
    subscriptionId?: StringFilter<"Subscription"> | string
    stripePaymentIntentId?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentStatus?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentClientSecret?: StringNullableFilter<"Subscription"> | string | null
    paypalOrderId?: StringNullableFilter<"Subscription"> | string | null
    paypalApprovalUrl?: StringNullableFilter<"Subscription"> | string | null
    paypalCaptureId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoPaymentId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoToken?: StringNullableFilter<"Subscription"> | string | null
    subscriptionPlanId?: StringFilter<"Subscription"> | string
    subscriptionPriceId?: StringFilter<"Subscription"> | string
    discountCode?: StringNullableFilter<"Subscription"> | string | null
    discountAmount?: FloatNullableFilter<"Subscription"> | number | null
    taxRate?: FloatNullableFilter<"Subscription"> | number | null
    taxAmount?: FloatNullableFilter<"Subscription"> | number | null
    paidPrice?: FloatFilter<"Subscription"> | number
    currency?: EnumCurrencyFilter<"Subscription"> | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFilter<"Subscription"> | $Enums.PaymentMethod
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    paidAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    cancelledAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    refundedAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    billingAddressId?: StringNullableFilter<"Subscription"> | string | null
    tenantId?: StringFilter<"Subscription"> | string
    subscriptionPlan?: XOR<SubscriptionPlanScalarRelationFilter, SubscriptionPlanWhereInput>
    subscriptionPrice?: XOR<SubscriptionPriceScalarRelationFilter, SubscriptionPriceWhereInput>
    billingAddress?: XOR<AddressNullableScalarRelationFilter, AddressWhereInput> | null
    tenant?: XOR<TenantScalarRelationFilter, TenantWhereInput>
  }

  export type SubscriptionOrderByWithRelationInput = {
    subscriptionId?: SortOrder
    stripePaymentIntentId?: SortOrderInput | SortOrder
    stripePaymentIntentStatus?: SortOrderInput | SortOrder
    stripePaymentIntentClientSecret?: SortOrderInput | SortOrder
    paypalOrderId?: SortOrderInput | SortOrder
    paypalApprovalUrl?: SortOrderInput | SortOrder
    paypalCaptureId?: SortOrderInput | SortOrder
    iyzicoPaymentId?: SortOrderInput | SortOrder
    iyzicoToken?: SortOrderInput | SortOrder
    subscriptionPlanId?: SortOrder
    subscriptionPriceId?: SortOrder
    discountCode?: SortOrderInput | SortOrder
    discountAmount?: SortOrderInput | SortOrder
    taxRate?: SortOrderInput | SortOrder
    taxAmount?: SortOrderInput | SortOrder
    paidPrice?: SortOrder
    currency?: SortOrder
    subscriptionStatus?: SortOrder
    paymentMethod?: SortOrder
    createdAt?: SortOrder
    paidAt?: SortOrderInput | SortOrder
    cancelledAt?: SortOrderInput | SortOrder
    refundedAt?: SortOrderInput | SortOrder
    billingAddressId?: SortOrderInput | SortOrder
    tenantId?: SortOrder
    subscriptionPlan?: SubscriptionPlanOrderByWithRelationInput
    subscriptionPrice?: SubscriptionPriceOrderByWithRelationInput
    billingAddress?: AddressOrderByWithRelationInput
    tenant?: TenantOrderByWithRelationInput
  }

  export type SubscriptionWhereUniqueInput = Prisma.AtLeast<{
    subscriptionId?: string
    AND?: SubscriptionWhereInput | SubscriptionWhereInput[]
    OR?: SubscriptionWhereInput[]
    NOT?: SubscriptionWhereInput | SubscriptionWhereInput[]
    stripePaymentIntentId?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentStatus?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentClientSecret?: StringNullableFilter<"Subscription"> | string | null
    paypalOrderId?: StringNullableFilter<"Subscription"> | string | null
    paypalApprovalUrl?: StringNullableFilter<"Subscription"> | string | null
    paypalCaptureId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoPaymentId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoToken?: StringNullableFilter<"Subscription"> | string | null
    subscriptionPlanId?: StringFilter<"Subscription"> | string
    subscriptionPriceId?: StringFilter<"Subscription"> | string
    discountCode?: StringNullableFilter<"Subscription"> | string | null
    discountAmount?: FloatNullableFilter<"Subscription"> | number | null
    taxRate?: FloatNullableFilter<"Subscription"> | number | null
    taxAmount?: FloatNullableFilter<"Subscription"> | number | null
    paidPrice?: FloatFilter<"Subscription"> | number
    currency?: EnumCurrencyFilter<"Subscription"> | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFilter<"Subscription"> | $Enums.PaymentMethod
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    paidAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    cancelledAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    refundedAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    billingAddressId?: StringNullableFilter<"Subscription"> | string | null
    tenantId?: StringFilter<"Subscription"> | string
    subscriptionPlan?: XOR<SubscriptionPlanScalarRelationFilter, SubscriptionPlanWhereInput>
    subscriptionPrice?: XOR<SubscriptionPriceScalarRelationFilter, SubscriptionPriceWhereInput>
    billingAddress?: XOR<AddressNullableScalarRelationFilter, AddressWhereInput> | null
    tenant?: XOR<TenantScalarRelationFilter, TenantWhereInput>
  }, "subscriptionId">

  export type SubscriptionOrderByWithAggregationInput = {
    subscriptionId?: SortOrder
    stripePaymentIntentId?: SortOrderInput | SortOrder
    stripePaymentIntentStatus?: SortOrderInput | SortOrder
    stripePaymentIntentClientSecret?: SortOrderInput | SortOrder
    paypalOrderId?: SortOrderInput | SortOrder
    paypalApprovalUrl?: SortOrderInput | SortOrder
    paypalCaptureId?: SortOrderInput | SortOrder
    iyzicoPaymentId?: SortOrderInput | SortOrder
    iyzicoToken?: SortOrderInput | SortOrder
    subscriptionPlanId?: SortOrder
    subscriptionPriceId?: SortOrder
    discountCode?: SortOrderInput | SortOrder
    discountAmount?: SortOrderInput | SortOrder
    taxRate?: SortOrderInput | SortOrder
    taxAmount?: SortOrderInput | SortOrder
    paidPrice?: SortOrder
    currency?: SortOrder
    subscriptionStatus?: SortOrder
    paymentMethod?: SortOrder
    createdAt?: SortOrder
    paidAt?: SortOrderInput | SortOrder
    cancelledAt?: SortOrderInput | SortOrder
    refundedAt?: SortOrderInput | SortOrder
    billingAddressId?: SortOrderInput | SortOrder
    tenantId?: SortOrder
    _count?: SubscriptionCountOrderByAggregateInput
    _avg?: SubscriptionAvgOrderByAggregateInput
    _max?: SubscriptionMaxOrderByAggregateInput
    _min?: SubscriptionMinOrderByAggregateInput
    _sum?: SubscriptionSumOrderByAggregateInput
  }

  export type SubscriptionScalarWhereWithAggregatesInput = {
    AND?: SubscriptionScalarWhereWithAggregatesInput | SubscriptionScalarWhereWithAggregatesInput[]
    OR?: SubscriptionScalarWhereWithAggregatesInput[]
    NOT?: SubscriptionScalarWhereWithAggregatesInput | SubscriptionScalarWhereWithAggregatesInput[]
    subscriptionId?: StringWithAggregatesFilter<"Subscription"> | string
    stripePaymentIntentId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    stripePaymentIntentStatus?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    stripePaymentIntentClientSecret?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    paypalOrderId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    paypalApprovalUrl?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    paypalCaptureId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    iyzicoPaymentId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    iyzicoToken?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    subscriptionPlanId?: StringWithAggregatesFilter<"Subscription"> | string
    subscriptionPriceId?: StringWithAggregatesFilter<"Subscription"> | string
    discountCode?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    discountAmount?: FloatNullableWithAggregatesFilter<"Subscription"> | number | null
    taxRate?: FloatNullableWithAggregatesFilter<"Subscription"> | number | null
    taxAmount?: FloatNullableWithAggregatesFilter<"Subscription"> | number | null
    paidPrice?: FloatWithAggregatesFilter<"Subscription"> | number
    currency?: EnumCurrencyWithAggregatesFilter<"Subscription"> | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusWithAggregatesFilter<"Subscription"> | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodWithAggregatesFilter<"Subscription"> | $Enums.PaymentMethod
    createdAt?: DateTimeWithAggregatesFilter<"Subscription"> | Date | string
    paidAt?: DateTimeNullableWithAggregatesFilter<"Subscription"> | Date | string | null
    cancelledAt?: DateTimeNullableWithAggregatesFilter<"Subscription"> | Date | string | null
    refundedAt?: DateTimeNullableWithAggregatesFilter<"Subscription"> | Date | string | null
    billingAddressId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    tenantId?: StringWithAggregatesFilter<"Subscription"> | string
  }

  export type AddressWhereInput = {
    AND?: AddressWhereInput | AddressWhereInput[]
    OR?: AddressWhereInput[]
    NOT?: AddressWhereInput | AddressWhereInput[]
    addressId?: StringFilter<"Address"> | string
    tenantId?: StringFilter<"Address"> | string
    addressIntents?: EnumAddressIntentNullableListFilter<"Address">
    addressType?: EnumAddressTypeFilter<"Address"> | $Enums.AddressType
    name?: StringFilter<"Address"> | string
    addressLine1?: StringFilter<"Address"> | string
    addressLine2?: StringNullableFilter<"Address"> | string | null
    city?: StringFilter<"Address"> | string
    state?: StringNullableFilter<"Address"> | string | null
    country?: StringFilter<"Address"> | string
    zipCode?: StringNullableFilter<"Address"> | string | null
    phoneNumber?: StringNullableFilter<"Address"> | string | null
    email?: StringNullableFilter<"Address"> | string | null
    firstName?: StringNullableFilter<"Address"> | string | null
    lastName?: StringNullableFilter<"Address"> | string | null
    taxOffice?: StringNullableFilter<"Address"> | string | null
    taxId?: StringNullableFilter<"Address"> | string | null
    createdAt?: DateTimeFilter<"Address"> | Date | string
    updatedAt?: DateTimeFilter<"Address"> | Date | string
    billingOrders?: SubscriptionListRelationFilter
  }

  export type AddressOrderByWithRelationInput = {
    addressId?: SortOrder
    tenantId?: SortOrder
    addressIntents?: SortOrder
    addressType?: SortOrder
    name?: SortOrder
    addressLine1?: SortOrder
    addressLine2?: SortOrderInput | SortOrder
    city?: SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrder
    zipCode?: SortOrderInput | SortOrder
    phoneNumber?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    firstName?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    taxOffice?: SortOrderInput | SortOrder
    taxId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    billingOrders?: SubscriptionOrderByRelationAggregateInput
  }

  export type AddressWhereUniqueInput = Prisma.AtLeast<{
    addressId?: string
    AND?: AddressWhereInput | AddressWhereInput[]
    OR?: AddressWhereInput[]
    NOT?: AddressWhereInput | AddressWhereInput[]
    tenantId?: StringFilter<"Address"> | string
    addressIntents?: EnumAddressIntentNullableListFilter<"Address">
    addressType?: EnumAddressTypeFilter<"Address"> | $Enums.AddressType
    name?: StringFilter<"Address"> | string
    addressLine1?: StringFilter<"Address"> | string
    addressLine2?: StringNullableFilter<"Address"> | string | null
    city?: StringFilter<"Address"> | string
    state?: StringNullableFilter<"Address"> | string | null
    country?: StringFilter<"Address"> | string
    zipCode?: StringNullableFilter<"Address"> | string | null
    phoneNumber?: StringNullableFilter<"Address"> | string | null
    email?: StringNullableFilter<"Address"> | string | null
    firstName?: StringNullableFilter<"Address"> | string | null
    lastName?: StringNullableFilter<"Address"> | string | null
    taxOffice?: StringNullableFilter<"Address"> | string | null
    taxId?: StringNullableFilter<"Address"> | string | null
    createdAt?: DateTimeFilter<"Address"> | Date | string
    updatedAt?: DateTimeFilter<"Address"> | Date | string
    billingOrders?: SubscriptionListRelationFilter
  }, "addressId">

  export type AddressOrderByWithAggregationInput = {
    addressId?: SortOrder
    tenantId?: SortOrder
    addressIntents?: SortOrder
    addressType?: SortOrder
    name?: SortOrder
    addressLine1?: SortOrder
    addressLine2?: SortOrderInput | SortOrder
    city?: SortOrder
    state?: SortOrderInput | SortOrder
    country?: SortOrder
    zipCode?: SortOrderInput | SortOrder
    phoneNumber?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    firstName?: SortOrderInput | SortOrder
    lastName?: SortOrderInput | SortOrder
    taxOffice?: SortOrderInput | SortOrder
    taxId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: AddressCountOrderByAggregateInput
    _max?: AddressMaxOrderByAggregateInput
    _min?: AddressMinOrderByAggregateInput
  }

  export type AddressScalarWhereWithAggregatesInput = {
    AND?: AddressScalarWhereWithAggregatesInput | AddressScalarWhereWithAggregatesInput[]
    OR?: AddressScalarWhereWithAggregatesInput[]
    NOT?: AddressScalarWhereWithAggregatesInput | AddressScalarWhereWithAggregatesInput[]
    addressId?: StringWithAggregatesFilter<"Address"> | string
    tenantId?: StringWithAggregatesFilter<"Address"> | string
    addressIntents?: EnumAddressIntentNullableListFilter<"Address">
    addressType?: EnumAddressTypeWithAggregatesFilter<"Address"> | $Enums.AddressType
    name?: StringWithAggregatesFilter<"Address"> | string
    addressLine1?: StringWithAggregatesFilter<"Address"> | string
    addressLine2?: StringNullableWithAggregatesFilter<"Address"> | string | null
    city?: StringWithAggregatesFilter<"Address"> | string
    state?: StringNullableWithAggregatesFilter<"Address"> | string | null
    country?: StringWithAggregatesFilter<"Address"> | string
    zipCode?: StringNullableWithAggregatesFilter<"Address"> | string | null
    phoneNumber?: StringNullableWithAggregatesFilter<"Address"> | string | null
    email?: StringNullableWithAggregatesFilter<"Address"> | string | null
    firstName?: StringNullableWithAggregatesFilter<"Address"> | string | null
    lastName?: StringNullableWithAggregatesFilter<"Address"> | string | null
    taxOffice?: StringNullableWithAggregatesFilter<"Address"> | string | null
    taxId?: StringNullableWithAggregatesFilter<"Address"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Address"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Address"> | Date | string
  }

  export type UserCreateInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionCreateNestedManyWithoutUserInput
    userSocialAccounts?: UserSocialAccountCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionUncheckedCreateNestedManyWithoutUserInput
    userSocialAccounts?: UserSocialAccountUncheckedCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserUpdateInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUpdateManyWithoutUserNestedInput
    userSocialAccounts?: UserSocialAccountUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUncheckedUpdateManyWithoutUserNestedInput
    userSocialAccounts?: UserSocialAccountUncheckedUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUncheckedUpdateManyWithoutUserNestedInput
  }

  export type UserCreateManyInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
  }

  export type UserUpdateManyMutationInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type UserUncheckedUpdateManyInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type UserSessionCreateInput = {
    userSessionId?: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutUserSessionsInput
  }

  export type UserSessionUncheckedCreateInput = {
    userSessionId?: string
    userId: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSessionUpdateInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutUserSessionsNestedInput
  }

  export type UserSessionUncheckedUpdateInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSessionCreateManyInput = {
    userSessionId?: string
    userId: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSessionUpdateManyMutationInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSessionUncheckedUpdateManyInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountCreateInput = {
    userSocialAccountId?: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutUserSocialAccountsInput
  }

  export type UserSocialAccountUncheckedCreateInput = {
    userSocialAccountId?: string
    userId: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSocialAccountUpdateInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutUserSocialAccountsNestedInput
  }

  export type UserSocialAccountUncheckedUpdateInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountCreateManyInput = {
    userSocialAccountId?: string
    userId: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSocialAccountUpdateManyMutationInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountUncheckedUpdateManyInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TenantCreateInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenantUsers?: TenantUserCreateNestedManyWithoutTenantInput
    subscriptions?: SubscriptionCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenantUsers?: TenantUserUncheckedCreateNestedManyWithoutTenantInput
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantUpdateInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantUsers?: TenantUserUpdateManyWithoutTenantNestedInput
    subscriptions?: SubscriptionUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantUsers?: TenantUserUncheckedUpdateManyWithoutTenantNestedInput
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type TenantCreateManyInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type TenantUpdateManyMutationInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUncheckedUpdateManyInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserCreateInput = {
    tenantUserId?: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenant: TenantCreateNestedOneWithoutTenantUsersInput
    user: UserCreateNestedOneWithoutTenantUsersInput
  }

  export type TenantUserUncheckedCreateInput = {
    tenantUserId?: string
    tenantId: string
    userId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type TenantUserUpdateInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenant?: TenantUpdateOneRequiredWithoutTenantUsersNestedInput
    user?: UserUpdateOneRequiredWithoutTenantUsersNestedInput
  }

  export type TenantUserUncheckedUpdateInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserCreateManyInput = {
    tenantUserId?: string
    tenantId: string
    userId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type TenantUserUpdateManyMutationInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserUncheckedUpdateManyInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SettingsCreateInput = {
    tenantSettingId?: string
    tenantId: string
    key: string
    value: string
  }

  export type SettingsUncheckedCreateInput = {
    tenantSettingId?: string
    tenantId: string
    key: string
    value: string
  }

  export type SettingsUpdateInput = {
    tenantSettingId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
  }

  export type SettingsUncheckedUpdateInput = {
    tenantSettingId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
  }

  export type SettingsCreateManyInput = {
    tenantSettingId?: string
    tenantId: string
    key: string
    value: string
  }

  export type SettingsUpdateManyMutationInput = {
    tenantSettingId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
  }

  export type SettingsUncheckedUpdateManyInput = {
    tenantSettingId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionPriceCreateInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutPriceInput
    Subscription?: SubscriptionCreateNestedManyWithoutSubscriptionPriceInput
  }

  export type SubscriptionPriceUncheckedCreateInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId: string
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
    Subscription?: SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPriceInput
  }

  export type SubscriptionPriceUpdateInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutPriceNestedInput
    Subscription?: SubscriptionUpdateManyWithoutSubscriptionPriceNestedInput
  }

  export type SubscriptionPriceUncheckedUpdateInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    Subscription?: SubscriptionUncheckedUpdateManyWithoutSubscriptionPriceNestedInput
  }

  export type SubscriptionPriceCreateManyInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId: string
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
  }

  export type SubscriptionPriceUpdateManyMutationInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SubscriptionPriceUncheckedUpdateManyInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SubscriptionPlanCreateInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    price?: SubscriptionPriceCreateNestedManyWithoutSubscriptionPlanInput
    subscriptions?: SubscriptionCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanUncheckedCreateInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    price?: SubscriptionPriceUncheckedCreateNestedManyWithoutSubscriptionPlanInput
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanUpdateInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    price?: SubscriptionPriceUpdateManyWithoutSubscriptionPlanNestedInput
    subscriptions?: SubscriptionUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionPlanUncheckedUpdateInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    price?: SubscriptionPriceUncheckedUpdateManyWithoutSubscriptionPlanNestedInput
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionPlanCreateManyInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionPlanUpdateManyMutationInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionPlanUncheckedUpdateManyInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionCreateInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutSubscriptionsInput
    subscriptionPrice: SubscriptionPriceCreateNestedOneWithoutSubscriptionInput
    billingAddress?: AddressCreateNestedOneWithoutBillingOrdersInput
    tenant: TenantCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionUpdateInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutSubscriptionsNestedInput
    subscriptionPrice?: SubscriptionPriceUpdateOneRequiredWithoutSubscriptionNestedInput
    billingAddress?: AddressUpdateOneWithoutBillingOrdersNestedInput
    tenant?: TenantUpdateOneRequiredWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionCreateManyInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionUpdateManyMutationInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SubscriptionUncheckedUpdateManyInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type AddressCreateInput = {
    addressId?: string
    tenantId: string
    addressIntents?: AddressCreateaddressIntentsInput | $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2?: string | null
    city: string
    state?: string | null
    country: string
    zipCode?: string | null
    phoneNumber?: string | null
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    taxOffice?: string | null
    taxId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    billingOrders?: SubscriptionCreateNestedManyWithoutBillingAddressInput
  }

  export type AddressUncheckedCreateInput = {
    addressId?: string
    tenantId: string
    addressIntents?: AddressCreateaddressIntentsInput | $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2?: string | null
    city: string
    state?: string | null
    country: string
    zipCode?: string | null
    phoneNumber?: string | null
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    taxOffice?: string | null
    taxId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    billingOrders?: SubscriptionUncheckedCreateNestedManyWithoutBillingAddressInput
  }

  export type AddressUpdateInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    billingOrders?: SubscriptionUpdateManyWithoutBillingAddressNestedInput
  }

  export type AddressUncheckedUpdateInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    billingOrders?: SubscriptionUncheckedUpdateManyWithoutBillingAddressNestedInput
  }

  export type AddressCreateManyInput = {
    addressId?: string
    tenantId: string
    addressIntents?: AddressCreateaddressIntentsInput | $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2?: string | null
    city: string
    state?: string | null
    country: string
    zipCode?: string | null
    phoneNumber?: string | null
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    taxOffice?: string | null
    taxId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AddressUpdateManyMutationInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AddressUncheckedUpdateManyInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type EnumUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleFilter<$PrismaModel> | $Enums.UserRole
  }

  export type EnumUserStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.UserStatus | EnumUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumUserStatusFilter<$PrismaModel> | $Enums.UserStatus
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type EnumOTPMethodNullableListFilter<$PrismaModel = never> = {
    equals?: $Enums.OTPMethod[] | ListEnumOTPMethodFieldRefInput<$PrismaModel> | null
    has?: $Enums.OTPMethod | EnumOTPMethodFieldRefInput<$PrismaModel> | null
    hasEvery?: $Enums.OTPMethod[] | ListEnumOTPMethodFieldRefInput<$PrismaModel>
    hasSome?: $Enums.OTPMethod[] | ListEnumOTPMethodFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type UserSessionListRelationFilter = {
    every?: UserSessionWhereInput
    some?: UserSessionWhereInput
    none?: UserSessionWhereInput
  }

  export type UserSocialAccountListRelationFilter = {
    every?: UserSocialAccountWhereInput
    some?: UserSocialAccountWhereInput
    none?: UserSocialAccountWhereInput
  }

  export type TenantUserListRelationFilter = {
    every?: TenantUserWhereInput
    some?: TenantUserWhereInput
    none?: TenantUserWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type UserSessionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type UserSocialAccountOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TenantUserOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type UserCountOrderByAggregateInput = {
    userId?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    password?: SortOrder
    name?: SortOrder
    lastName?: SortOrder
    userRole?: SortOrder
    userStatus?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
    profilePicture?: SortOrder
    otpMethods?: SortOrder
    otpSecret?: SortOrder
    userNationalityId?: SortOrder
    userNationalityCountry?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    userId?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    password?: SortOrder
    name?: SortOrder
    lastName?: SortOrder
    userRole?: SortOrder
    userStatus?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
    profilePicture?: SortOrder
    otpSecret?: SortOrder
    userNationalityId?: SortOrder
    userNationalityCountry?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    userId?: SortOrder
    email?: SortOrder
    phone?: SortOrder
    password?: SortOrder
    name?: SortOrder
    lastName?: SortOrder
    userRole?: SortOrder
    userStatus?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
    profilePicture?: SortOrder
    otpSecret?: SortOrder
    userNationalityId?: SortOrder
    userNationalityCountry?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type EnumUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.UserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserRoleFilter<$PrismaModel>
    _max?: NestedEnumUserRoleFilter<$PrismaModel>
  }

  export type EnumUserStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserStatus | EnumUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumUserStatusWithAggregatesFilter<$PrismaModel> | $Enums.UserStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserStatusFilter<$PrismaModel>
    _max?: NestedEnumUserStatusFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type UserScalarRelationFilter = {
    is?: UserWhereInput
    isNot?: UserWhereInput
  }

  export type UserSessionCountOrderByAggregateInput = {
    userSessionId?: SortOrder
    userId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    sessionExpiry?: SortOrder
    otpVerifyNeeded?: SortOrder
    otpVerifiedAt?: SortOrder
    ip?: SortOrder
    os?: SortOrder
    device?: SortOrder
    browser?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    deviceFingerprint?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserSessionMaxOrderByAggregateInput = {
    userSessionId?: SortOrder
    userId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    sessionExpiry?: SortOrder
    otpVerifyNeeded?: SortOrder
    otpVerifiedAt?: SortOrder
    ip?: SortOrder
    os?: SortOrder
    device?: SortOrder
    browser?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    deviceFingerprint?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserSessionMinOrderByAggregateInput = {
    userSessionId?: SortOrder
    userId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    sessionExpiry?: SortOrder
    otpVerifyNeeded?: SortOrder
    otpVerifiedAt?: SortOrder
    ip?: SortOrder
    os?: SortOrder
    device?: SortOrder
    browser?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    deviceFingerprint?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type UserSocialAccountCountOrderByAggregateInput = {
    userSocialAccountId?: SortOrder
    userId?: SortOrder
    provider?: SortOrder
    providerId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    tokenExpiry?: SortOrder
    profilePicture?: SortOrder
    profileUrl?: SortOrder
    scopes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserSocialAccountMaxOrderByAggregateInput = {
    userSocialAccountId?: SortOrder
    userId?: SortOrder
    provider?: SortOrder
    providerId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    tokenExpiry?: SortOrder
    profilePicture?: SortOrder
    profileUrl?: SortOrder
    scopes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserSocialAccountMinOrderByAggregateInput = {
    userSocialAccountId?: SortOrder
    userId?: SortOrder
    provider?: SortOrder
    providerId?: SortOrder
    accessToken?: SortOrder
    refreshToken?: SortOrder
    tokenExpiry?: SortOrder
    profilePicture?: SortOrder
    profileUrl?: SortOrder
    scopes?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumTenantStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantStatus | EnumTenantStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantStatusFilter<$PrismaModel> | $Enums.TenantStatus
  }

  export type SubscriptionListRelationFilter = {
    every?: SubscriptionWhereInput
    some?: SubscriptionWhereInput
    none?: SubscriptionWhereInput
  }

  export type SubscriptionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TenantCountOrderByAggregateInput = {
    tenantId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    tenantStatus?: SortOrder
    domain?: SortOrder
    region?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type TenantMaxOrderByAggregateInput = {
    tenantId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    tenantStatus?: SortOrder
    domain?: SortOrder
    region?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type TenantMinOrderByAggregateInput = {
    tenantId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    tenantStatus?: SortOrder
    domain?: SortOrder
    region?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type EnumTenantStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantStatus | EnumTenantStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantStatusWithAggregatesFilter<$PrismaModel> | $Enums.TenantStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantStatusFilter<$PrismaModel>
    _max?: NestedEnumTenantStatusFilter<$PrismaModel>
  }

  export type EnumTenantUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserRole | EnumTenantUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserRoleFilter<$PrismaModel> | $Enums.TenantUserRole
  }

  export type EnumTenantUserStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserStatus | EnumTenantUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserStatusFilter<$PrismaModel> | $Enums.TenantUserStatus
  }

  export type TenantScalarRelationFilter = {
    is?: TenantWhereInput
    isNot?: TenantWhereInput
  }

  export type TenantUserCountOrderByAggregateInput = {
    tenantUserId?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    tenantUserRole?: SortOrder
    tenantUserStatus?: SortOrder
    userSessionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type TenantUserMaxOrderByAggregateInput = {
    tenantUserId?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    tenantUserRole?: SortOrder
    tenantUserStatus?: SortOrder
    userSessionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type TenantUserMinOrderByAggregateInput = {
    tenantUserId?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    tenantUserRole?: SortOrder
    tenantUserStatus?: SortOrder
    userSessionId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    deletedAt?: SortOrder
  }

  export type EnumTenantUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserRole | EnumTenantUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.TenantUserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantUserRoleFilter<$PrismaModel>
    _max?: NestedEnumTenantUserRoleFilter<$PrismaModel>
  }

  export type EnumTenantUserStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserStatus | EnumTenantUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserStatusWithAggregatesFilter<$PrismaModel> | $Enums.TenantUserStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantUserStatusFilter<$PrismaModel>
    _max?: NestedEnumTenantUserStatusFilter<$PrismaModel>
  }

  export type SettingsTenantIdKeyCompoundUniqueInput = {
    tenantId: string
    key: string
  }

  export type SettingsCountOrderByAggregateInput = {
    tenantSettingId?: SortOrder
    tenantId?: SortOrder
    key?: SortOrder
    value?: SortOrder
  }

  export type SettingsMaxOrderByAggregateInput = {
    tenantSettingId?: SortOrder
    tenantId?: SortOrder
    key?: SortOrder
    value?: SortOrder
  }

  export type SettingsMinOrderByAggregateInput = {
    tenantSettingId?: SortOrder
    tenantId?: SortOrder
    key?: SortOrder
    value?: SortOrder
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type EnumCurrencyFilter<$PrismaModel = never> = {
    equals?: $Enums.Currency | EnumCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumCurrencyFilter<$PrismaModel> | $Enums.Currency
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type EnumPaymentMethodNullableListFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel> | null
    has?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel> | null
    hasEvery?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    hasSome?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type SubscriptionPlanScalarRelationFilter = {
    is?: SubscriptionPlanWhereInput
    isNot?: SubscriptionPlanWhereInput
  }

  export type SubscriptionPriceRegionCurrencyCompoundUniqueInput = {
    region: string[]
    currency: $Enums.Currency
  }

  export type SubscriptionPriceCountOrderByAggregateInput = {
    subscriptionPriceId?: SortOrder
    default?: SortOrder
    region?: SortOrder
    currency?: SortOrder
    price?: SortOrder
    methods?: SortOrder
    subscriptionPlanId?: SortOrder
    iyzicoPricingPlanRefId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    cancelledAt?: SortOrder
  }

  export type SubscriptionPriceAvgOrderByAggregateInput = {
    price?: SortOrder
  }

  export type SubscriptionPriceMaxOrderByAggregateInput = {
    subscriptionPriceId?: SortOrder
    default?: SortOrder
    currency?: SortOrder
    price?: SortOrder
    subscriptionPlanId?: SortOrder
    iyzicoPricingPlanRefId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    cancelledAt?: SortOrder
  }

  export type SubscriptionPriceMinOrderByAggregateInput = {
    subscriptionPriceId?: SortOrder
    default?: SortOrder
    currency?: SortOrder
    price?: SortOrder
    subscriptionPlanId?: SortOrder
    iyzicoPricingPlanRefId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    cancelledAt?: SortOrder
  }

  export type SubscriptionPriceSumOrderByAggregateInput = {
    price?: SortOrder
  }

  export type EnumCurrencyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Currency | EnumCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumCurrencyWithAggregatesFilter<$PrismaModel> | $Enums.Currency
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCurrencyFilter<$PrismaModel>
    _max?: NestedEnumCurrencyFilter<$PrismaModel>
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type EnumSubscriptionBillingCycleFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionBillingCycle | EnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel> | $Enums.SubscriptionBillingCycle
  }

  export type SubscriptionPriceListRelationFilter = {
    every?: SubscriptionPriceWhereInput
    some?: SubscriptionPriceWhereInput
    none?: SubscriptionPriceWhereInput
  }

  export type SubscriptionPriceOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type SubscriptionPlanCountOrderByAggregateInput = {
    subscriptionPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    billingCycle?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SubscriptionPlanMaxOrderByAggregateInput = {
    subscriptionPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    billingCycle?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SubscriptionPlanMinOrderByAggregateInput = {
    subscriptionPlanId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    billingCycle?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumSubscriptionBillingCycleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionBillingCycle | EnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionBillingCycleWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionBillingCycle
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel>
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type EnumSubscriptionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusFilter<$PrismaModel> | $Enums.SubscriptionStatus
  }

  export type EnumPaymentMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentMethodFilter<$PrismaModel> | $Enums.PaymentMethod
  }

  export type SubscriptionPriceScalarRelationFilter = {
    is?: SubscriptionPriceWhereInput
    isNot?: SubscriptionPriceWhereInput
  }

  export type AddressNullableScalarRelationFilter = {
    is?: AddressWhereInput | null
    isNot?: AddressWhereInput | null
  }

  export type SubscriptionCountOrderByAggregateInput = {
    subscriptionId?: SortOrder
    stripePaymentIntentId?: SortOrder
    stripePaymentIntentStatus?: SortOrder
    stripePaymentIntentClientSecret?: SortOrder
    paypalOrderId?: SortOrder
    paypalApprovalUrl?: SortOrder
    paypalCaptureId?: SortOrder
    iyzicoPaymentId?: SortOrder
    iyzicoToken?: SortOrder
    subscriptionPlanId?: SortOrder
    subscriptionPriceId?: SortOrder
    discountCode?: SortOrder
    discountAmount?: SortOrder
    taxRate?: SortOrder
    taxAmount?: SortOrder
    paidPrice?: SortOrder
    currency?: SortOrder
    subscriptionStatus?: SortOrder
    paymentMethod?: SortOrder
    createdAt?: SortOrder
    paidAt?: SortOrder
    cancelledAt?: SortOrder
    refundedAt?: SortOrder
    billingAddressId?: SortOrder
    tenantId?: SortOrder
  }

  export type SubscriptionAvgOrderByAggregateInput = {
    discountAmount?: SortOrder
    taxRate?: SortOrder
    taxAmount?: SortOrder
    paidPrice?: SortOrder
  }

  export type SubscriptionMaxOrderByAggregateInput = {
    subscriptionId?: SortOrder
    stripePaymentIntentId?: SortOrder
    stripePaymentIntentStatus?: SortOrder
    stripePaymentIntentClientSecret?: SortOrder
    paypalOrderId?: SortOrder
    paypalApprovalUrl?: SortOrder
    paypalCaptureId?: SortOrder
    iyzicoPaymentId?: SortOrder
    iyzicoToken?: SortOrder
    subscriptionPlanId?: SortOrder
    subscriptionPriceId?: SortOrder
    discountCode?: SortOrder
    discountAmount?: SortOrder
    taxRate?: SortOrder
    taxAmount?: SortOrder
    paidPrice?: SortOrder
    currency?: SortOrder
    subscriptionStatus?: SortOrder
    paymentMethod?: SortOrder
    createdAt?: SortOrder
    paidAt?: SortOrder
    cancelledAt?: SortOrder
    refundedAt?: SortOrder
    billingAddressId?: SortOrder
    tenantId?: SortOrder
  }

  export type SubscriptionMinOrderByAggregateInput = {
    subscriptionId?: SortOrder
    stripePaymentIntentId?: SortOrder
    stripePaymentIntentStatus?: SortOrder
    stripePaymentIntentClientSecret?: SortOrder
    paypalOrderId?: SortOrder
    paypalApprovalUrl?: SortOrder
    paypalCaptureId?: SortOrder
    iyzicoPaymentId?: SortOrder
    iyzicoToken?: SortOrder
    subscriptionPlanId?: SortOrder
    subscriptionPriceId?: SortOrder
    discountCode?: SortOrder
    discountAmount?: SortOrder
    taxRate?: SortOrder
    taxAmount?: SortOrder
    paidPrice?: SortOrder
    currency?: SortOrder
    subscriptionStatus?: SortOrder
    paymentMethod?: SortOrder
    createdAt?: SortOrder
    paidAt?: SortOrder
    cancelledAt?: SortOrder
    refundedAt?: SortOrder
    billingAddressId?: SortOrder
    tenantId?: SortOrder
  }

  export type SubscriptionSumOrderByAggregateInput = {
    discountAmount?: SortOrder
    taxRate?: SortOrder
    taxAmount?: SortOrder
    paidPrice?: SortOrder
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type EnumSubscriptionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
  }

  export type EnumPaymentMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentMethodWithAggregatesFilter<$PrismaModel> | $Enums.PaymentMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentMethodFilter<$PrismaModel>
    _max?: NestedEnumPaymentMethodFilter<$PrismaModel>
  }

  export type EnumAddressIntentNullableListFilter<$PrismaModel = never> = {
    equals?: $Enums.AddressIntent[] | ListEnumAddressIntentFieldRefInput<$PrismaModel> | null
    has?: $Enums.AddressIntent | EnumAddressIntentFieldRefInput<$PrismaModel> | null
    hasEvery?: $Enums.AddressIntent[] | ListEnumAddressIntentFieldRefInput<$PrismaModel>
    hasSome?: $Enums.AddressIntent[] | ListEnumAddressIntentFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type EnumAddressTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AddressType | EnumAddressTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAddressTypeFilter<$PrismaModel> | $Enums.AddressType
  }

  export type AddressCountOrderByAggregateInput = {
    addressId?: SortOrder
    tenantId?: SortOrder
    addressIntents?: SortOrder
    addressType?: SortOrder
    name?: SortOrder
    addressLine1?: SortOrder
    addressLine2?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phoneNumber?: SortOrder
    email?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    taxOffice?: SortOrder
    taxId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AddressMaxOrderByAggregateInput = {
    addressId?: SortOrder
    tenantId?: SortOrder
    addressType?: SortOrder
    name?: SortOrder
    addressLine1?: SortOrder
    addressLine2?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phoneNumber?: SortOrder
    email?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    taxOffice?: SortOrder
    taxId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AddressMinOrderByAggregateInput = {
    addressId?: SortOrder
    tenantId?: SortOrder
    addressType?: SortOrder
    name?: SortOrder
    addressLine1?: SortOrder
    addressLine2?: SortOrder
    city?: SortOrder
    state?: SortOrder
    country?: SortOrder
    zipCode?: SortOrder
    phoneNumber?: SortOrder
    email?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    taxOffice?: SortOrder
    taxId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumAddressTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AddressType | EnumAddressTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAddressTypeWithAggregatesFilter<$PrismaModel> | $Enums.AddressType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAddressTypeFilter<$PrismaModel>
    _max?: NestedEnumAddressTypeFilter<$PrismaModel>
  }

  export type UserCreateotpMethodsInput = {
    set: $Enums.OTPMethod[]
  }

  export type UserSessionCreateNestedManyWithoutUserInput = {
    create?: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput> | UserSessionCreateWithoutUserInput[] | UserSessionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSessionCreateOrConnectWithoutUserInput | UserSessionCreateOrConnectWithoutUserInput[]
    createMany?: UserSessionCreateManyUserInputEnvelope
    connect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
  }

  export type UserSocialAccountCreateNestedManyWithoutUserInput = {
    create?: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput> | UserSocialAccountCreateWithoutUserInput[] | UserSocialAccountUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSocialAccountCreateOrConnectWithoutUserInput | UserSocialAccountCreateOrConnectWithoutUserInput[]
    createMany?: UserSocialAccountCreateManyUserInputEnvelope
    connect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
  }

  export type TenantUserCreateNestedManyWithoutUserInput = {
    create?: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput> | TenantUserCreateWithoutUserInput[] | TenantUserUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutUserInput | TenantUserCreateOrConnectWithoutUserInput[]
    createMany?: TenantUserCreateManyUserInputEnvelope
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
  }

  export type UserSessionUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput> | UserSessionCreateWithoutUserInput[] | UserSessionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSessionCreateOrConnectWithoutUserInput | UserSessionCreateOrConnectWithoutUserInput[]
    createMany?: UserSessionCreateManyUserInputEnvelope
    connect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
  }

  export type UserSocialAccountUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput> | UserSocialAccountCreateWithoutUserInput[] | UserSocialAccountUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSocialAccountCreateOrConnectWithoutUserInput | UserSocialAccountCreateOrConnectWithoutUserInput[]
    createMany?: UserSocialAccountCreateManyUserInputEnvelope
    connect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
  }

  export type TenantUserUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput> | TenantUserCreateWithoutUserInput[] | TenantUserUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutUserInput | TenantUserCreateOrConnectWithoutUserInput[]
    createMany?: TenantUserCreateManyUserInputEnvelope
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type EnumUserRoleFieldUpdateOperationsInput = {
    set?: $Enums.UserRole
  }

  export type EnumUserStatusFieldUpdateOperationsInput = {
    set?: $Enums.UserStatus
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type UserUpdateotpMethodsInput = {
    set?: $Enums.OTPMethod[]
    push?: $Enums.OTPMethod | $Enums.OTPMethod[]
  }

  export type UserSessionUpdateManyWithoutUserNestedInput = {
    create?: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput> | UserSessionCreateWithoutUserInput[] | UserSessionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSessionCreateOrConnectWithoutUserInput | UserSessionCreateOrConnectWithoutUserInput[]
    upsert?: UserSessionUpsertWithWhereUniqueWithoutUserInput | UserSessionUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: UserSessionCreateManyUserInputEnvelope
    set?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    disconnect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    delete?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    connect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    update?: UserSessionUpdateWithWhereUniqueWithoutUserInput | UserSessionUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: UserSessionUpdateManyWithWhereWithoutUserInput | UserSessionUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: UserSessionScalarWhereInput | UserSessionScalarWhereInput[]
  }

  export type UserSocialAccountUpdateManyWithoutUserNestedInput = {
    create?: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput> | UserSocialAccountCreateWithoutUserInput[] | UserSocialAccountUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSocialAccountCreateOrConnectWithoutUserInput | UserSocialAccountCreateOrConnectWithoutUserInput[]
    upsert?: UserSocialAccountUpsertWithWhereUniqueWithoutUserInput | UserSocialAccountUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: UserSocialAccountCreateManyUserInputEnvelope
    set?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    disconnect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    delete?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    connect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    update?: UserSocialAccountUpdateWithWhereUniqueWithoutUserInput | UserSocialAccountUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: UserSocialAccountUpdateManyWithWhereWithoutUserInput | UserSocialAccountUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: UserSocialAccountScalarWhereInput | UserSocialAccountScalarWhereInput[]
  }

  export type TenantUserUpdateManyWithoutUserNestedInput = {
    create?: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput> | TenantUserCreateWithoutUserInput[] | TenantUserUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutUserInput | TenantUserCreateOrConnectWithoutUserInput[]
    upsert?: TenantUserUpsertWithWhereUniqueWithoutUserInput | TenantUserUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: TenantUserCreateManyUserInputEnvelope
    set?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    disconnect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    delete?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    update?: TenantUserUpdateWithWhereUniqueWithoutUserInput | TenantUserUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: TenantUserUpdateManyWithWhereWithoutUserInput | TenantUserUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
  }

  export type UserSessionUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput> | UserSessionCreateWithoutUserInput[] | UserSessionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSessionCreateOrConnectWithoutUserInput | UserSessionCreateOrConnectWithoutUserInput[]
    upsert?: UserSessionUpsertWithWhereUniqueWithoutUserInput | UserSessionUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: UserSessionCreateManyUserInputEnvelope
    set?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    disconnect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    delete?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    connect?: UserSessionWhereUniqueInput | UserSessionWhereUniqueInput[]
    update?: UserSessionUpdateWithWhereUniqueWithoutUserInput | UserSessionUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: UserSessionUpdateManyWithWhereWithoutUserInput | UserSessionUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: UserSessionScalarWhereInput | UserSessionScalarWhereInput[]
  }

  export type UserSocialAccountUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput> | UserSocialAccountCreateWithoutUserInput[] | UserSocialAccountUncheckedCreateWithoutUserInput[]
    connectOrCreate?: UserSocialAccountCreateOrConnectWithoutUserInput | UserSocialAccountCreateOrConnectWithoutUserInput[]
    upsert?: UserSocialAccountUpsertWithWhereUniqueWithoutUserInput | UserSocialAccountUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: UserSocialAccountCreateManyUserInputEnvelope
    set?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    disconnect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    delete?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    connect?: UserSocialAccountWhereUniqueInput | UserSocialAccountWhereUniqueInput[]
    update?: UserSocialAccountUpdateWithWhereUniqueWithoutUserInput | UserSocialAccountUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: UserSocialAccountUpdateManyWithWhereWithoutUserInput | UserSocialAccountUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: UserSocialAccountScalarWhereInput | UserSocialAccountScalarWhereInput[]
  }

  export type TenantUserUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput> | TenantUserCreateWithoutUserInput[] | TenantUserUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutUserInput | TenantUserCreateOrConnectWithoutUserInput[]
    upsert?: TenantUserUpsertWithWhereUniqueWithoutUserInput | TenantUserUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: TenantUserCreateManyUserInputEnvelope
    set?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    disconnect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    delete?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    update?: TenantUserUpdateWithWhereUniqueWithoutUserInput | TenantUserUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: TenantUserUpdateManyWithWhereWithoutUserInput | TenantUserUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
  }

  export type UserCreateNestedOneWithoutUserSessionsInput = {
    create?: XOR<UserCreateWithoutUserSessionsInput, UserUncheckedCreateWithoutUserSessionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutUserSessionsInput
    connect?: UserWhereUniqueInput
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type UserUpdateOneRequiredWithoutUserSessionsNestedInput = {
    create?: XOR<UserCreateWithoutUserSessionsInput, UserUncheckedCreateWithoutUserSessionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutUserSessionsInput
    upsert?: UserUpsertWithoutUserSessionsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutUserSessionsInput, UserUpdateWithoutUserSessionsInput>, UserUncheckedUpdateWithoutUserSessionsInput>
  }

  export type UserCreateNestedOneWithoutUserSocialAccountsInput = {
    create?: XOR<UserCreateWithoutUserSocialAccountsInput, UserUncheckedCreateWithoutUserSocialAccountsInput>
    connectOrCreate?: UserCreateOrConnectWithoutUserSocialAccountsInput
    connect?: UserWhereUniqueInput
  }

  export type UserUpdateOneRequiredWithoutUserSocialAccountsNestedInput = {
    create?: XOR<UserCreateWithoutUserSocialAccountsInput, UserUncheckedCreateWithoutUserSocialAccountsInput>
    connectOrCreate?: UserCreateOrConnectWithoutUserSocialAccountsInput
    upsert?: UserUpsertWithoutUserSocialAccountsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutUserSocialAccountsInput, UserUpdateWithoutUserSocialAccountsInput>, UserUncheckedUpdateWithoutUserSocialAccountsInput>
  }

  export type TenantUserCreateNestedManyWithoutTenantInput = {
    create?: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput> | TenantUserCreateWithoutTenantInput[] | TenantUserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutTenantInput | TenantUserCreateOrConnectWithoutTenantInput[]
    createMany?: TenantUserCreateManyTenantInputEnvelope
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
  }

  export type SubscriptionCreateNestedManyWithoutTenantInput = {
    create?: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput> | SubscriptionCreateWithoutTenantInput[] | SubscriptionUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTenantInput | SubscriptionCreateOrConnectWithoutTenantInput[]
    createMany?: SubscriptionCreateManyTenantInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type TenantUserUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput> | TenantUserCreateWithoutTenantInput[] | TenantUserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutTenantInput | TenantUserCreateOrConnectWithoutTenantInput[]
    createMany?: TenantUserCreateManyTenantInputEnvelope
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput> | SubscriptionCreateWithoutTenantInput[] | SubscriptionUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTenantInput | SubscriptionCreateOrConnectWithoutTenantInput[]
    createMany?: SubscriptionCreateManyTenantInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type EnumTenantStatusFieldUpdateOperationsInput = {
    set?: $Enums.TenantStatus
  }

  export type TenantUserUpdateManyWithoutTenantNestedInput = {
    create?: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput> | TenantUserCreateWithoutTenantInput[] | TenantUserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutTenantInput | TenantUserCreateOrConnectWithoutTenantInput[]
    upsert?: TenantUserUpsertWithWhereUniqueWithoutTenantInput | TenantUserUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: TenantUserCreateManyTenantInputEnvelope
    set?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    disconnect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    delete?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    update?: TenantUserUpdateWithWhereUniqueWithoutTenantInput | TenantUserUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: TenantUserUpdateManyWithWhereWithoutTenantInput | TenantUserUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
  }

  export type SubscriptionUpdateManyWithoutTenantNestedInput = {
    create?: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput> | SubscriptionCreateWithoutTenantInput[] | SubscriptionUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTenantInput | SubscriptionCreateOrConnectWithoutTenantInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutTenantInput | SubscriptionUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: SubscriptionCreateManyTenantInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutTenantInput | SubscriptionUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutTenantInput | SubscriptionUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type TenantUserUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput> | TenantUserCreateWithoutTenantInput[] | TenantUserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: TenantUserCreateOrConnectWithoutTenantInput | TenantUserCreateOrConnectWithoutTenantInput[]
    upsert?: TenantUserUpsertWithWhereUniqueWithoutTenantInput | TenantUserUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: TenantUserCreateManyTenantInputEnvelope
    set?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    disconnect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    delete?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    connect?: TenantUserWhereUniqueInput | TenantUserWhereUniqueInput[]
    update?: TenantUserUpdateWithWhereUniqueWithoutTenantInput | TenantUserUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: TenantUserUpdateManyWithWhereWithoutTenantInput | TenantUserUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput> | SubscriptionCreateWithoutTenantInput[] | SubscriptionUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTenantInput | SubscriptionCreateOrConnectWithoutTenantInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutTenantInput | SubscriptionUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: SubscriptionCreateManyTenantInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutTenantInput | SubscriptionUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutTenantInput | SubscriptionUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type TenantCreateNestedOneWithoutTenantUsersInput = {
    create?: XOR<TenantCreateWithoutTenantUsersInput, TenantUncheckedCreateWithoutTenantUsersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutTenantUsersInput
    connect?: TenantWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutTenantUsersInput = {
    create?: XOR<UserCreateWithoutTenantUsersInput, UserUncheckedCreateWithoutTenantUsersInput>
    connectOrCreate?: UserCreateOrConnectWithoutTenantUsersInput
    connect?: UserWhereUniqueInput
  }

  export type EnumTenantUserRoleFieldUpdateOperationsInput = {
    set?: $Enums.TenantUserRole
  }

  export type EnumTenantUserStatusFieldUpdateOperationsInput = {
    set?: $Enums.TenantUserStatus
  }

  export type TenantUpdateOneRequiredWithoutTenantUsersNestedInput = {
    create?: XOR<TenantCreateWithoutTenantUsersInput, TenantUncheckedCreateWithoutTenantUsersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutTenantUsersInput
    upsert?: TenantUpsertWithoutTenantUsersInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutTenantUsersInput, TenantUpdateWithoutTenantUsersInput>, TenantUncheckedUpdateWithoutTenantUsersInput>
  }

  export type UserUpdateOneRequiredWithoutTenantUsersNestedInput = {
    create?: XOR<UserCreateWithoutTenantUsersInput, UserUncheckedCreateWithoutTenantUsersInput>
    connectOrCreate?: UserCreateOrConnectWithoutTenantUsersInput
    upsert?: UserUpsertWithoutTenantUsersInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutTenantUsersInput, UserUpdateWithoutTenantUsersInput>, UserUncheckedUpdateWithoutTenantUsersInput>
  }

  export type SubscriptionPriceCreateregionInput = {
    set: string[]
  }

  export type SubscriptionPriceCreatemethodsInput = {
    set: $Enums.PaymentMethod[]
  }

  export type SubscriptionPlanCreateNestedOneWithoutPriceInput = {
    create?: XOR<SubscriptionPlanCreateWithoutPriceInput, SubscriptionPlanUncheckedCreateWithoutPriceInput>
    connectOrCreate?: SubscriptionPlanCreateOrConnectWithoutPriceInput
    connect?: SubscriptionPlanWhereUniqueInput
  }

  export type SubscriptionCreateNestedManyWithoutSubscriptionPriceInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput> | SubscriptionCreateWithoutSubscriptionPriceInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPriceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPriceInput | SubscriptionCreateOrConnectWithoutSubscriptionPriceInput[]
    createMany?: SubscriptionCreateManySubscriptionPriceInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPriceInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput> | SubscriptionCreateWithoutSubscriptionPriceInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPriceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPriceInput | SubscriptionCreateOrConnectWithoutSubscriptionPriceInput[]
    createMany?: SubscriptionCreateManySubscriptionPriceInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type SubscriptionPriceUpdateregionInput = {
    set?: string[]
    push?: string | string[]
  }

  export type EnumCurrencyFieldUpdateOperationsInput = {
    set?: $Enums.Currency
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type SubscriptionPriceUpdatemethodsInput = {
    set?: $Enums.PaymentMethod[]
    push?: $Enums.PaymentMethod | $Enums.PaymentMethod[]
  }

  export type SubscriptionPlanUpdateOneRequiredWithoutPriceNestedInput = {
    create?: XOR<SubscriptionPlanCreateWithoutPriceInput, SubscriptionPlanUncheckedCreateWithoutPriceInput>
    connectOrCreate?: SubscriptionPlanCreateOrConnectWithoutPriceInput
    upsert?: SubscriptionPlanUpsertWithoutPriceInput
    connect?: SubscriptionPlanWhereUniqueInput
    update?: XOR<XOR<SubscriptionPlanUpdateToOneWithWhereWithoutPriceInput, SubscriptionPlanUpdateWithoutPriceInput>, SubscriptionPlanUncheckedUpdateWithoutPriceInput>
  }

  export type SubscriptionUpdateManyWithoutSubscriptionPriceNestedInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput> | SubscriptionCreateWithoutSubscriptionPriceInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPriceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPriceInput | SubscriptionCreateOrConnectWithoutSubscriptionPriceInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPriceInput | SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPriceInput[]
    createMany?: SubscriptionCreateManySubscriptionPriceInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPriceInput | SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPriceInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutSubscriptionPriceInput | SubscriptionUpdateManyWithWhereWithoutSubscriptionPriceInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutSubscriptionPriceNestedInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput> | SubscriptionCreateWithoutSubscriptionPriceInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPriceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPriceInput | SubscriptionCreateOrConnectWithoutSubscriptionPriceInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPriceInput | SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPriceInput[]
    createMany?: SubscriptionCreateManySubscriptionPriceInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPriceInput | SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPriceInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutSubscriptionPriceInput | SubscriptionUpdateManyWithWhereWithoutSubscriptionPriceInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type SubscriptionPriceCreateNestedManyWithoutSubscriptionPlanInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionPriceCreateWithoutSubscriptionPlanInput[] | SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionPriceCreateManySubscriptionPlanInputEnvelope
    connect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
  }

  export type SubscriptionCreateNestedManyWithoutSubscriptionPlanInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionCreateWithoutSubscriptionPlanInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionCreateOrConnectWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionCreateManySubscriptionPlanInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type SubscriptionPriceUncheckedCreateNestedManyWithoutSubscriptionPlanInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionPriceCreateWithoutSubscriptionPlanInput[] | SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionPriceCreateManySubscriptionPlanInputEnvelope
    connect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPlanInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionCreateWithoutSubscriptionPlanInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionCreateOrConnectWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionCreateManySubscriptionPlanInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type EnumSubscriptionBillingCycleFieldUpdateOperationsInput = {
    set?: $Enums.SubscriptionBillingCycle
  }

  export type SubscriptionPriceUpdateManyWithoutSubscriptionPlanNestedInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionPriceCreateWithoutSubscriptionPlanInput[] | SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput[]
    upsert?: SubscriptionPriceUpsertWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionPriceUpsertWithWhereUniqueWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionPriceCreateManySubscriptionPlanInputEnvelope
    set?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    disconnect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    delete?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    connect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    update?: SubscriptionPriceUpdateWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionPriceUpdateWithWhereUniqueWithoutSubscriptionPlanInput[]
    updateMany?: SubscriptionPriceUpdateManyWithWhereWithoutSubscriptionPlanInput | SubscriptionPriceUpdateManyWithWhereWithoutSubscriptionPlanInput[]
    deleteMany?: SubscriptionPriceScalarWhereInput | SubscriptionPriceScalarWhereInput[]
  }

  export type SubscriptionUpdateManyWithoutSubscriptionPlanNestedInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionCreateWithoutSubscriptionPlanInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionCreateOrConnectWithoutSubscriptionPlanInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionCreateManySubscriptionPlanInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPlanInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutSubscriptionPlanInput | SubscriptionUpdateManyWithWhereWithoutSubscriptionPlanInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type SubscriptionPriceUncheckedUpdateManyWithoutSubscriptionPlanNestedInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionPriceCreateWithoutSubscriptionPlanInput[] | SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput[]
    upsert?: SubscriptionPriceUpsertWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionPriceUpsertWithWhereUniqueWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionPriceCreateManySubscriptionPlanInputEnvelope
    set?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    disconnect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    delete?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    connect?: SubscriptionPriceWhereUniqueInput | SubscriptionPriceWhereUniqueInput[]
    update?: SubscriptionPriceUpdateWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionPriceUpdateWithWhereUniqueWithoutSubscriptionPlanInput[]
    updateMany?: SubscriptionPriceUpdateManyWithWhereWithoutSubscriptionPlanInput | SubscriptionPriceUpdateManyWithWhereWithoutSubscriptionPlanInput[]
    deleteMany?: SubscriptionPriceScalarWhereInput | SubscriptionPriceScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutSubscriptionPlanNestedInput = {
    create?: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput> | SubscriptionCreateWithoutSubscriptionPlanInput[] | SubscriptionUncheckedCreateWithoutSubscriptionPlanInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutSubscriptionPlanInput | SubscriptionCreateOrConnectWithoutSubscriptionPlanInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPlanInput[]
    createMany?: SubscriptionCreateManySubscriptionPlanInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPlanInput | SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPlanInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutSubscriptionPlanInput | SubscriptionUpdateManyWithWhereWithoutSubscriptionPlanInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type SubscriptionPlanCreateNestedOneWithoutSubscriptionsInput = {
    create?: XOR<SubscriptionPlanCreateWithoutSubscriptionsInput, SubscriptionPlanUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: SubscriptionPlanCreateOrConnectWithoutSubscriptionsInput
    connect?: SubscriptionPlanWhereUniqueInput
  }

  export type SubscriptionPriceCreateNestedOneWithoutSubscriptionInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionInput>
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionInput
    connect?: SubscriptionPriceWhereUniqueInput
  }

  export type AddressCreateNestedOneWithoutBillingOrdersInput = {
    create?: XOR<AddressCreateWithoutBillingOrdersInput, AddressUncheckedCreateWithoutBillingOrdersInput>
    connectOrCreate?: AddressCreateOrConnectWithoutBillingOrdersInput
    connect?: AddressWhereUniqueInput
  }

  export type TenantCreateNestedOneWithoutSubscriptionsInput = {
    create?: XOR<TenantCreateWithoutSubscriptionsInput, TenantUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutSubscriptionsInput
    connect?: TenantWhereUniqueInput
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type EnumSubscriptionStatusFieldUpdateOperationsInput = {
    set?: $Enums.SubscriptionStatus
  }

  export type EnumPaymentMethodFieldUpdateOperationsInput = {
    set?: $Enums.PaymentMethod
  }

  export type SubscriptionPlanUpdateOneRequiredWithoutSubscriptionsNestedInput = {
    create?: XOR<SubscriptionPlanCreateWithoutSubscriptionsInput, SubscriptionPlanUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: SubscriptionPlanCreateOrConnectWithoutSubscriptionsInput
    upsert?: SubscriptionPlanUpsertWithoutSubscriptionsInput
    connect?: SubscriptionPlanWhereUniqueInput
    update?: XOR<XOR<SubscriptionPlanUpdateToOneWithWhereWithoutSubscriptionsInput, SubscriptionPlanUpdateWithoutSubscriptionsInput>, SubscriptionPlanUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type SubscriptionPriceUpdateOneRequiredWithoutSubscriptionNestedInput = {
    create?: XOR<SubscriptionPriceCreateWithoutSubscriptionInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionInput>
    connectOrCreate?: SubscriptionPriceCreateOrConnectWithoutSubscriptionInput
    upsert?: SubscriptionPriceUpsertWithoutSubscriptionInput
    connect?: SubscriptionPriceWhereUniqueInput
    update?: XOR<XOR<SubscriptionPriceUpdateToOneWithWhereWithoutSubscriptionInput, SubscriptionPriceUpdateWithoutSubscriptionInput>, SubscriptionPriceUncheckedUpdateWithoutSubscriptionInput>
  }

  export type AddressUpdateOneWithoutBillingOrdersNestedInput = {
    create?: XOR<AddressCreateWithoutBillingOrdersInput, AddressUncheckedCreateWithoutBillingOrdersInput>
    connectOrCreate?: AddressCreateOrConnectWithoutBillingOrdersInput
    upsert?: AddressUpsertWithoutBillingOrdersInput
    disconnect?: AddressWhereInput | boolean
    delete?: AddressWhereInput | boolean
    connect?: AddressWhereUniqueInput
    update?: XOR<XOR<AddressUpdateToOneWithWhereWithoutBillingOrdersInput, AddressUpdateWithoutBillingOrdersInput>, AddressUncheckedUpdateWithoutBillingOrdersInput>
  }

  export type TenantUpdateOneRequiredWithoutSubscriptionsNestedInput = {
    create?: XOR<TenantCreateWithoutSubscriptionsInput, TenantUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutSubscriptionsInput
    upsert?: TenantUpsertWithoutSubscriptionsInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutSubscriptionsInput, TenantUpdateWithoutSubscriptionsInput>, TenantUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type AddressCreateaddressIntentsInput = {
    set: $Enums.AddressIntent[]
  }

  export type SubscriptionCreateNestedManyWithoutBillingAddressInput = {
    create?: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput> | SubscriptionCreateWithoutBillingAddressInput[] | SubscriptionUncheckedCreateWithoutBillingAddressInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutBillingAddressInput | SubscriptionCreateOrConnectWithoutBillingAddressInput[]
    createMany?: SubscriptionCreateManyBillingAddressInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutBillingAddressInput = {
    create?: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput> | SubscriptionCreateWithoutBillingAddressInput[] | SubscriptionUncheckedCreateWithoutBillingAddressInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutBillingAddressInput | SubscriptionCreateOrConnectWithoutBillingAddressInput[]
    createMany?: SubscriptionCreateManyBillingAddressInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type AddressUpdateaddressIntentsInput = {
    set?: $Enums.AddressIntent[]
    push?: $Enums.AddressIntent | $Enums.AddressIntent[]
  }

  export type EnumAddressTypeFieldUpdateOperationsInput = {
    set?: $Enums.AddressType
  }

  export type SubscriptionUpdateManyWithoutBillingAddressNestedInput = {
    create?: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput> | SubscriptionCreateWithoutBillingAddressInput[] | SubscriptionUncheckedCreateWithoutBillingAddressInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutBillingAddressInput | SubscriptionCreateOrConnectWithoutBillingAddressInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutBillingAddressInput | SubscriptionUpsertWithWhereUniqueWithoutBillingAddressInput[]
    createMany?: SubscriptionCreateManyBillingAddressInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutBillingAddressInput | SubscriptionUpdateWithWhereUniqueWithoutBillingAddressInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutBillingAddressInput | SubscriptionUpdateManyWithWhereWithoutBillingAddressInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutBillingAddressNestedInput = {
    create?: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput> | SubscriptionCreateWithoutBillingAddressInput[] | SubscriptionUncheckedCreateWithoutBillingAddressInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutBillingAddressInput | SubscriptionCreateOrConnectWithoutBillingAddressInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutBillingAddressInput | SubscriptionUpsertWithWhereUniqueWithoutBillingAddressInput[]
    createMany?: SubscriptionCreateManyBillingAddressInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutBillingAddressInput | SubscriptionUpdateWithWhereUniqueWithoutBillingAddressInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutBillingAddressInput | SubscriptionUpdateManyWithWhereWithoutBillingAddressInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedEnumUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleFilter<$PrismaModel> | $Enums.UserRole
  }

  export type NestedEnumUserStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.UserStatus | EnumUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumUserStatusFilter<$PrismaModel> | $Enums.UserStatus
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserRole | EnumUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserRole[] | ListEnumUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.UserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserRoleFilter<$PrismaModel>
    _max?: NestedEnumUserRoleFilter<$PrismaModel>
  }

  export type NestedEnumUserStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.UserStatus | EnumUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.UserStatus[] | ListEnumUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumUserStatusWithAggregatesFilter<$PrismaModel> | $Enums.UserStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumUserStatusFilter<$PrismaModel>
    _max?: NestedEnumUserStatusFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedEnumTenantStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantStatus | EnumTenantStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantStatusFilter<$PrismaModel> | $Enums.TenantStatus
  }

  export type NestedEnumTenantStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantStatus | EnumTenantStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantStatus[] | ListEnumTenantStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantStatusWithAggregatesFilter<$PrismaModel> | $Enums.TenantStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantStatusFilter<$PrismaModel>
    _max?: NestedEnumTenantStatusFilter<$PrismaModel>
  }

  export type NestedEnumTenantUserRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserRole | EnumTenantUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserRoleFilter<$PrismaModel> | $Enums.TenantUserRole
  }

  export type NestedEnumTenantUserStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserStatus | EnumTenantUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserStatusFilter<$PrismaModel> | $Enums.TenantUserStatus
  }

  export type NestedEnumTenantUserRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserRole | EnumTenantUserRoleFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserRole[] | ListEnumTenantUserRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserRoleWithAggregatesFilter<$PrismaModel> | $Enums.TenantUserRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantUserRoleFilter<$PrismaModel>
    _max?: NestedEnumTenantUserRoleFilter<$PrismaModel>
  }

  export type NestedEnumTenantUserStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TenantUserStatus | EnumTenantUserStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TenantUserStatus[] | ListEnumTenantUserStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTenantUserStatusWithAggregatesFilter<$PrismaModel> | $Enums.TenantUserStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTenantUserStatusFilter<$PrismaModel>
    _max?: NestedEnumTenantUserStatusFilter<$PrismaModel>
  }

  export type NestedEnumCurrencyFilter<$PrismaModel = never> = {
    equals?: $Enums.Currency | EnumCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumCurrencyFilter<$PrismaModel> | $Enums.Currency
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedEnumCurrencyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Currency | EnumCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.Currency[] | ListEnumCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumCurrencyWithAggregatesFilter<$PrismaModel> | $Enums.Currency
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumCurrencyFilter<$PrismaModel>
    _max?: NestedEnumCurrencyFilter<$PrismaModel>
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type NestedEnumSubscriptionBillingCycleFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionBillingCycle | EnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel> | $Enums.SubscriptionBillingCycle
  }

  export type NestedEnumSubscriptionBillingCycleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionBillingCycle | EnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionBillingCycle[] | ListEnumSubscriptionBillingCycleFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionBillingCycleWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionBillingCycle
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionBillingCycleFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumSubscriptionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusFilter<$PrismaModel> | $Enums.SubscriptionStatus
  }

  export type NestedEnumPaymentMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentMethodFilter<$PrismaModel> | $Enums.PaymentMethod
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
  }

  export type NestedEnumPaymentMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PaymentMethod | EnumPaymentMethodFieldRefInput<$PrismaModel>
    in?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.PaymentMethod[] | ListEnumPaymentMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumPaymentMethodWithAggregatesFilter<$PrismaModel> | $Enums.PaymentMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPaymentMethodFilter<$PrismaModel>
    _max?: NestedEnumPaymentMethodFilter<$PrismaModel>
  }

  export type NestedEnumAddressTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AddressType | EnumAddressTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAddressTypeFilter<$PrismaModel> | $Enums.AddressType
  }

  export type NestedEnumAddressTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AddressType | EnumAddressTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AddressType[] | ListEnumAddressTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAddressTypeWithAggregatesFilter<$PrismaModel> | $Enums.AddressType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAddressTypeFilter<$PrismaModel>
    _max?: NestedEnumAddressTypeFilter<$PrismaModel>
  }

  export type UserSessionCreateWithoutUserInput = {
    userSessionId?: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSessionUncheckedCreateWithoutUserInput = {
    userSessionId?: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSessionCreateOrConnectWithoutUserInput = {
    where: UserSessionWhereUniqueInput
    create: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput>
  }

  export type UserSessionCreateManyUserInputEnvelope = {
    data: UserSessionCreateManyUserInput | UserSessionCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type UserSocialAccountCreateWithoutUserInput = {
    userSocialAccountId?: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSocialAccountUncheckedCreateWithoutUserInput = {
    userSocialAccountId?: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSocialAccountCreateOrConnectWithoutUserInput = {
    where: UserSocialAccountWhereUniqueInput
    create: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput>
  }

  export type UserSocialAccountCreateManyUserInputEnvelope = {
    data: UserSocialAccountCreateManyUserInput | UserSocialAccountCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type TenantUserCreateWithoutUserInput = {
    tenantUserId?: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenant: TenantCreateNestedOneWithoutTenantUsersInput
  }

  export type TenantUserUncheckedCreateWithoutUserInput = {
    tenantUserId?: string
    tenantId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type TenantUserCreateOrConnectWithoutUserInput = {
    where: TenantUserWhereUniqueInput
    create: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput>
  }

  export type TenantUserCreateManyUserInputEnvelope = {
    data: TenantUserCreateManyUserInput | TenantUserCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type UserSessionUpsertWithWhereUniqueWithoutUserInput = {
    where: UserSessionWhereUniqueInput
    update: XOR<UserSessionUpdateWithoutUserInput, UserSessionUncheckedUpdateWithoutUserInput>
    create: XOR<UserSessionCreateWithoutUserInput, UserSessionUncheckedCreateWithoutUserInput>
  }

  export type UserSessionUpdateWithWhereUniqueWithoutUserInput = {
    where: UserSessionWhereUniqueInput
    data: XOR<UserSessionUpdateWithoutUserInput, UserSessionUncheckedUpdateWithoutUserInput>
  }

  export type UserSessionUpdateManyWithWhereWithoutUserInput = {
    where: UserSessionScalarWhereInput
    data: XOR<UserSessionUpdateManyMutationInput, UserSessionUncheckedUpdateManyWithoutUserInput>
  }

  export type UserSessionScalarWhereInput = {
    AND?: UserSessionScalarWhereInput | UserSessionScalarWhereInput[]
    OR?: UserSessionScalarWhereInput[]
    NOT?: UserSessionScalarWhereInput | UserSessionScalarWhereInput[]
    userSessionId?: StringFilter<"UserSession"> | string
    userId?: StringFilter<"UserSession"> | string
    accessToken?: StringFilter<"UserSession"> | string
    refreshToken?: StringFilter<"UserSession"> | string
    sessionExpiry?: DateTimeFilter<"UserSession"> | Date | string
    otpVerifyNeeded?: BoolFilter<"UserSession"> | boolean
    otpVerifiedAt?: DateTimeNullableFilter<"UserSession"> | Date | string | null
    ip?: StringNullableFilter<"UserSession"> | string | null
    os?: StringNullableFilter<"UserSession"> | string | null
    device?: StringNullableFilter<"UserSession"> | string | null
    browser?: StringNullableFilter<"UserSession"> | string | null
    city?: StringNullableFilter<"UserSession"> | string | null
    state?: StringNullableFilter<"UserSession"> | string | null
    country?: StringNullableFilter<"UserSession"> | string | null
    deviceFingerprint?: StringNullableFilter<"UserSession"> | string | null
    createdAt?: DateTimeFilter<"UserSession"> | Date | string
    updatedAt?: DateTimeFilter<"UserSession"> | Date | string
  }

  export type UserSocialAccountUpsertWithWhereUniqueWithoutUserInput = {
    where: UserSocialAccountWhereUniqueInput
    update: XOR<UserSocialAccountUpdateWithoutUserInput, UserSocialAccountUncheckedUpdateWithoutUserInput>
    create: XOR<UserSocialAccountCreateWithoutUserInput, UserSocialAccountUncheckedCreateWithoutUserInput>
  }

  export type UserSocialAccountUpdateWithWhereUniqueWithoutUserInput = {
    where: UserSocialAccountWhereUniqueInput
    data: XOR<UserSocialAccountUpdateWithoutUserInput, UserSocialAccountUncheckedUpdateWithoutUserInput>
  }

  export type UserSocialAccountUpdateManyWithWhereWithoutUserInput = {
    where: UserSocialAccountScalarWhereInput
    data: XOR<UserSocialAccountUpdateManyMutationInput, UserSocialAccountUncheckedUpdateManyWithoutUserInput>
  }

  export type UserSocialAccountScalarWhereInput = {
    AND?: UserSocialAccountScalarWhereInput | UserSocialAccountScalarWhereInput[]
    OR?: UserSocialAccountScalarWhereInput[]
    NOT?: UserSocialAccountScalarWhereInput | UserSocialAccountScalarWhereInput[]
    userSocialAccountId?: StringFilter<"UserSocialAccount"> | string
    userId?: StringFilter<"UserSocialAccount"> | string
    provider?: StringFilter<"UserSocialAccount"> | string
    providerId?: StringFilter<"UserSocialAccount"> | string
    accessToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    refreshToken?: StringNullableFilter<"UserSocialAccount"> | string | null
    tokenExpiry?: DateTimeNullableFilter<"UserSocialAccount"> | Date | string | null
    profilePicture?: StringNullableFilter<"UserSocialAccount"> | string | null
    profileUrl?: StringNullableFilter<"UserSocialAccount"> | string | null
    scopes?: StringNullableFilter<"UserSocialAccount"> | string | null
    createdAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
    updatedAt?: DateTimeFilter<"UserSocialAccount"> | Date | string
  }

  export type TenantUserUpsertWithWhereUniqueWithoutUserInput = {
    where: TenantUserWhereUniqueInput
    update: XOR<TenantUserUpdateWithoutUserInput, TenantUserUncheckedUpdateWithoutUserInput>
    create: XOR<TenantUserCreateWithoutUserInput, TenantUserUncheckedCreateWithoutUserInput>
  }

  export type TenantUserUpdateWithWhereUniqueWithoutUserInput = {
    where: TenantUserWhereUniqueInput
    data: XOR<TenantUserUpdateWithoutUserInput, TenantUserUncheckedUpdateWithoutUserInput>
  }

  export type TenantUserUpdateManyWithWhereWithoutUserInput = {
    where: TenantUserScalarWhereInput
    data: XOR<TenantUserUpdateManyMutationInput, TenantUserUncheckedUpdateManyWithoutUserInput>
  }

  export type TenantUserScalarWhereInput = {
    AND?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
    OR?: TenantUserScalarWhereInput[]
    NOT?: TenantUserScalarWhereInput | TenantUserScalarWhereInput[]
    tenantUserId?: StringFilter<"TenantUser"> | string
    tenantId?: StringFilter<"TenantUser"> | string
    userId?: StringFilter<"TenantUser"> | string
    tenantUserRole?: EnumTenantUserRoleFilter<"TenantUser"> | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFilter<"TenantUser"> | $Enums.TenantUserStatus
    userSessionId?: StringNullableFilter<"TenantUser"> | string | null
    createdAt?: DateTimeFilter<"TenantUser"> | Date | string
    updatedAt?: DateTimeFilter<"TenantUser"> | Date | string
    deletedAt?: DateTimeNullableFilter<"TenantUser"> | Date | string | null
  }

  export type UserCreateWithoutUserSessionsInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSocialAccounts?: UserSocialAccountCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutUserSessionsInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSocialAccounts?: UserSocialAccountUncheckedCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutUserSessionsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutUserSessionsInput, UserUncheckedCreateWithoutUserSessionsInput>
  }

  export type UserUpsertWithoutUserSessionsInput = {
    update: XOR<UserUpdateWithoutUserSessionsInput, UserUncheckedUpdateWithoutUserSessionsInput>
    create: XOR<UserCreateWithoutUserSessionsInput, UserUncheckedCreateWithoutUserSessionsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutUserSessionsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutUserSessionsInput, UserUncheckedUpdateWithoutUserSessionsInput>
  }

  export type UserUpdateWithoutUserSessionsInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSocialAccounts?: UserSocialAccountUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutUserSessionsInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSocialAccounts?: UserSocialAccountUncheckedUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUncheckedUpdateManyWithoutUserNestedInput
  }

  export type UserCreateWithoutUserSocialAccountsInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutUserSocialAccountsInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionUncheckedCreateNestedManyWithoutUserInput
    tenantUsers?: TenantUserUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutUserSocialAccountsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutUserSocialAccountsInput, UserUncheckedCreateWithoutUserSocialAccountsInput>
  }

  export type UserUpsertWithoutUserSocialAccountsInput = {
    update: XOR<UserUpdateWithoutUserSocialAccountsInput, UserUncheckedUpdateWithoutUserSocialAccountsInput>
    create: XOR<UserCreateWithoutUserSocialAccountsInput, UserUncheckedCreateWithoutUserSocialAccountsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutUserSocialAccountsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutUserSocialAccountsInput, UserUncheckedUpdateWithoutUserSocialAccountsInput>
  }

  export type UserUpdateWithoutUserSocialAccountsInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutUserSocialAccountsInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUncheckedUpdateManyWithoutUserNestedInput
    tenantUsers?: TenantUserUncheckedUpdateManyWithoutUserNestedInput
  }

  export type TenantUserCreateWithoutTenantInput = {
    tenantUserId?: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    user: UserCreateNestedOneWithoutTenantUsersInput
  }

  export type TenantUserUncheckedCreateWithoutTenantInput = {
    tenantUserId?: string
    userId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type TenantUserCreateOrConnectWithoutTenantInput = {
    where: TenantUserWhereUniqueInput
    create: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput>
  }

  export type TenantUserCreateManyTenantInputEnvelope = {
    data: TenantUserCreateManyTenantInput | TenantUserCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionCreateWithoutTenantInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutSubscriptionsInput
    subscriptionPrice: SubscriptionPriceCreateNestedOneWithoutSubscriptionInput
    billingAddress?: AddressCreateNestedOneWithoutBillingOrdersInput
  }

  export type SubscriptionUncheckedCreateWithoutTenantInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
  }

  export type SubscriptionCreateOrConnectWithoutTenantInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput>
  }

  export type SubscriptionCreateManyTenantInputEnvelope = {
    data: SubscriptionCreateManyTenantInput | SubscriptionCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type TenantUserUpsertWithWhereUniqueWithoutTenantInput = {
    where: TenantUserWhereUniqueInput
    update: XOR<TenantUserUpdateWithoutTenantInput, TenantUserUncheckedUpdateWithoutTenantInput>
    create: XOR<TenantUserCreateWithoutTenantInput, TenantUserUncheckedCreateWithoutTenantInput>
  }

  export type TenantUserUpdateWithWhereUniqueWithoutTenantInput = {
    where: TenantUserWhereUniqueInput
    data: XOR<TenantUserUpdateWithoutTenantInput, TenantUserUncheckedUpdateWithoutTenantInput>
  }

  export type TenantUserUpdateManyWithWhereWithoutTenantInput = {
    where: TenantUserScalarWhereInput
    data: XOR<TenantUserUpdateManyMutationInput, TenantUserUncheckedUpdateManyWithoutTenantInput>
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutTenantInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutTenantInput, SubscriptionUncheckedUpdateWithoutTenantInput>
    create: XOR<SubscriptionCreateWithoutTenantInput, SubscriptionUncheckedCreateWithoutTenantInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutTenantInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutTenantInput, SubscriptionUncheckedUpdateWithoutTenantInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutTenantInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutTenantInput>
  }

  export type SubscriptionScalarWhereInput = {
    AND?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
    OR?: SubscriptionScalarWhereInput[]
    NOT?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
    subscriptionId?: StringFilter<"Subscription"> | string
    stripePaymentIntentId?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentStatus?: StringNullableFilter<"Subscription"> | string | null
    stripePaymentIntentClientSecret?: StringNullableFilter<"Subscription"> | string | null
    paypalOrderId?: StringNullableFilter<"Subscription"> | string | null
    paypalApprovalUrl?: StringNullableFilter<"Subscription"> | string | null
    paypalCaptureId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoPaymentId?: StringNullableFilter<"Subscription"> | string | null
    iyzicoToken?: StringNullableFilter<"Subscription"> | string | null
    subscriptionPlanId?: StringFilter<"Subscription"> | string
    subscriptionPriceId?: StringFilter<"Subscription"> | string
    discountCode?: StringNullableFilter<"Subscription"> | string | null
    discountAmount?: FloatNullableFilter<"Subscription"> | number | null
    taxRate?: FloatNullableFilter<"Subscription"> | number | null
    taxAmount?: FloatNullableFilter<"Subscription"> | number | null
    paidPrice?: FloatFilter<"Subscription"> | number
    currency?: EnumCurrencyFilter<"Subscription"> | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFilter<"Subscription"> | $Enums.PaymentMethod
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    paidAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    cancelledAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    refundedAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    billingAddressId?: StringNullableFilter<"Subscription"> | string | null
    tenantId?: StringFilter<"Subscription"> | string
  }

  export type TenantCreateWithoutTenantUsersInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    subscriptions?: SubscriptionCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutTenantUsersInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutTenantUsersInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutTenantUsersInput, TenantUncheckedCreateWithoutTenantUsersInput>
  }

  export type UserCreateWithoutTenantUsersInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionCreateNestedManyWithoutUserInput
    userSocialAccounts?: UserSocialAccountCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutTenantUsersInput = {
    userId?: string
    email: string
    phone?: string | null
    password: string
    name?: string | null
    lastName?: string | null
    userRole?: $Enums.UserRole
    userStatus?: $Enums.UserStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    profilePicture?: string | null
    otpMethods?: UserCreateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: string | null
    userNationalityId?: string | null
    userNationalityCountry?: string | null
    userSessions?: UserSessionUncheckedCreateNestedManyWithoutUserInput
    userSocialAccounts?: UserSocialAccountUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutTenantUsersInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutTenantUsersInput, UserUncheckedCreateWithoutTenantUsersInput>
  }

  export type TenantUpsertWithoutTenantUsersInput = {
    update: XOR<TenantUpdateWithoutTenantUsersInput, TenantUncheckedUpdateWithoutTenantUsersInput>
    create: XOR<TenantCreateWithoutTenantUsersInput, TenantUncheckedCreateWithoutTenantUsersInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutTenantUsersInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutTenantUsersInput, TenantUncheckedUpdateWithoutTenantUsersInput>
  }

  export type TenantUpdateWithoutTenantUsersInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptions?: SubscriptionUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutTenantUsersInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type UserUpsertWithoutTenantUsersInput = {
    update: XOR<UserUpdateWithoutTenantUsersInput, UserUncheckedUpdateWithoutTenantUsersInput>
    create: XOR<UserCreateWithoutTenantUsersInput, UserUncheckedCreateWithoutTenantUsersInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutTenantUsersInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutTenantUsersInput, UserUncheckedUpdateWithoutTenantUsersInput>
  }

  export type UserUpdateWithoutTenantUsersInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUpdateManyWithoutUserNestedInput
    userSocialAccounts?: UserSocialAccountUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutTenantUsersInput = {
    userId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    password?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    userRole?: EnumUserRoleFieldUpdateOperationsInput | $Enums.UserRole
    userStatus?: EnumUserStatusFieldUpdateOperationsInput | $Enums.UserStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    otpMethods?: UserUpdateotpMethodsInput | $Enums.OTPMethod[]
    otpSecret?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityId?: NullableStringFieldUpdateOperationsInput | string | null
    userNationalityCountry?: NullableStringFieldUpdateOperationsInput | string | null
    userSessions?: UserSessionUncheckedUpdateManyWithoutUserNestedInput
    userSocialAccounts?: UserSocialAccountUncheckedUpdateManyWithoutUserNestedInput
  }

  export type SubscriptionPlanCreateWithoutPriceInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanUncheckedCreateWithoutPriceInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanCreateOrConnectWithoutPriceInput = {
    where: SubscriptionPlanWhereUniqueInput
    create: XOR<SubscriptionPlanCreateWithoutPriceInput, SubscriptionPlanUncheckedCreateWithoutPriceInput>
  }

  export type SubscriptionCreateWithoutSubscriptionPriceInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutSubscriptionsInput
    billingAddress?: AddressCreateNestedOneWithoutBillingOrdersInput
    tenant: TenantCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateWithoutSubscriptionPriceInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionCreateOrConnectWithoutSubscriptionPriceInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput>
  }

  export type SubscriptionCreateManySubscriptionPriceInputEnvelope = {
    data: SubscriptionCreateManySubscriptionPriceInput | SubscriptionCreateManySubscriptionPriceInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionPlanUpsertWithoutPriceInput = {
    update: XOR<SubscriptionPlanUpdateWithoutPriceInput, SubscriptionPlanUncheckedUpdateWithoutPriceInput>
    create: XOR<SubscriptionPlanCreateWithoutPriceInput, SubscriptionPlanUncheckedCreateWithoutPriceInput>
    where?: SubscriptionPlanWhereInput
  }

  export type SubscriptionPlanUpdateToOneWithWhereWithoutPriceInput = {
    where?: SubscriptionPlanWhereInput
    data: XOR<SubscriptionPlanUpdateWithoutPriceInput, SubscriptionPlanUncheckedUpdateWithoutPriceInput>
  }

  export type SubscriptionPlanUpdateWithoutPriceInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionPlanUncheckedUpdateWithoutPriceInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPriceInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutSubscriptionPriceInput, SubscriptionUncheckedUpdateWithoutSubscriptionPriceInput>
    create: XOR<SubscriptionCreateWithoutSubscriptionPriceInput, SubscriptionUncheckedCreateWithoutSubscriptionPriceInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPriceInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutSubscriptionPriceInput, SubscriptionUncheckedUpdateWithoutSubscriptionPriceInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutSubscriptionPriceInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutSubscriptionPriceInput>
  }

  export type SubscriptionPriceCreateWithoutSubscriptionPlanInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
    Subscription?: SubscriptionCreateNestedManyWithoutSubscriptionPriceInput
  }

  export type SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
    Subscription?: SubscriptionUncheckedCreateNestedManyWithoutSubscriptionPriceInput
  }

  export type SubscriptionPriceCreateOrConnectWithoutSubscriptionPlanInput = {
    where: SubscriptionPriceWhereUniqueInput
    create: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionPriceCreateManySubscriptionPlanInputEnvelope = {
    data: SubscriptionPriceCreateManySubscriptionPlanInput | SubscriptionPriceCreateManySubscriptionPlanInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionCreateWithoutSubscriptionPlanInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    subscriptionPrice: SubscriptionPriceCreateNestedOneWithoutSubscriptionInput
    billingAddress?: AddressCreateNestedOneWithoutBillingOrdersInput
    tenant: TenantCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateWithoutSubscriptionPlanInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionCreateOrConnectWithoutSubscriptionPlanInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionCreateManySubscriptionPlanInputEnvelope = {
    data: SubscriptionCreateManySubscriptionPlanInput | SubscriptionCreateManySubscriptionPlanInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionPriceUpsertWithWhereUniqueWithoutSubscriptionPlanInput = {
    where: SubscriptionPriceWhereUniqueInput
    update: XOR<SubscriptionPriceUpdateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedUpdateWithoutSubscriptionPlanInput>
    create: XOR<SubscriptionPriceCreateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionPriceUpdateWithWhereUniqueWithoutSubscriptionPlanInput = {
    where: SubscriptionPriceWhereUniqueInput
    data: XOR<SubscriptionPriceUpdateWithoutSubscriptionPlanInput, SubscriptionPriceUncheckedUpdateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionPriceUpdateManyWithWhereWithoutSubscriptionPlanInput = {
    where: SubscriptionPriceScalarWhereInput
    data: XOR<SubscriptionPriceUpdateManyMutationInput, SubscriptionPriceUncheckedUpdateManyWithoutSubscriptionPlanInput>
  }

  export type SubscriptionPriceScalarWhereInput = {
    AND?: SubscriptionPriceScalarWhereInput | SubscriptionPriceScalarWhereInput[]
    OR?: SubscriptionPriceScalarWhereInput[]
    NOT?: SubscriptionPriceScalarWhereInput | SubscriptionPriceScalarWhereInput[]
    subscriptionPriceId?: StringFilter<"SubscriptionPrice"> | string
    default?: BoolFilter<"SubscriptionPrice"> | boolean
    region?: StringNullableListFilter<"SubscriptionPrice">
    currency?: EnumCurrencyFilter<"SubscriptionPrice"> | $Enums.Currency
    price?: FloatFilter<"SubscriptionPrice"> | number
    methods?: EnumPaymentMethodNullableListFilter<"SubscriptionPrice">
    subscriptionPlanId?: StringFilter<"SubscriptionPrice"> | string
    iyzicoPricingPlanRefId?: StringNullableFilter<"SubscriptionPrice"> | string | null
    createdAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    updatedAt?: DateTimeFilter<"SubscriptionPrice"> | Date | string
    cancelledAt?: DateTimeNullableFilter<"SubscriptionPrice"> | Date | string | null
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutSubscriptionPlanInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutSubscriptionPlanInput, SubscriptionUncheckedUpdateWithoutSubscriptionPlanInput>
    create: XOR<SubscriptionCreateWithoutSubscriptionPlanInput, SubscriptionUncheckedCreateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutSubscriptionPlanInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutSubscriptionPlanInput, SubscriptionUncheckedUpdateWithoutSubscriptionPlanInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutSubscriptionPlanInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutSubscriptionPlanInput>
  }

  export type SubscriptionPlanCreateWithoutSubscriptionsInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    price?: SubscriptionPriceCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanUncheckedCreateWithoutSubscriptionsInput = {
    subscriptionPlanId?: string
    name: string
    description?: string | null
    billingCycle?: $Enums.SubscriptionBillingCycle
    createdAt?: Date | string
    updatedAt?: Date | string
    price?: SubscriptionPriceUncheckedCreateNestedManyWithoutSubscriptionPlanInput
  }

  export type SubscriptionPlanCreateOrConnectWithoutSubscriptionsInput = {
    where: SubscriptionPlanWhereUniqueInput
    create: XOR<SubscriptionPlanCreateWithoutSubscriptionsInput, SubscriptionPlanUncheckedCreateWithoutSubscriptionsInput>
  }

  export type SubscriptionPriceCreateWithoutSubscriptionInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutPriceInput
  }

  export type SubscriptionPriceUncheckedCreateWithoutSubscriptionInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId: string
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
  }

  export type SubscriptionPriceCreateOrConnectWithoutSubscriptionInput = {
    where: SubscriptionPriceWhereUniqueInput
    create: XOR<SubscriptionPriceCreateWithoutSubscriptionInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionInput>
  }

  export type AddressCreateWithoutBillingOrdersInput = {
    addressId?: string
    tenantId: string
    addressIntents?: AddressCreateaddressIntentsInput | $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2?: string | null
    city: string
    state?: string | null
    country: string
    zipCode?: string | null
    phoneNumber?: string | null
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    taxOffice?: string | null
    taxId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AddressUncheckedCreateWithoutBillingOrdersInput = {
    addressId?: string
    tenantId: string
    addressIntents?: AddressCreateaddressIntentsInput | $Enums.AddressIntent[]
    addressType: $Enums.AddressType
    name: string
    addressLine1: string
    addressLine2?: string | null
    city: string
    state?: string | null
    country: string
    zipCode?: string | null
    phoneNumber?: string | null
    email?: string | null
    firstName?: string | null
    lastName?: string | null
    taxOffice?: string | null
    taxId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AddressCreateOrConnectWithoutBillingOrdersInput = {
    where: AddressWhereUniqueInput
    create: XOR<AddressCreateWithoutBillingOrdersInput, AddressUncheckedCreateWithoutBillingOrdersInput>
  }

  export type TenantCreateWithoutSubscriptionsInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenantUsers?: TenantUserCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutSubscriptionsInput = {
    tenantId?: string
    name: string
    description?: string | null
    tenantStatus?: $Enums.TenantStatus
    domain: string
    region?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
    tenantUsers?: TenantUserUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutSubscriptionsInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutSubscriptionsInput, TenantUncheckedCreateWithoutSubscriptionsInput>
  }

  export type SubscriptionPlanUpsertWithoutSubscriptionsInput = {
    update: XOR<SubscriptionPlanUpdateWithoutSubscriptionsInput, SubscriptionPlanUncheckedUpdateWithoutSubscriptionsInput>
    create: XOR<SubscriptionPlanCreateWithoutSubscriptionsInput, SubscriptionPlanUncheckedCreateWithoutSubscriptionsInput>
    where?: SubscriptionPlanWhereInput
  }

  export type SubscriptionPlanUpdateToOneWithWhereWithoutSubscriptionsInput = {
    where?: SubscriptionPlanWhereInput
    data: XOR<SubscriptionPlanUpdateWithoutSubscriptionsInput, SubscriptionPlanUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type SubscriptionPlanUpdateWithoutSubscriptionsInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    price?: SubscriptionPriceUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionPlanUncheckedUpdateWithoutSubscriptionsInput = {
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    billingCycle?: EnumSubscriptionBillingCycleFieldUpdateOperationsInput | $Enums.SubscriptionBillingCycle
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    price?: SubscriptionPriceUncheckedUpdateManyWithoutSubscriptionPlanNestedInput
  }

  export type SubscriptionPriceUpsertWithoutSubscriptionInput = {
    update: XOR<SubscriptionPriceUpdateWithoutSubscriptionInput, SubscriptionPriceUncheckedUpdateWithoutSubscriptionInput>
    create: XOR<SubscriptionPriceCreateWithoutSubscriptionInput, SubscriptionPriceUncheckedCreateWithoutSubscriptionInput>
    where?: SubscriptionPriceWhereInput
  }

  export type SubscriptionPriceUpdateToOneWithWhereWithoutSubscriptionInput = {
    where?: SubscriptionPriceWhereInput
    data: XOR<SubscriptionPriceUpdateWithoutSubscriptionInput, SubscriptionPriceUncheckedUpdateWithoutSubscriptionInput>
  }

  export type SubscriptionPriceUpdateWithoutSubscriptionInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutPriceNestedInput
  }

  export type SubscriptionPriceUncheckedUpdateWithoutSubscriptionInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type AddressUpsertWithoutBillingOrdersInput = {
    update: XOR<AddressUpdateWithoutBillingOrdersInput, AddressUncheckedUpdateWithoutBillingOrdersInput>
    create: XOR<AddressCreateWithoutBillingOrdersInput, AddressUncheckedCreateWithoutBillingOrdersInput>
    where?: AddressWhereInput
  }

  export type AddressUpdateToOneWithWhereWithoutBillingOrdersInput = {
    where?: AddressWhereInput
    data: XOR<AddressUpdateWithoutBillingOrdersInput, AddressUncheckedUpdateWithoutBillingOrdersInput>
  }

  export type AddressUpdateWithoutBillingOrdersInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AddressUncheckedUpdateWithoutBillingOrdersInput = {
    addressId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    addressIntents?: AddressUpdateaddressIntentsInput | $Enums.AddressIntent[]
    addressType?: EnumAddressTypeFieldUpdateOperationsInput | $Enums.AddressType
    name?: StringFieldUpdateOperationsInput | string
    addressLine1?: StringFieldUpdateOperationsInput | string
    addressLine2?: NullableStringFieldUpdateOperationsInput | string | null
    city?: StringFieldUpdateOperationsInput | string
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: StringFieldUpdateOperationsInput | string
    zipCode?: NullableStringFieldUpdateOperationsInput | string | null
    phoneNumber?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    firstName?: NullableStringFieldUpdateOperationsInput | string | null
    lastName?: NullableStringFieldUpdateOperationsInput | string | null
    taxOffice?: NullableStringFieldUpdateOperationsInput | string | null
    taxId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TenantUpsertWithoutSubscriptionsInput = {
    update: XOR<TenantUpdateWithoutSubscriptionsInput, TenantUncheckedUpdateWithoutSubscriptionsInput>
    create: XOR<TenantCreateWithoutSubscriptionsInput, TenantUncheckedCreateWithoutSubscriptionsInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutSubscriptionsInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutSubscriptionsInput, TenantUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type TenantUpdateWithoutSubscriptionsInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantUsers?: TenantUserUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutSubscriptionsInput = {
    tenantId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tenantStatus?: EnumTenantStatusFieldUpdateOperationsInput | $Enums.TenantStatus
    domain?: StringFieldUpdateOperationsInput | string
    region?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantUsers?: TenantUserUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type SubscriptionCreateWithoutBillingAddressInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    subscriptionPlan: SubscriptionPlanCreateNestedOneWithoutSubscriptionsInput
    subscriptionPrice: SubscriptionPriceCreateNestedOneWithoutSubscriptionInput
    tenant: TenantCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateWithoutBillingAddressInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    tenantId: string
  }

  export type SubscriptionCreateOrConnectWithoutBillingAddressInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput>
  }

  export type SubscriptionCreateManyBillingAddressInputEnvelope = {
    data: SubscriptionCreateManyBillingAddressInput | SubscriptionCreateManyBillingAddressInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutBillingAddressInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutBillingAddressInput, SubscriptionUncheckedUpdateWithoutBillingAddressInput>
    create: XOR<SubscriptionCreateWithoutBillingAddressInput, SubscriptionUncheckedCreateWithoutBillingAddressInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutBillingAddressInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutBillingAddressInput, SubscriptionUncheckedUpdateWithoutBillingAddressInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutBillingAddressInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutBillingAddressInput>
  }

  export type UserSessionCreateManyUserInput = {
    userSessionId?: string
    accessToken: string
    refreshToken: string
    sessionExpiry: Date | string
    otpVerifyNeeded?: boolean
    otpVerifiedAt?: Date | string | null
    ip?: string | null
    os?: string | null
    device?: string | null
    browser?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    deviceFingerprint?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserSocialAccountCreateManyUserInput = {
    userSocialAccountId?: string
    provider: string
    providerId: string
    accessToken?: string | null
    refreshToken?: string | null
    tokenExpiry?: Date | string | null
    profilePicture?: string | null
    profileUrl?: string | null
    scopes?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TenantUserCreateManyUserInput = {
    tenantUserId?: string
    tenantId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type UserSessionUpdateWithoutUserInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSessionUncheckedUpdateWithoutUserInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSessionUncheckedUpdateManyWithoutUserInput = {
    userSessionId?: StringFieldUpdateOperationsInput | string
    accessToken?: StringFieldUpdateOperationsInput | string
    refreshToken?: StringFieldUpdateOperationsInput | string
    sessionExpiry?: DateTimeFieldUpdateOperationsInput | Date | string
    otpVerifyNeeded?: BoolFieldUpdateOperationsInput | boolean
    otpVerifiedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    ip?: NullableStringFieldUpdateOperationsInput | string | null
    os?: NullableStringFieldUpdateOperationsInput | string | null
    device?: NullableStringFieldUpdateOperationsInput | string | null
    browser?: NullableStringFieldUpdateOperationsInput | string | null
    city?: NullableStringFieldUpdateOperationsInput | string | null
    state?: NullableStringFieldUpdateOperationsInput | string | null
    country?: NullableStringFieldUpdateOperationsInput | string | null
    deviceFingerprint?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountUpdateWithoutUserInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountUncheckedUpdateWithoutUserInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserSocialAccountUncheckedUpdateManyWithoutUserInput = {
    userSocialAccountId?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    providerId?: StringFieldUpdateOperationsInput | string
    accessToken?: NullableStringFieldUpdateOperationsInput | string | null
    refreshToken?: NullableStringFieldUpdateOperationsInput | string | null
    tokenExpiry?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    profilePicture?: NullableStringFieldUpdateOperationsInput | string | null
    profileUrl?: NullableStringFieldUpdateOperationsInput | string | null
    scopes?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TenantUserUpdateWithoutUserInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenant?: TenantUpdateOneRequiredWithoutTenantUsersNestedInput
  }

  export type TenantUserUncheckedUpdateWithoutUserInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserUncheckedUpdateManyWithoutUserInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserCreateManyTenantInput = {
    tenantUserId?: string
    userId: string
    tenantUserRole?: $Enums.TenantUserRole
    tenantUserStatus?: $Enums.TenantUserStatus
    userSessionId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    deletedAt?: Date | string | null
  }

  export type SubscriptionCreateManyTenantInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
  }

  export type TenantUserUpdateWithoutTenantInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    user?: UserUpdateOneRequiredWithoutTenantUsersNestedInput
  }

  export type TenantUserUncheckedUpdateWithoutTenantInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type TenantUserUncheckedUpdateManyWithoutTenantInput = {
    tenantUserId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    tenantUserRole?: EnumTenantUserRoleFieldUpdateOperationsInput | $Enums.TenantUserRole
    tenantUserStatus?: EnumTenantUserStatusFieldUpdateOperationsInput | $Enums.TenantUserStatus
    userSessionId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    deletedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SubscriptionUpdateWithoutTenantInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutSubscriptionsNestedInput
    subscriptionPrice?: SubscriptionPriceUpdateOneRequiredWithoutSubscriptionNestedInput
    billingAddress?: AddressUpdateOneWithoutBillingOrdersNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutTenantInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SubscriptionUncheckedUpdateManyWithoutTenantInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type SubscriptionCreateManySubscriptionPriceInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionUpdateWithoutSubscriptionPriceInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutSubscriptionsNestedInput
    billingAddress?: AddressUpdateOneWithoutBillingOrdersNestedInput
    tenant?: TenantUpdateOneRequiredWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutSubscriptionPriceInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionUncheckedUpdateManyWithoutSubscriptionPriceInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionPriceCreateManySubscriptionPlanInput = {
    subscriptionPriceId?: string
    default?: boolean
    region?: SubscriptionPriceCreateregionInput | string[]
    currency?: $Enums.Currency
    price: number
    methods?: SubscriptionPriceCreatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    cancelledAt?: Date | string | null
  }

  export type SubscriptionCreateManySubscriptionPlanInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    billingAddressId?: string | null
    tenantId: string
  }

  export type SubscriptionPriceUpdateWithoutSubscriptionPlanInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    Subscription?: SubscriptionUpdateManyWithoutSubscriptionPriceNestedInput
  }

  export type SubscriptionPriceUncheckedUpdateWithoutSubscriptionPlanInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    Subscription?: SubscriptionUncheckedUpdateManyWithoutSubscriptionPriceNestedInput
  }

  export type SubscriptionPriceUncheckedUpdateManyWithoutSubscriptionPlanInput = {
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    default?: BoolFieldUpdateOperationsInput | boolean
    region?: SubscriptionPriceUpdateregionInput | string[]
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    price?: FloatFieldUpdateOperationsInput | number
    methods?: SubscriptionPriceUpdatemethodsInput | $Enums.PaymentMethod[]
    iyzicoPricingPlanRefId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type SubscriptionUpdateWithoutSubscriptionPlanInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPrice?: SubscriptionPriceUpdateOneRequiredWithoutSubscriptionNestedInput
    billingAddress?: AddressUpdateOneWithoutBillingOrdersNestedInput
    tenant?: TenantUpdateOneRequiredWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutSubscriptionPlanInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionUncheckedUpdateManyWithoutSubscriptionPlanInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    billingAddressId?: NullableStringFieldUpdateOperationsInput | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionCreateManyBillingAddressInput = {
    subscriptionId?: string
    stripePaymentIntentId?: string | null
    stripePaymentIntentStatus?: string | null
    stripePaymentIntentClientSecret?: string | null
    paypalOrderId?: string | null
    paypalApprovalUrl?: string | null
    paypalCaptureId?: string | null
    iyzicoPaymentId?: string | null
    iyzicoToken?: string | null
    subscriptionPlanId: string
    subscriptionPriceId: string
    discountCode?: string | null
    discountAmount?: number | null
    taxRate?: number | null
    taxAmount?: number | null
    paidPrice: number
    currency?: $Enums.Currency
    subscriptionStatus?: $Enums.SubscriptionStatus
    paymentMethod: $Enums.PaymentMethod
    createdAt?: Date | string
    paidAt?: Date | string | null
    cancelledAt?: Date | string | null
    refundedAt?: Date | string | null
    tenantId: string
  }

  export type SubscriptionUpdateWithoutBillingAddressInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    subscriptionPlan?: SubscriptionPlanUpdateOneRequiredWithoutSubscriptionsNestedInput
    subscriptionPrice?: SubscriptionPriceUpdateOneRequiredWithoutSubscriptionNestedInput
    tenant?: TenantUpdateOneRequiredWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutBillingAddressInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }

  export type SubscriptionUncheckedUpdateManyWithoutBillingAddressInput = {
    subscriptionId?: StringFieldUpdateOperationsInput | string
    stripePaymentIntentId?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentStatus?: NullableStringFieldUpdateOperationsInput | string | null
    stripePaymentIntentClientSecret?: NullableStringFieldUpdateOperationsInput | string | null
    paypalOrderId?: NullableStringFieldUpdateOperationsInput | string | null
    paypalApprovalUrl?: NullableStringFieldUpdateOperationsInput | string | null
    paypalCaptureId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoPaymentId?: NullableStringFieldUpdateOperationsInput | string | null
    iyzicoToken?: NullableStringFieldUpdateOperationsInput | string | null
    subscriptionPlanId?: StringFieldUpdateOperationsInput | string
    subscriptionPriceId?: StringFieldUpdateOperationsInput | string
    discountCode?: NullableStringFieldUpdateOperationsInput | string | null
    discountAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    taxRate?: NullableFloatFieldUpdateOperationsInput | number | null
    taxAmount?: NullableFloatFieldUpdateOperationsInput | number | null
    paidPrice?: FloatFieldUpdateOperationsInput | number
    currency?: EnumCurrencyFieldUpdateOperationsInput | $Enums.Currency
    subscriptionStatus?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    paymentMethod?: EnumPaymentMethodFieldUpdateOperationsInput | $Enums.PaymentMethod
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    paidAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    cancelledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    refundedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    tenantId?: StringFieldUpdateOperationsInput | string
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}