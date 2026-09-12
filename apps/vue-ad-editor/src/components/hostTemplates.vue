<template>
  <div class="host-library">
    <Input v-model="query" search placeholder="Search templates" />
    <div v-if="filtered.length" class="template-grid">
      <button
        v-for="template in filtered"
        :key="template.id"
        class="template-card"
        type="button"
        @click="loadTemplate(template)"
      >
        <img v-if="template.previewUrl" :src="template.previewUrl" :alt="template.name" />
        <span>{{ template.name }}</span>
      </button>
    </div>
    <p v-else class="empty">No templates available.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { hostContent, type HostTemplate } from '@/hostContent';

const canvasEditor: any = inject('canvasEditor');
const query = ref('');
const filtered = computed(() => {
  const value = query.value.trim().toLowerCase();
  return value
    ? hostContent.templates.filter((item) => item.name.toLowerCase().includes(value))
    : hostContent.templates;
});

const loadTemplate = (template: HostTemplate) => {
  const scene = template.placements[hostContent.activePlacement];
  if (scene) canvasEditor.loadJSON(scene);
};
</script>

<style scoped lang="less">
.host-library { padding-top: 10px; }
.template-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.template-card { border: 1px solid #e4e7ec; border-radius: 6px; background: #fff; padding: 0; overflow: hidden; cursor: pointer; text-align: left; color: #17202a; }
.template-card:hover, .template-card:focus-visible { border-color: #2d8cf0; outline: none; }
.template-card img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; background: #f5f6f8; }
.template-card span { display: block; padding: 8px; font-size: 12px; }
.empty { color: #697386; padding: 24px 8px; text-align: center; }
</style>
