import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';
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

describe('FirebaseAuthGuard', () => {
  let mockAdmin: ReturnType<typeof createMockFirebaseAdmin>;
  let guard: FirebaseAuthGuard;

  beforeEach(() => {
    mockAdmin = createMockFirebaseAdmin();
    guard = new FirebaseAuthGuard(mockAdmin as any);
  });

  it('returns true and sets req.user for a valid Bearer token', async () => {
    mockAdmin._verifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email: 'user@test.com',
      admin: true,
    });
    const ctx = createMockExecutionContext({ authorization: 'Bearer valid-token' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx._req.user).toEqual({ uid: 'user-1', email: 'user@test.com', admin: true });
  });

  it('throws UnauthorizedException when no Authorization header', async () => {
    const ctx = createMockExecutionContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when header does not start with "Bearer "', async () => {
    const ctx = createMockExecutionContext({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when verifyIdToken throws', async () => {
    mockAdmin._verifyIdToken.mockRejectedValue(new Error('token expired'));
    const ctx = createMockExecutionContext({ authorization: 'Bearer bad-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('sets req.user.admin to true when token has admin: true claim', async () => {
    mockAdmin._verifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'user@test.com', admin: true });
    const ctx = createMockExecutionContext({ authorization: 'Bearer token' });

    await guard.canActivate(ctx);

    expect(ctx._req.user.admin).toBe(true);
  });

  it('sets req.user.admin to false when token has no admin field', async () => {
    mockAdmin._verifyIdToken.mockResolvedValue({ uid: 'user-1', email: 'user@test.com' });
    const ctx = createMockExecutionContext({ authorization: 'Bearer token' });

    await guard.canActivate(ctx);

    expect(ctx._req.user.admin).toBe(false);
  });
});
