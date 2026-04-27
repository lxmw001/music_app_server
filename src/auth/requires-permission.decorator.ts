import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to require one or more permissions on a route.
 * Use alongside FirebaseAuthGuard + PermissionsGuard.
 *
 * @example
 * @RequiresPermission('suggest_playlists')
 * @Get('suggest')
 * suggest() { ... }
 */
export const RequiresPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
