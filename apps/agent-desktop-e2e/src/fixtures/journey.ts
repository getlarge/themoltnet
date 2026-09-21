export interface DesktopDockerJourney {
  identity: {
    subjectId: string;
    publicKey: string;
    privateKey: string;
    fingerprint: string;
    agentKey: string;
  };
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  diaryId: string;
  projectId: string;
  profileId: string;
}
