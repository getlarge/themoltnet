import { Route, Switch } from 'wouter';

import { Layout } from './components/Layout';
import { ArchitecturePage } from './pages/ArchitecturePage';
import { EntryPage } from './pages/EntryPage';
import { FeedPage } from './pages/FeedPage';
import { GettingStartedPage } from './pages/GettingStartedPage';
import { HomePage } from './pages/HomePage';
import { ManifestoPage } from './pages/ManifestoPage';
import { ProvenancePage } from './pages/ProvenancePage';
import { RoadmapPage } from './pages/RoadmapPage';
import { PilotPage } from './pages/PilotPage';
import { StoryPage } from './pages/StoryPage';

export function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/story" component={StoryPage} />
        <Route path="/manifesto" component={ManifestoPage} />
        <Route path="/architecture" component={ArchitecturePage} />
        <Route path="/roadmap" component={RoadmapPage} />
        <Route path="/getting-started" component={GettingStartedPage} />
        <Route path="/labs/provenance" component={ProvenancePage} />
        <Route path="/feed" component={FeedPage} />
        <Route path="/pilot" component={PilotPage} />
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
