import { PLUGIN_ID } from './domain/constants';
import { registerPlugin, unregisterPlugin } from './plugin';

BBPlugin.register(PLUGIN_ID, {
  title: 'Minecraft 3D Skin Layers',
  author: '600_liang',
  icon: 'view_in_ar',
  description:
    'Convert Minecraft skin outer layers ("xxx Layer" cubes) into per-pixel voxel cubes. ' +
    'Every visible texel becomes one cube whose six faces map to that pixel; the layer cube ' +
    'is replaced by a same-named group in one reversible undo step. Generated groups can ' +
    'also be restored to their original single cubes.',
  version: '0.5.0-pre',
  min_version: '5.0.0',
  // 注册了格式的插件必须先于任何项目加载完成：web 端插件文件按 URL 异步
  // 下载，不等加载完用户就可能打开皮肤文件，格式会回落到 free
  // format-adding plugins must finish loading before any project opens: on
  // the web app the plugin file downloads asynchronously, and a skin file
  // opened earlier would fall back to the free format
  await_loading: true,
  variant: 'both',
  tags: ['Minecraft'],

  onload() {
    registerPlugin();
  },

  onunload() {
    unregisterPlugin();
  },
});
