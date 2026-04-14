export class SuggestionResultDto {
  id: string;
  name: string;
  type: 'song' | 'artist' | 'album' | 'playlist';
}
