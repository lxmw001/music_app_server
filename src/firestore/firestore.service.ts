import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Injectable()
export class FirestoreService {
  private readonly db: FirebaseFirestore.Firestore;

  constructor(private readonly firebaseAdmin: FirebaseAdminService) {
    this.db = firebaseAdmin.app.firestore();
  }

  collection(path: string): FirebaseFirestore.CollectionReference {
    return this.db.collection(path);
  }

  doc(path: string): FirebaseFirestore.DocumentReference {
    return this.db.doc(path);
  }
}
