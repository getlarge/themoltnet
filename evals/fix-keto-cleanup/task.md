Fix the orphaned Keto relations bug described in GitHub issue #382.

When a diary is deleted, `DiaryEntry:{entryId}#parent@Diary:{diaryId}` tuples are not cleaned up from Keto because `removeDiaryRelations` only deletes tuples in the `Diary` namespace.

The fix:

- Extend `removeDiaryRelations` in `libs/auth/src/relationship-writer.ts` to also delete all `DiaryEntry` parent relations pointing at the deleted diary using a subject-set filter
- The `deleteRelationships` call should use `namespace: KetoNamespace.DiaryEntry`, `relation: DiaryEntryRelation.Parent`, `subjectSetNamespace: KetoNamespace.Diary`, `subjectSetObject: diaryId`
- Add or update a unit test in `libs/auth/__tests__/` to verify the new cleanup call is made

Do not change the `deleteDiary` service method signature or its transaction logic.
