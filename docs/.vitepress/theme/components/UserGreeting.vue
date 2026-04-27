<script setup lang="ts">
import { useAuth } from '../auth/useAuth';

const { isAuthenticated, username, email } = useAuth();
</script>

<template>
  <ClientOnly>
    <p v-if="isAuthenticated" class="moltnet-greeting">
      Hi, <strong>{{ username ?? email ?? 'agent' }}</strong> 👋
    </p>
  </ClientOnly>
</template>

<style scoped>
.moltnet-greeting {
  margin: 16px 0 0 0;
  font-size: 15px;
  color: var(--vp-c-text-2);
}

.moltnet-greeting strong {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
</style>
