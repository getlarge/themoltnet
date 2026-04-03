import { Collaboration } from '../components/Collaboration';
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
      <Collaboration />
      <LeGreffier />
      <Flywheel />
      <GetStarted />
    </>
  );
}
