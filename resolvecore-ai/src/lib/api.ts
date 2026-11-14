export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };

  if (token) {
    mergedHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    ...rest,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    let errorMsg = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) errorMsg = data.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(errorMsg);
  }

  return response.json() as Promise<T>;
}
