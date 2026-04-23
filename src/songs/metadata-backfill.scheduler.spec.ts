import { Test, TestingModule } from '@nestjs/testing';
import { MetadataBackfillScheduler } from './metadata-backfill.scheduler';
import { FirestoreService } from '../firestore/firestore.service';
import { SongsService } from './songs.service';
import { GeminiService } from '../sync/gemini.service';

// ─── Mock Factories ───────────────────────────────────────────────────────────

function makeDocRef(data?: any) {
  return {
    get: jest.fn().mockResolvedValue(
      data !== undefined
        ? { exists: true, data: () => data }
        : { exists: false, data: () => undefined },
    ),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

function makeSnapshot(docs: any[]) {
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
  };
}

function makeSongDocWithMissingMetadata(id: string) {
  return {
    id,
    data: () => ({
      title: `Song ${id}`,
      createdAt: new Date(),
      // missing: genres, tags, album, coverImageUrl, listeners, mbid
    }),
    ref: { update: jest.fn().mockResolvedValue(undefined) },
  };
}

function makeSongDocWithCompleteMetadata(id: string) {
  return {
    id,
    data: () => ({
      title: `Song ${id}`,
      createdAt: new Date(),
      genres: ['Rock'],
      tags: ['classic'],
      album: 'Some Album',
      coverImageUrl: 'https://example.com/cover.jpg',
      listeners: 1000,
      mbid: 'some-mbid',
    }),
    ref: { update: jest.fn().mockResolvedValue(undefined) },
  };
}

function makeYoutubeSearchDoc(id: string, mixes: any[]) {
  return {
    id,
    data: () => ({ mixes }),
    ref: { update: jest.fn().mockResolvedValue(undefined) },
  };
}

// ─── Scheduler Builder ────────────────────────────────────────────────────────

async function buildScheduler(firestoreMock: any, songsMock: any, geminiMock: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MetadataBackfillScheduler,
      { provide: FirestoreService, useValue: firestoreMock },
      { provide: SongsService, useValue: songsMock },
      { provide: GeminiService, useValue: geminiMock },
    ],
  }).compile();

  const scheduler = module.get<MetadataBackfillScheduler>(MetadataBackfillScheduler);
  // Override delay to resolve immediately so tests don't slow down
  jest.spyOn(scheduler as any, 'delay').mockResolvedValue(undefined);
  return scheduler;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MetadataBackfillScheduler', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Req 2.3: Config flag check ──────────────────────────────────────────────

  describe('config flag check (Req 2.3)', () => {
    it('when enabled=false, neither refreshMetadata nor gemini.generate is called', async () => {
      const configDocRef = makeDocRef({ enabled: false });
      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn(),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn() };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(songsMock.refreshMetadata).not.toHaveBeenCalled();
      expect(geminiMock.generate).not.toHaveBeenCalled();
    });

    it('when enabled=false, collection is never queried', async () => {
      const configDocRef = makeDocRef({ enabled: false });
      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn(),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn() };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(firestoreMock.collection).not.toHaveBeenCalled();
    });
  });

  // ── Req 2.4: Auto-cancel ────────────────────────────────────────────────────

  describe('auto-cancel (Req 2.4)', () => {
    it('when all songs have complete metadata (0 processed), update is called with { enabled: false }', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const completeSongDocs = [
        makeSongDocWithCompleteMetadata('s1'),
        makeSongDocWithCompleteMetadata('s2'),
      ];
      const songsSnapshot = makeSnapshot(completeSongDocs);

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(songsSnapshot),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn().mockResolvedValue({ success: true, message: 'ok' }) };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.update).toHaveBeenCalledWith({ enabled: false });
    });

    it('when some songs are processed, update with enabled=false is NOT called', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const missingSongDocs = [makeSongDocWithMissingMetadata('s1')];
      const songsSnapshot = makeSnapshot(missingSongDocs);

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn()
          .mockResolvedValueOnce(songsSnapshot)
          .mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn().mockResolvedValue({ success: true, message: 'ok' }) };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.update).not.toHaveBeenCalledWith({ enabled: false });
    });
  });

  // ── Req 2.5: Run summary always written ────────────────────────────────────

  describe('run summary always written (Req 2.5)', () => {
    it('after a completed run, set is called with lastRun and lastRunSummary', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn().mockResolvedValue({ success: true, message: 'ok' }) };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({
          lastRun: expect.any(Date),
          lastRunSummary: expect.any(Object),
        }),
        { merge: true },
      );
    });

    it('run summary is written even when no songs or mixes are processed', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn() };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.set).toHaveBeenCalledTimes(1);
      const callArg = configDocRef.set.mock.calls[0][0];
      expect(callArg).toHaveProperty('lastRun');
      expect(callArg).toHaveProperty('lastRunSummary');
    });
  });

  // ── Req 3.7: Song cap enforcement ──────────────────────────────────────────

  describe('song cap enforcement (Req 3.7)', () => {
    it('with many songs needing update, refreshMetadata is called at most 500 times', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      // Each page returns 50 songs with missing metadata
      const makePage = (pageIndex: number) => {
        const docs = Array.from({ length: 50 }, (_, i) =>
          makeSongDocWithMissingMetadata(`song-${pageIndex * 50 + i}`),
        );
        return makeSnapshot(docs);
      };

      let callCount = 0;
      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockImplementation(() => {
          const page = makePage(callCount++);
          return Promise.resolve(page);
        }),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn().mockResolvedValue({ success: true, message: 'ok' }) };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(songsMock.refreshMetadata).toHaveBeenCalledTimes(500);
    });
  });

  // ── Req 3.4: Error isolation ────────────────────────────────────────────────

  describe('error isolation (Req 3.4)', () => {
    it('when refreshMetadata throws for one song, processing continues for the next song', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const songDocs = [
        makeSongDocWithMissingMetadata('fail-song'),
        makeSongDocWithMissingMetadata('ok-song'),
      ];

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn()
          .mockResolvedValueOnce(makeSnapshot(songDocs))
          .mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };

      const songsMock = {
        refreshMetadata: jest.fn()
          .mockRejectedValueOnce(new Error('Last.fm API error'))
          .mockResolvedValue({ success: true, message: 'ok' }),
      };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      // Both songs were attempted
      expect(songsMock.refreshMetadata).toHaveBeenCalledTimes(2);
      expect(songsMock.refreshMetadata).toHaveBeenCalledWith('fail-song');
      expect(songsMock.refreshMetadata).toHaveBeenCalledWith('ok-song');
    });

    it('a failed song does not prevent the run summary from being written', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const songDocs = [makeSongDocWithMissingMetadata('fail-song')];

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn()
          .mockResolvedValueOnce(makeSnapshot(songDocs))
          .mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };

      const songsMock = {
        refreshMetadata: jest.fn().mockRejectedValue(new Error('API error')),
      };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v1","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastRun: expect.any(Date), lastRunSummary: expect.any(Object) }),
        { merge: true },
      );
    });
  });

  // ── Req 4.6: Mix doc cap ────────────────────────────────────────────────────

  describe('mix doc cap (Req 4.6)', () => {
    it('with 25 youtube_searches docs all having stale mixes, gemini.generate is called at most 20 times', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      // The implementation queries with .limit(20), so even if we return 25 docs
      // the query itself is capped. We simulate 20 docs returned (as the query limits it).
      const staleMixDocs = Array.from({ length: 20 }, (_, i) =>
        makeYoutubeSearchDoc(`yt-search-${i}`, [
          { youtubeId: `v${i}`, title: `Mix ${i}` }, // no genres = stale
        ]),
      );

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot(staleMixDocs)),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn().mockResolvedValue('[{"youtubeId":"v0","genres":["Pop"]}]') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(geminiMock.generate).toHaveBeenCalledTimes(20);
      // Verify the limit was applied
      expect(youtubeSearchesRef.limit).toHaveBeenCalledWith(20);
    });
  });

  // ── Req 4.5: Mix genres parse failure ──────────────────────────────────────

  describe('mix genres parse failure (Req 4.5)', () => {
    it('when Gemini returns unparseable JSON for a doc, that doc is skipped and processing continues', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const doc1 = makeYoutubeSearchDoc('yt-search-1', [{ youtubeId: 'v1', title: 'Mix 1' }]);
      const doc2 = makeYoutubeSearchDoc('yt-search-2', [{ youtubeId: 'v2', title: 'Mix 2' }]);

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([doc1, doc2])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = {
        generate: jest.fn()
          .mockResolvedValueOnce('NOT VALID JSON !!!') // first doc fails
          .mockResolvedValueOnce('[{"youtubeId":"v2","genres":["Rock"]}]'), // second doc succeeds
      };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      // Both docs were attempted
      expect(geminiMock.generate).toHaveBeenCalledTimes(2);
      // First doc's ref.update should NOT have been called (parse failed)
      expect(doc1.ref.update).not.toHaveBeenCalled();
      // Second doc's ref.update SHOULD have been called (parse succeeded)
      expect(doc2.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({ mixes: expect.any(Array) }),
      );
    });

    it('a parse failure does not prevent the run summary from being written', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const doc1 = makeYoutubeSearchDoc('yt-search-1', [{ youtubeId: 'v1', title: 'Mix 1' }]);

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([doc1])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn().mockResolvedValue('INVALID JSON') };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);
      await scheduler.runBackfill();

      expect(configDocRef.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastRun: expect.any(Date), lastRunSummary: expect.any(Object) }),
        { merge: true },
      );
    });
  });

  // ── Req 1.2: isRunning guard ────────────────────────────────────────────────

  describe('isRunning guard (Req 1.2)', () => {
    it('concurrent trigger is skipped — second call returns immediately without doing work', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      // Make the first run take a while by using a slow-resolving promise
      let resolveFirstRun!: () => void;
      const firstRunBarrier = new Promise<void>(resolve => {
        resolveFirstRun = resolve;
      });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockImplementation(() => firstRunBarrier.then(() => makeSnapshot([]))),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn() };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);

      // Start first run (will block on firstRunBarrier)
      const firstRun = scheduler.runBackfill();

      // Trigger second run while first is still running
      const secondRun = scheduler.runBackfill();
      await secondRun; // second run should return immediately

      // The config doc should only have been read once (for the first run)
      // The second run should have been skipped
      expect(configDocRef.get).toHaveBeenCalledTimes(1);

      // Unblock first run
      resolveFirstRun();
      await firstRun;
    });

    it('after first run completes, a subsequent trigger is NOT skipped', async () => {
      const configDocRef = makeDocRef({ enabled: true });

      const collectionRef = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        startAfter: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const youtubeSearchesRef = {
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(makeSnapshot([])),
      };

      const firestoreMock = {
        doc: jest.fn().mockReturnValue(configDocRef),
        collection: jest.fn().mockImplementation((path: string) => {
          if (path === 'songs') return collectionRef;
          return youtubeSearchesRef;
        }),
      };
      const songsMock = { refreshMetadata: jest.fn() };
      const geminiMock = { generate: jest.fn() };

      const scheduler = await buildScheduler(firestoreMock, songsMock, geminiMock);

      await scheduler.runBackfill();
      await scheduler.runBackfill();

      // Both runs should have read the config
      expect(configDocRef.get).toHaveBeenCalledTimes(2);
    });
  });
});
