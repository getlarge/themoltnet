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
    <pre><code>{{ contextJson }}</code></pre>
  </div>
</template>

<style scoped>
.runtime-profile-context-recipe {
  margin: 1rem 0;
}

button {
  margin-bottom: 0.75rem;
}
</style>
