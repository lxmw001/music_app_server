import { Injectable, ExecutionContext } from '@nestjs/common';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Injectable()
export class OptionalAuthGuard extends FirebaseAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      // Try to authenticate
      return await super.canActivate(context);
    } catch (error) {
      // If auth fails, allow request anyway (optional auth)
      return true;
    }
  }
}
