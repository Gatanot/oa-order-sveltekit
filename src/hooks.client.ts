import type { HandleClientError } from '@sveltejs/kit';

const reloadKey = 'oa-chunk-reload-at';

export const handleError: HandleClientError = ({ error, message }) => {
  const detail = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(detail)) {
    try {
      const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
      if (Date.now() - lastReload > 60_000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        location.reload();
      }
    } catch {
      // Without session storage, a failed reload could loop indefinitely.
    }
  }
  return { message };
};
