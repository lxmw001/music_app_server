import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Injectable()
export class AdminGuard extends FirebaseAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth in development
    if (process.env.NODE_ENV === 'development') {
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      req.user = {
        uid: 'dev-user',
        email: 'dev@example.com',
        admin: true,
      };
      return true;
    }

    // Use normal auth in production
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user?.admin !== true) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
