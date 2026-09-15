import { describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('./_client', async (importOriginal) => ({
  ...(await importOriginal<typeof CanvasClient>()),
  apiFetch,
}));

import { ApiError } from './_client';
import { getCanvas } from './canvas';

import type * as CanvasClient from './_client';

describe('getCanvas error contract', () => {
  it('maps only HTTP 404 to null and rethrows other errors', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, {}, 'missing'));
    await expect(getCanvas('missing')).resolves.toBeNull();

    const serverError = new ApiError(500, {}, 'server down');
    apiFetch.mockRejectedValueOnce(serverError);
    await expect(getCanvas('broken')).rejects.toBe(serverError);
  });
});
