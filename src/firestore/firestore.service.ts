import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Injectable()
export class FirestoreService {
  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  private get db(): FirebaseFirestore.Firestore {
    return this.firebaseAdmin.app.firestore();
  }

  collection(path: string): FirebaseFirestore.CollectionReference {
    return this.db.collection(path);
  }

  doc(path: string): FirebaseFirestore.DocumentReference {
    return this.db.doc(path);
  }
}
