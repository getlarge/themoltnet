import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Problem } from './components/Problem';
import { MoltStack } from './components/Stack';
import { Capabilities } from './components/Capabilities';
import { Architecture } from './components/Architecture';
import { Status } from './components/Status';
import { Footer } from './components/Footer';

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
