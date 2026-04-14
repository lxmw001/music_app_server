export class PlaylistResponseDto {
  id: string;
  name: string;
  description: string | null;
  ownerUid: string | null;
  type: 'user' | 'genre' | 'album';
  createdAt: FirebaseFirestore.Timestamp;
}
