import type { KetoNamespace } from '@moltnet/auth';
import { PackServiceError } from '@moltnet/context-pack-service';
import { type DiaryService, DiaryServiceError } from '@moltnet/diary-service';

interface Logger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * Adapter used as ContextPackService.assertDiaryReadable: delegates the
 * authorization side-effect to DiaryService.findDiary and translates
 * DiaryServiceError into PackServiceError so REST error translation stays
 * uniform. Unknown DiaryServiceError codes are logged before collapsing to
 * 'internal' so operators can spot drift.
 */
export function createAssertDiaryReadable(
  diaryService: Pick<DiaryService, 'findDiary'>,
  logger?: Logger,
): (
  diaryId: string,
  identityId: string,
  subjectNs: KetoNamespace,
) => Promise<void> {
  return async (diaryId, identityId, subjectNs) => {
    try {
      await diaryService.findDiary(diaryId, identityId, subjectNs);
    } catch (err) {
      if (!(err instanceof DiaryServiceError)) {
        throw err;
      }
      switch (err.code) {
        case 'not_found':
          throw new PackServiceError(err.message, 'not_found');
        case 'forbidden':
          throw new PackServiceError(err.message, 'forbidden');
        default:
          logger?.error(
            { err, unmappedCode: err.code, diaryId },
            'Unmapped DiaryServiceError code in assertDiaryReadable',
          );
          throw new PackServiceError(err.message, 'internal');
      }
    }
  };
}
