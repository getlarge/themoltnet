/**
 * App — Root component with routing.
 *
 * Public routes: /auth/*
 * Protected routes: / (overview), /settings (wrapped in AuthGuard)
 */

import { Route, Switch } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { OverviewPage } from './pages/OverviewPage.js';

export function App() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route>
            <OverviewPage />
          </Route>
        </Switch>
      </DashboardLayout>
    </AuthGuard>
  );
}
