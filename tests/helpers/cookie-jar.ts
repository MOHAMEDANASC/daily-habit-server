/** The cookie store seen by `next/headers` while a request is being handled. */
export const cookieJar: { active: Map<string, string> } = { active: new Map() };
