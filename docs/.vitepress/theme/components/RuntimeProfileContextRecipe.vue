<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  resolveRuntimeProfileContextRecipe,
  runtimeProfileContextRecipeDescription,
} from '../lib/runtime-profile-contexts';

const props = defineProps<{ recipe: string }>();

const contextJson = computed(() =>
  JSON.stringify(resolveRuntimeProfileContextRecipe(props.recipe), null, 2),
);
const description = computed(() =>
  runtimeProfileContextRecipeDescription(props.recipe),
);
const copied = ref(false);

async function copyContext(): Promise<void> {
  await navigator.clipboard.writeText(contextJson.value);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <div class="runtime-profile-context-recipe">
    <p>
      <strong>{{ recipe }}</strong> — {{ description }}
    </p>
    <button type="button" @click="copyContext">
      {{ copied ? 'Copied' : 'Copy valid Context JSON' }}
    </button>
    <pre
      :aria-label="`${recipe} Context JSON`"
      tabindex="0"
    ><code>{{ contextJson }}</code></pre>
  </div>
</template>

<style scoped>
.runtime-profile-context-recipe {
  width: 100%;
  margin: 1rem 0;
  min-width: 0;
  max-width: 100%;
}

button {
  margin-bottom: 0.75rem;
}

pre {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  padding: 20px 24px;
}

code {
  display: block;
  width: max-content;
  min-width: 100%;
  color: var(--vp-code-block-color);
  font-family: var(--vp-font-family-mono);
  font-size: var(--vp-code-font-size);
  line-height: var(--vp-code-line-height);
  white-space: pre;
}
</style>
