<template>
  <Tooltip content="Improve selected text">
    <Button type="text" icon="md-sparkles" @click="requestAiAssist">AI assist</Button>
  </Tooltip>
</template>

<script setup lang="ts">
import { requestAiAssist } from '@/hostContent';
</script>
