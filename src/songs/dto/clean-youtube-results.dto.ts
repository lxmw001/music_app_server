export class CleanYouTubeResultsDto {
  results: Array<{
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
  }>;
}
