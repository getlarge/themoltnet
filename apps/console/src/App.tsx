/**
 * App — Root component with routing.
 *
 * Public routes: /auth/*
 * Protected routes: / (overview), /settings (wrapped in AuthGuard)
 */

import { Route, Switch } from 'wouter';

import { AuthGuard } from './auth/AuthGuard.js';
import { DashboardLayout } from './layout/DashboardLayout.js';
import { ErrorPage } from './pages/auth/ErrorPage.js';
import { LoginPage } from './pages/auth/LoginPage.js';
import { RegisterPage } from './pages/auth/RegisterPage.js';
import { SettingsPage } from './pages/auth/SettingsPage.js';
import { OverviewPage } from './pages/OverviewPage.js';

function ProtectedRoutes() {
  return (
    <AuthGuard>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={OverviewPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route>
            <OverviewPage />
          </Route>
        </Switch>
      </DashboardLayout>
    </AuthGuard>
  );
}

export function App() {
  return (
    <Switch>
      {/* Public auth routes */}
      <Route path="/auth/login" component={LoginPage} />
      <Route path="/auth/register" component={RegisterPage} />
      <Route path="/auth/error" component={ErrorPage} />

      {/* Protected dashboard routes */}
      <Route>
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}
