import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from '../sync/admin.guard';
import { createMockFirebaseAdmin } from '../../test/shared/mock-factories';

function createMockExecutionContext(headers: Record<string, string> = {}) {
  const req: any = { headers, user: undefined };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    _req: req,
  } as unknown as ExecutionContext & { _req: any };
}

describe('AdminGuard', () => {
  let mockAdmin: ReturnType<typeof createMockFirebaseAdmin>;
  let guard: AdminGuard;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test'; // Disable development mode bypass
    mockAdmin = createMockFirebaseAdmin();
    guard = new AdminGuard(mockAdmin as any);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns true when token is valid and req.user.admin is true', async () => {
    mockAdmin._verifyIdToken.mockResolvedValue({ uid: 'admin-1', email: 'admin@test.com', admin: true });
    const ctx = createMockExecutionContext({ authorization: 'Bearer valid-token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
  });

  it('throws ForbiddenException with "Admin access required" when req.user.admin is false', async () => {
    mockAdmin._verifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'user@test.com', admin: false });
    const ctx = createMockExecutionContext({ authorization: 'Bearer valid-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Admin access required');
  });

  it('propagates UnauthorizedException when verifyIdToken throws (before admin check)', async () => {
    mockAdmin._verifyIdToken.mockRejectedValue(new Error('invalid token'));
    const ctx = createMockExecutionContext({ authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
