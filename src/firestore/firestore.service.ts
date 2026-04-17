import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Injectable()
export class FirestoreService {
  private _db: FirebaseFirestore.Firestore | null = null;

  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  private get db(): FirebaseFirestore.Firestore {
    if (!this._db) {
      const databaseId = process.env.FIRESTORE_DATABASE_ID || 'music-db';
      this._db = this.firebaseAdmin.app.firestore();
      
      // Set database ID if not default
      if (databaseId !== '(default)') {
        this._db.settings({ databaseId });
      }
    }
    return this._db;
  }

  collection(path: string): FirebaseFirestore.CollectionReference {
    return this.db.collection(path);
  }

  doc(path: string): FirebaseFirestore.DocumentReference {
    return this.db.doc(path);
  }
}
