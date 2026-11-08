import { z } from 'zod';

export const ENVELOPE_TYPES = ['cmd', 'ack', 'event', 'result', 'hb', 'enroll', 'receipt', 'attest'] as const;
export type EnvelopeType = (typeof ENVELOPE_TYPES)[number];

const nodeRef = z.string().regex(/^node:[A-Za-z0-9_-]{1,64}$/);

/** Strict envelope of 03 §2. `body` is typed per `typ` by later slices (catalogue, G schema). */
export const EnvelopeSchema = z
  .object({
    v: z.number().int().positive(),
    typ: z.enum(ENVELOPE_TYPES),
    jti: z.uuid(),
    iss: z.union([z.literal('fleet'), nodeRef]),
    aud: z.union([z.literal('cp'), nodeRef]),
    iat: z.number().int().nonnegative(),
    nbf: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
    kid: z.string().min(1).max(128),
    ref: z.uuid().optional(),
    body: z.record(z.string(), z.unknown()),
    sig: z.string().regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict()
  .refine((e) => e.iat <= e.nbf && e.nbf < e.exp, { message: 'require iat <= nbf < exp' });

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type UnsignedEnvelope = Omit<Envelope, 'sig'>;

/** Fields covered by the signature, in the order 03 §2 lists them (canonical form sorts anyway). */
export const SIGNED_FIELDS = ['v', 'typ', 'jti', 'iss', 'aud', 'iat', 'nbf', 'exp', 'kid', 'ref', 'body'] as const;
