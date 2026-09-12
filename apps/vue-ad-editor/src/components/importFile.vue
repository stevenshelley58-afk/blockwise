<template><Button type="text" icon="md-image" @click="requestHostAsset('upload')">Add image</Button></template>
<script setup lang="ts">
import { requestHostAsset } from '@/hostContent';
</script>
