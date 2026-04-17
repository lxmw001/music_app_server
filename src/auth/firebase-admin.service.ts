import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private _app: admin.app.App;

  onModuleInit(): void {
    if (admin.apps.length > 0) {
      this._app = admin.apps[0]!;
      this.logger.log('Reusing existing Firebase Admin app instance');
      return;
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    this.logger.log(`Project ID: ${projectId}`);
    this.logger.log(`Client Email: ${clientEmail}`);
    this.logger.log(`Private Key length: ${privateKey?.length}`);

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Missing Firebase credentials in environment variables');
    }

    this._app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });

    this.logger.log('Firebase Admin SDK initialized');
  }

  get app(): admin.app.App {
    return this._app;
  }

  auth(): admin.auth.Auth {
    return this._app.auth();
  }
}
