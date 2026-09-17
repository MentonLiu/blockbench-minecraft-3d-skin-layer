import { PLUGIN_ID } from './domain/constants';
import { registerPlugin, unregisterPlugin } from './plugin';

BBPlugin.register(PLUGIN_ID, {
  title: 'Minecraft 3D Skin Layers',
  author: 'bbmodel-skins',
  icon: 'view_in_ar',
  description:
    'Convert Minecraft skin outer layers ("xxx Layer" cubes) into per-pixel voxel cubes. ' +
    'Every visible texel becomes one cube whose six faces map to that pixel; the layer cube ' +
    'is replaced by a same-named group in one reversible undo step. Generated groups can ' +
    'also be restored to their original single cubes.',
  version: '0.3.1',
  min_version: '5.0.0',
  variant: 'desktop',
  tags: ['Minecraft'],

  onload() {
    registerPlugin();
  },

  onunload() {
    unregisterPlugin();
  },
});
