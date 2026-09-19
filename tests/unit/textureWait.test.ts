import { describe, expect, it } from 'vitest';
import { waitForTexturePixels } from '../../src/newSkin/newSkinFormat';

/** 构造带最小 HTMLImageElement 行为的假纹理 / Fake texture with a minimal HTMLImageElement. */
function makeTexture(initiallyComplete: boolean) {
  const listeners = new Map<string, () => void>();
  const img = {
    complete: initiallyComplete,
    addEventListener(event: string, callback: () => void) {
      listeners.set(event, callback);
    },
    trigger(event: string) {
      listeners.get(event)?.();
    },
  };
  return { texture: { img } as unknown as Texture, img: img as unknown as { trigger(event: string): void } };
}

describe('waitForTexturePixels', () => {
  it('returns immediately when the image is already complete', async () => {
    const { texture } = makeTexture(true);
    await expect(waitForTexturePixels(texture)).resolves.toBeUndefined();
  });

  it('waits for the image load event before resolving', async () => {
    const { texture, img } = makeTexture(false);
    const pending = waitForTexturePixels(texture);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    img.trigger('load');
    await expect(pending).resolves.toBeUndefined();
  });

  it('resolves on the image error event too', async () => {
    const { texture, img } = makeTexture(false);
    const pending = waitForTexturePixels(texture);
    img.trigger('error');
    await expect(pending).resolves.toBeUndefined();
  });
});
