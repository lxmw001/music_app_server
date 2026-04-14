import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@Injectable()
export class AdminGuard extends FirebaseAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user?.admin !== true) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
