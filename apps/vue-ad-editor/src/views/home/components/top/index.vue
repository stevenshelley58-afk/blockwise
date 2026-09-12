<template>
  <Header>
    <div class="left">
      <logo />
      <Divider type="vertical" />
      <import-file />
      <Divider type="vertical" />
      <Tooltip :content="$t('grid')">
        <iSwitch v-model="toggleModel" size="small" class="switch" />
      </Tooltip>
      <Divider type="vertical" />
      <history />
    </div>

  </Header>
</template>

<script setup lang="ts" name="Top">
import importFile from '@/components/importFile.vue';
import logo from '@/components/logo.vue';
import previewCurrent from '@/components/previewCurrent';
import history from '@/components/history.vue';
import aiAssist from '@/components/aiAssist.vue';
import hostSave from '@/components/hostSave.vue';

const props = defineProps(['ruler']);
const emit = defineEmits(['update:ruler']);
const toggleModel = computed({
  get: () => props.ruler,
  set: (value) => emit('update:ruler', value),
});
</script>

<style lang="less" scoped>
.left, .right { display: flex; align-items: center; }
</style>

<style scoped>
@media (max-width: 600px) { :deep(.ivu-divider-vertical) { margin: 0 4px; } :deep(.switch) { display: none; } }
</style>
