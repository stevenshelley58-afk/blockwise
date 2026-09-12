<script lang="ts" setup>
import hostTemplates from '@/components/hostTemplates.vue';
import tools from '@/components/tools.vue';
import layer from '@/components/layer.vue';
import hostAssets from '@/components/hostAssets.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const state = reactive({ toolsBarShow: false });
const menuActive = ref('hostTemplates');
const leftBarComponent = { hostTemplates, tools, layer, hostAssets };
const leftBar = reactive([
  { key: 'hostTemplates', name: computed(() => t('templates')), icon: 'md-book' },
  { key: 'tools', name: computed(() => t('elements')), icon: 'md-images' },
  { key: 'layer', name: computed(() => t('layers')), icon: 'md-reorder' },
  { key: 'hostAssets', name: computed(() => 'Images'), icon: 'md-image' },
]);
const hideToolsBar = () => { state.toolsBarShow = !state.toolsBarShow; };
const showToolsBar = (value: string) => {
  menuActive.value = value;
  state.toolsBarShow = true;
};
</script>

<template>
  <div :class="`left-bar ${state.toolsBarShow && 'show-tools-bar'}`">
    <Menu :active-name="menuActive" accordion @on-select="showToolsBar" width="65px">
      <MenuItem v-for="item in leftBar" :key="item.key" :name="item.key" class="menu-item">
        <Icon :type="item.icon" size="24" />
        <div>{{ item.name }}</div>
      </MenuItem>
    </Menu>
    <div class="content" v-show="state.toolsBarShow">
      <div class="left-panel">
        <KeepAlive><component :is="leftBarComponent[menuActive]" /></KeepAlive>
      </div>
    </div>
    <button
      type="button"
      :class="`close-btn left-btn ${state.toolsBarShow && 'left-btn-open'}`"
      :aria-label="state.toolsBarShow ? 'Close library panel' : 'Open library panel'"
      @click="hideToolsBar"
    />
  </div>
</template>

<style lang="less" scoped>
.left-bar { width: 65px; height: 100%; background: #fff; display: flex; position: relative; }
.left-bar.show-tools-bar { width: 380px; }
.ivu-menu-vertical .menu-item { text-align: center; padding: 10px 2px; box-sizing: border-box; font-size: 12px; }
.ivu-menu-vertical .menu-item > i { margin: 0; }
.ivu-menu-light.ivu-menu-vertical .ivu-menu-item-active:not(.ivu-menu-submenu) { background: none; }
.content { flex: 1; width: 220px; padding: 0 10px; height: 100%; overflow-y: auto; }
.close-btn { width: 20px; height: 64px; cursor: pointer; border: 0; background: #fff; position: absolute; right: -20px; z-index: 3; top: 50%; margin-top: -32px; box-shadow: 1px 0 4px #0000001f; }
.close-btn::after { content: '>'; color: #697386; }
.close-btn.left-btn-open::after { content: '<'; }
</style>
