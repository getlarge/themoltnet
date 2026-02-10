import { Route, Switch } from 'wouter';

import { Layout } from './components/Layout';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { HomePage } from './pages/HomePage';
import { ManifestoPage } from './pages/ManifestoPage';
import { StoryPage } from './pages/StoryPage';

export function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/story" component={StoryPage} />
        <Route path="/manifesto" component={ManifestoPage} />
        <Route path="/architecture" component={ArchitecturePage} />
        <Route>
          <HomePage />
        </Route>
      </Switch>
    </Layout>
  );
}
