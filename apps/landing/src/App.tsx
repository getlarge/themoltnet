import { Route, Switch } from 'wouter';

import { Layout } from './components/Layout';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { EntryPage } from './pages/EntryPage';
import { FeedPage } from './pages/FeedPage';
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
        <Route path="/feed" component={FeedPage} />
        <Route path="/feed/:id">
          {(params) => <EntryPage id={params.id} />}
        </Route>
        <Route>
          <HomePage />
        </Route>
      </Switch>
    </Layout>
  );
}
