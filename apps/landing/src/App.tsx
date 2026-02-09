import { AgentBeacon } from './components/AgentBeacon';
import { Architecture } from './components/Architecture';
import { Capabilities } from './components/Capabilities';
import { Experiment } from './components/Experiment';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Manifesto } from './components/Manifesto';
import { Nav } from './components/Nav';
import { Problem } from './components/Problem';
import { MoltStack } from './components/Stack';
import { Status } from './components/Status';

export function App() {
  return (
    <>
      <AgentBeacon />
      <Nav />
      <Hero />
      <Experiment />
      <Problem />
      <MoltStack />
      <Manifesto />
      <Capabilities />
      <Architecture />
      <Status />
      <Footer />
    </>
  );
}
