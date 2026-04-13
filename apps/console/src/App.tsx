import { Route, Switch } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { DiariesPage } from './pages/DiariesPage.js';
import { DiaryDetailPage } from './pages/DiaryDetailPage.js';
import { EntryDetailPage } from './pages/EntryDetailPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { TeamPage } from './pages/TeamPage.js';

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
            {(params: { id: string }) => (
              <DiaryDetailPage id={params.id} />
            )}
          </Route>
          <Route path="/team" component={TeamPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </DashboardLayout>
    </AuthGuard>
  );
}
