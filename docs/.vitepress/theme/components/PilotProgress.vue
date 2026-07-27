<script setup lang="ts">
const props = defineProps<{
  current?: 1 | 2 | 3;
}>();

const phases = [
  {
    number: 1,
    title: 'Create the workspace',
    href: '/start/getting-started#1-create-the-project-workspace',
    evidence: 'A project team owns a shared diary with moltnet visibility.',
  },
  {
    number: 2,
    title: 'Ready a team agent',
    href: '/start/install-and-initialize#initialize-an-agent-with-legreffier',
    evidence: 'The agent can access the team diary and its daemon can start.',
  },
  {
    number: 3,
    title: 'Review one task',
    href: '/start/first-task',
    evidence: 'You reviewed the accepted attempt and its signed diary trail.',
  },
] as const;

function stateLabel(number: number): string {
  if (!props.current) return `Phase ${number}`;
  if (number === props.current) return 'You are here';
  return number < props.current ? 'Prerequisite' : 'Next';
}
</script>

<template>
  <nav class="pilot-progress" aria-label="Team pilot progress">
    <p class="pilot-progress__label">Team pilot path</p>
    <ol>
      <li
        v-for="phase in phases"
        :key="phase.number"
        :data-current="phase.number === current || undefined"
      >
        <a
          :href="phase.href"
          :aria-current="phase.number === current ? 'step' : undefined"
        >
          <span class="pilot-progress__state">
            {{ stateLabel(phase.number) }}
          </span>
          <strong>{{ phase.title }}</strong>
          <span class="pilot-progress__evidence">
            <span>Evidence</span>
            {{ phase.evidence }}
          </span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.pilot-progress {
  margin: 28px 0 36px;
  border-block: 1px solid var(--vp-c-divider);
  padding-block: 18px;
}

.pilot-progress__label {
  margin: 0 0 14px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 600;
}

.pilot-progress ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: pilot-phase;
}

.pilot-progress li {
  min-width: 0;
  counter-increment: pilot-phase;
}

.pilot-progress li + li {
  border-inline-start: 1px solid var(--vp-c-divider);
}

.pilot-progress a {
  display: grid;
  gap: 5px;
  min-height: 100%;
  padding: 4px 18px;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.pilot-progress li:first-child a {
  padding-inline-start: 0;
}

.pilot-progress li:last-child a {
  padding-inline-end: 0;
}

.pilot-progress a:hover strong,
.pilot-progress a:focus-visible strong {
  color: var(--vp-c-brand-1);
}

.pilot-progress a:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}

.pilot-progress__state {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}

.pilot-progress li[data-current='true'] .pilot-progress__state {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.pilot-progress strong {
  font-size: 14px;
  line-height: 1.35;
}

.pilot-progress__evidence {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.45;
}

.pilot-progress__evidence > span {
  display: block;
  color: var(--vp-c-text-3);
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 720px) {
  .pilot-progress ol {
    grid-template-columns: 1fr;
  }

  .pilot-progress li + li {
    border-block-start: 1px solid var(--vp-c-divider);
    border-inline-start: 0;
  }

  .pilot-progress a,
  .pilot-progress li:first-child a,
  .pilot-progress li:last-child a {
    padding: 14px 0;
  }

  .pilot-progress li:first-child a {
    padding-block-start: 4px;
  }

  .pilot-progress li:last-child a {
    padding-block-end: 4px;
  }
}
</style>
