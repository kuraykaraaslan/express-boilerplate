import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { getGeoLocation } from '@kuraykaraaslan-labs/common/server/user_agent/user_agent.geo';
import { detectSignupCountry, operatorCreateCountry, type CountrySource, type DetectedCountry } from './tenant.country';

/** A sign-up never waits long for a geo provider: past this the language's region (else the default) is used. */
const GEO_TIMEOUT_MS = 1500;

/**
 * The country of a sign-up, silently (docs/phases/49-country-pricing section 7, answer 1): the request's geo-IP, else the browser language's
 * region, else the platform default TR, with the source. The IP is the platform's one client-address reading (`clientIpOf`: X-Forwarded-For through
 * `TRUSTED_PROXY_HOPS` trusted hops; a client-chosen entry is never used); a private or missing address has no geo answer and falls through. Never throws.
 */
export async function detectCountryFromRequest(request: { headers: Pick<Headers, 'get'> }): Promise<DetectedCountry> {
  const ip = clientIpOf(request.headers);
  return detectSignupCountry(
    { ip, acceptLanguage: request.headers.get('accept-language') },
    async (address) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const geo = await Promise.race([
          getGeoLocation(address),
          new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), GEO_TIMEOUT_MS); }),
        ]);
        return geo?.countryCode ?? null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  );
}

/**
 * The country fields of a tenant the OPERATOR creates (owner 2026-11-05: "catch it by IP"): the country it picked, or the region it named
 * (country-less, as before); with neither, the same silent chain a sign-up uses (the request's geo-IP, else the browser language's region,
 * else TR), with its source recorded, so a tenant whose country came from the operator's connection says so (`countrySource` geoip /
 * locale / default) and the operator can correct it on the tenant page. The address is the operator's, not the customer's: that is why the
 * source is kept and the form offers the country and region pickers.
 */
export async function operatorCreateCountryFromRequest(
  body: { countryCode?: string | null; region?: string | null },
  request: { headers: Pick<Headers, 'get'> },
  detect: (request: { headers: Pick<Headers, 'get'> }) => Promise<DetectedCountry> = detectCountryFromRequest,
): Promise<{ countryCode?: string; countrySource?: CountrySource }> {
  if (body.countryCode || body.region) return operatorCreateCountry(body);
  const found = await detect(request);
  return { countryCode: found.countryCode, countrySource: found.source };
}
