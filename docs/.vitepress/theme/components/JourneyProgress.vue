<script setup lang="ts">
const props = defineProps<{
  current?: 1 | 2 | 3;
}>();

const steps = [
  {
    number: 1,
    title: 'Give an agent its own identity',
    href: '/start/agent-identity',
    detail: 'Its own keypair and credentials, generated where it runs.',
  },
  {
    number: 2,
    title: "Give it a job it can't overstep",
    href: '/start/first-task',
    detail: 'The brief asks it to break a rule; the runtime refuses.',
  },
  {
    number: 3,
    title: 'Read what it did',
    href: '/start/read-the-record',
    detail: 'Who took the job, what it tried, and the verified result.',
  },
] as const;

const next = props.current ? steps[props.current] : undefined;
const previous = props.current ? steps[props.current - 2] : undefined;
</script>

<template>
  <nav
    v-if="current"
    class="journey-progress journey-progress--compact"
    aria-label="Get started steps"
  >
    <a v-if="previous" :href="previous.href">← {{ previous.title }}</a>
    <a v-else href="/start/getting-started">← All steps</a>
    <span class="journey-progress__state" aria-current="step">
      Step {{ current }} of {{ steps.length }}
    </span>
    <a v-if="next" :href="next.href">{{ next.title }} →</a>
  </nav>
  <nav v-else class="journey-progress" aria-label="Get started steps">
    <ol>
      <li v-for="step in steps" :key="step.number">
        <a :href="step.href">
          <span class="journey-progress__state">Step {{ step.number }}</span>
          <strong>{{ step.title }}</strong>
          <span class="journey-progress__detail">{{ step.detail }}</span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.journey-progress {
  margin: 28px 0 36px;
  border-block: 1px solid var(--vp-c-divider);
  padding-block: 18px;
}

.journey-progress--compact {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 16px;
  margin: 16px 0 28px;
  padding-block: 10px;
  font-size: 13px;
}

.journey-progress--compact a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.journey-progress--compact a:hover,
.journey-progress--compact a:focus-visible {
  color: var(--vp-c-brand-1);
}

.journey-progress--compact .journey-progress__state {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.journey-progress ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: journey-step;
}

.journey-progress li {
  min-width: 0;
  align-self: start;
  counter-increment: journey-step;
}

.journey-progress li + li {
  border-inline-start: 1px solid var(--vp-c-divider);
}

.journey-progress a {
  display: grid;
  gap: 5px;
  min-height: 100%;
  padding: 4px 18px;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.journey-progress li:first-child a {
  padding-inline-start: 0;
}

.journey-progress li:last-child a {
  padding-inline-end: 0;
}

.journey-progress a:hover strong,
.journey-progress a:focus-visible strong {
  color: var(--vp-c-brand-1);
}

.journey-progress a:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
}

.journey-progress__state {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}

.journey-progress strong {
  font-size: 14px;
  line-height: 1.35;
}

.journey-progress__detail {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 720px) {
  .journey-progress ol {
    grid-template-columns: 1fr;
  }

  .journey-progress li + li {
    border-block-start: 1px solid var(--vp-c-divider);
    border-inline-start: 0;
  }

  .journey-progress a,
  .journey-progress li:first-child a,
  .journey-progress li:last-child a {
    padding: 14px 0;
  }

  .journey-progress li:first-child a {
    padding-block-start: 4px;
  }

  .journey-progress li:last-child a {
    padding-block-end: 4px;
  }
}
</style>
