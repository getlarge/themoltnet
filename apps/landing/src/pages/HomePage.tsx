import { Capabilities } from '../components/Capabilities';
import { Flywheel } from '../components/Flywheel';
import { GetStarted } from '../components/GetStarted';
import { Hero } from '../components/Hero';
import { LeGreffier } from '../components/LeGreffier';
import { Problem } from '../components/Problem';

export function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <LeGreffier />
      <Flywheel />
      <Capabilities />
      <GetStarted />
    </>
  );
}
