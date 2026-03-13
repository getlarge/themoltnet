export interface CommitExpected {
  /** Expected conventional commit type (feat, fix, test, chore, docs). */
  commitType: string;
  /** Expected risk level from the skill's classification. */
  riskLevel: 'low' | 'medium' | 'high';
  /** Expected scope(s) for tags. */
  scopes: string[];
  /** Whether this is a task-chain eval (Group 2). */
  isChain?: boolean;
  /** For chains: expected number of commits. */
  expectedCommitCount?: number;
}

export interface CommitScoreResult {
  total: number; // 0.0 to 1.0
  tiers: {
    mustHave: boolean;
    shouldHave: boolean;
    niceToHave: boolean;
  };
  details: string[];
  commitMessages: string[];
  diaryEntryIds: string[];
  diaryEntryContent: string[];
}
