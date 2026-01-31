import { Architecture } from './components/Architecture';
import { Capabilities } from './components/Capabilities';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Nav } from './components/Nav';
import { Problem } from './components/Problem';
import { MoltStack } from './components/Stack';
import { Status } from './components/Status';

export function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Problem />
      <MoltStack />
      <Capabilities />
      <Architecture />
      <Status />
      <Footer />
    </>
  );
}
