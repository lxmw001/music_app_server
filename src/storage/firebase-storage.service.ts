import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

const PLACEHOLDER_URL = 'https://via.placeholder.com/300x300.png?text=No+Image';

@Injectable()
export class FirebaseStorageService {
  private readonly logger = new Logger(FirebaseStorageService.name);

  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  async getCoverImageUrl(entityType: string, entityId: string): Promise<string> {
    try {
      const bucket = this.firebaseAdmin.app.storage().bucket();
      const filePath = `covers/${entityType}/${entityId}.jpg`;
      const file = bucket.file(filePath);

      const [exists] = await file.exists();
      if (!exists) {
        return PLACEHOLDER_URL;
      }

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return url;
    } catch (error) {
      this.logger.warn(
        `Failed to get cover image for ${entityType}/${entityId}: ${(error as Error).message}`,
      );
      return PLACEHOLDER_URL;
    }
  }
}
