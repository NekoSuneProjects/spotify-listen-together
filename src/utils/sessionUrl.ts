export type ParsedSessionTarget = {
  server: string;
  sessionId: string;
}

export function parseSessionTarget(input: string): ParsedSessionTarget {
  const trimmed = input.trim();

  if (!trimmed) {
    return { server: '', sessionId: '' };
  }

  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/session\/([^/?#]+)/i);
    const sessionId =
      pathMatch?.[1] ||
      url.searchParams.get('sessionId') ||
      url.searchParams.get('session') ||
      '';

    return {
      server: url.origin,
      sessionId: sessionId ? decodeURIComponent(sessionId) : '',
    };
  } catch {
    return { server: trimmed.replace(/\/+$/, ''), sessionId: '' };
  }
}

export function buildApiUrl(server: string, path: string) {
  const base = server.trim().replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildSessionInviteUrl(server: string, sessionId: string) {
  if (!server || !sessionId) {
    return '';
  }

  return buildApiUrl(server, `/session/${encodeURIComponent(sessionId)}`);
}
