import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { AgentKeysPage } from './pages/AgentKeysPage.js';
import { DiariesPage } from './pages/DiariesPage.js';
import { DiaryDetailPage } from './pages/DiaryDetailPage.js';
import { DiaryExplorePage } from './pages/DiaryExplorePage.js';
import { EntryDetailPage } from './pages/EntryDetailPage.js';
import { GroupDetailPage } from './pages/GroupDetailPage.js';
import { KnowledgePage } from './pages/KnowledgePage.js';
import { LocalRuntimePage } from './pages/LocalRuntimePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { PackDetailPage } from './pages/PackDetailPage.js';
import { PacksPage } from './pages/PacksPage.js';
import { ProfilesPage } from './pages/ProfilesPage.js';
import { RuntimePage } from './pages/RuntimePage.js';
import { RuntimePoliciesPage } from './pages/RuntimePoliciesPage.js';
import { SigningPage } from './pages/SigningPage.js';
import { TaskAnalyticsPage } from './pages/TaskAnalyticsPage.js';
import { TaskAttemptPage } from './pages/TaskAttemptPage.js';
import { TaskDetailPage } from './pages/TaskDetailPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { TeamDetailPage } from './pages/TeamDetailPage.js';
import { TeamsPage } from './pages/TeamsPage.js';
import { legacyProfilesDestination } from './runtime-routes.js';

export function App() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/knowledge" component={KnowledgePage} />
          <Route path="/packs" component={PacksPage} />
          <Route path="/packs/:id">
            {(params: { id: string }) => <PackDetailPage id={params.id} />}
          </Route>
          <Route path="/diaries" component={DiariesPage} />
          <Route path="/diaries/:diaryId/entries/:entryId">
            {(params: { diaryId: string; entryId: string }) => (
              <EntryDetailPage
                diaryId={params.diaryId}
                entryId={params.entryId}
              />
            )}
          </Route>
          <Route path="/diaries/:id/explore">
            {(params: { id: string }) => <DiaryExplorePage id={params.id} />}
          </Route>
          <Route path="/diaries/:id">
            {(params: { id: string }) => <DiaryDetailPage id={params.id} />}
          </Route>
          <Route path="/tasks/analytics" component={TaskAnalyticsPage} />
          <Route path="/tasks/:id/attempts/:attemptN">
            {(params: { id: string; attemptN: string }) => (
              <TaskAttemptPage
                id={params.id}
                attemptN={Number(params.attemptN)}
              />
            )}
          </Route>
          <Route path="/tasks/:id">
            {(params: { id: string }) => <TaskDetailPage id={params.id} />}
          </Route>
          <Route path="/tasks" component={TasksPage} />
          <Route path="/profiles" component={LegacyProfilesRedirect} />
          <Route path="/runtime" component={LegacyProfilesRedirect} />
          <Route path="/runtime/profiles">
            <RuntimePage>
              <ProfilesPage />
            </RuntimePage>
          </Route>
          <Route path="/runtime/policies">
            <RuntimePage>
              <RuntimePoliciesPage />
            </RuntimePage>
          </Route>
          <Route path="/runtime/local">
            <RuntimePage>
              <LocalRuntimePage />
            </RuntimePage>
          </Route>
          <Route path="/runtime/agent-keys">
            <RuntimePage>
              <AgentKeysPage />
            </RuntimePage>
          </Route>
          <Route path="/signing" component={SigningPage} />
          <Route path="/teams" component={TeamsPage} />
          <Route path="/teams/:id">
            {(params: { id: string }) => <TeamDetailPage id={params.id} />}
          </Route>
          <Route path="/groups/:groupId">
            {(params: { groupId: string }) => (
              <GroupDetailPage groupId={params.groupId} />
            )}
          </Route>
          <Route component={NotFoundPage} />
        </Switch>
      </DashboardLayout>
    </AuthGuard>
  );
}

function LegacyProfilesRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(
      legacyProfilesDestination(window.location.search, window.location.hash),
      { replace: true },
    );
  }, [navigate]);
  return null;
}
