<template>
  <div class="host-assets">
    <Button type="primary" long icon="md-cloud-upload" @click="requestHostAsset('upload')">Upload image</Button>
    <Button long icon="md-images" @click="requestHostAsset('choose')">Choose from your library</Button>
    <p>Select a photo on the canvas first to replace it. Otherwise, the image is added.</p>
  </div>
</template>
<script setup lang="ts">
import { requestHostAsset } from '@/hostContent';
</script>
<style scoped>
.host-assets { display: grid; gap: 12px; padding: 12px 0; }
.host-assets p { color: #697386; font-size: 12px; line-height: 1.5; }
</style>
