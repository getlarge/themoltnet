import { Route, Switch } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { DiariesPage } from './pages/DiariesPage.js';
import { DiaryDetailPage } from './pages/DiaryDetailPage.js';
import { EntryDetailPage } from './pages/EntryDetailPage.js';
import { GroupDetailPage } from './pages/GroupDetailPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { TaskAttemptPage } from './pages/TaskAttemptPage.js';
import { TaskDetailPage } from './pages/TaskDetailPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { TeamDetailPage } from './pages/TeamDetailPage.js';
import { TeamsPage } from './pages/TeamsPage.js';

export function App() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/diaries" component={DiariesPage} />
          <Route path="/diaries/:diaryId/entries/:entryId">
            {(params: { diaryId: string; entryId: string }) => (
              <EntryDetailPage
                diaryId={params.diaryId}
                entryId={params.entryId}
              />
            )}
          </Route>
          <Route path="/diaries/:id">
            {(params: { id: string }) => <DiaryDetailPage id={params.id} />}
          </Route>
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
