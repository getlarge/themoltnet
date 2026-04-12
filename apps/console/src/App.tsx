import { Route, Switch } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { TeamPage } from './pages/TeamPage.js';

export function App() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/team" component={TeamPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </DashboardLayout>
    </AuthGuard>
  );
}
