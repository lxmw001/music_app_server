import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './requires-permission.decorator';
import { AuthenticatedRequest } from './interfaces/authenticated-request.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userPermissions: string[] = req.user?.permissions ?? [];

    const hasAll = required.every(p => userPermissions.includes(p));
    if (!hasAll) {
      throw new ForbiddenException(
        `Missing required permission(s): ${required.filter(p => !userPermissions.includes(p)).join(', ')}`,
      );
    }

    return true;
  }
}
