// fetch for the Supabase client: if the server says the login token has expired,
// renew it once and repeat the request, instead of showing "JWT expired".
//
// Happens when the PC clock is a few minutes behind (the app thinks the token is
// still valid, the server doesn't) or after sleep/hibernation. Without this, calls
// and messages failed until the next automatic renewal.

type Fetch = typeof fetch;

/** Wraps `base`. `refresh` renews the session and returns the new token (or null). */
export function retryOnExpiredJwt(base: Fetch, refresh: () => Promise<string | null>): Fetch {
  // One renewal at a time, even if ten requests fail together.
  let pending: Promise<string | null> | null = null;
  const renew = () =>
    (pending ??= refresh()
      .catch(() => null)
      .finally(() => setTimeout(() => (pending = null), 0)));

  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 401) return res;
    // only plain URLs (supabase-js never passes Request objects), never the login endpoints
    if (typeof input !== 'string' && !(input instanceof URL)) return res;
    if (String(input).includes('/auth/v1/')) return res;
    const body = await res.clone().text().catch(() => '');
    if (!/jwt expired/i.test(body)) return res;
    const token = await renew();
    if (!token) return res;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return base(input, { ...init, headers });
  };
}
