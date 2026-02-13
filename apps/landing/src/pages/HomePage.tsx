import { Capabilities } from '../components/Capabilities';
import { GetStarted } from '../components/GetStarted';
import { Hero } from '../components/Hero';
import { Problem } from '../components/Problem';
import { MoltStack } from '../components/Stack';
import { Status } from '../components/Status';

export function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <MoltStack />
      <Capabilities />
      <GetStarted />
      <Status />
    </>
  );
}
