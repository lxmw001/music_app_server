import { Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { VibeItemDto } from './dto/vibe-item.dto';

const COL = 'vibes';

@Injectable()
export class VibesService {
  constructor(private readonly firestore: FirestoreService) {}

  async findAll(): Promise<VibeItemDto[]> {
    const snap = await this.firestore.collection(COL).orderBy('order').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as VibeItemDto));
  }

  async findOne(id: string): Promise<VibeItemDto> {
    const doc = await this.firestore.doc(`${COL}/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Vibe not found');
    return { id: doc.id, ...doc.data() } as VibeItemDto;
  }

  async create(data: Omit<VibeItemDto, 'id'>): Promise<VibeItemDto> {
    const ref = await this.firestore.collection(COL).add(data);
    return { id: ref.id, ...data };
  }

  async update(id: string, data: Partial<Omit<VibeItemDto, 'id'>>): Promise<VibeItemDto> {
    const doc = await this.firestore.doc(`${COL}/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Vibe not found');
    await this.firestore.doc(`${COL}/${id}`).update(data);
    return { id, ...doc.data(), ...data } as VibeItemDto;
  }

  async remove(id: string): Promise<void> {
    const doc = await this.firestore.doc(`${COL}/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Vibe not found');
    await this.firestore.doc(`${COL}/${id}`).delete();
  }
}
