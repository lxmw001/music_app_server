import { Injectable, ExecutionContext } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Injectable()
export class OptionalAuthGuard extends FirebaseAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth in development
    if (process.env.NODE_ENV === 'development') {
      const request = context.switchToHttp().getRequest();
      // Mock user for development
      request.user = {
        uid: 'dev-user',
        email: 'dev@example.com',
        admin: true,
      };
      return true;
    }

    // Use normal auth in production
    return super.canActivate(context);
  }
}
