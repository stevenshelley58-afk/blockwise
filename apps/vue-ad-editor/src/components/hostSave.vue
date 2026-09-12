<template>
  <div class="host-save">
    <Button type="text" @click="requestHostSave">Save</Button>
  </div>
</template>

<script setup lang="ts">
import { requestHostSave } from '@/hostContent';
</script>

<style scoped>
.host-save { display: flex; gap: 6px; padding-right: 10px; }
</style>
