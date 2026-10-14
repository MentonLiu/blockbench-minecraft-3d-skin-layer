import { afterEach, describe, expect, it, vi } from 'vitest';
import { showNewSkinDialog } from '../../src/newSkin/newSkinDialog';
import type { NewSkinWizardSelection } from '../../src/newSkin/newSkinDialog';

interface DialogConfig {
  form: Record<string, { value?: unknown; options?: Record<string, string> }>;
  onConfirm(value: unknown): void;
  onClose(): void;
}

let capturedDialog: DialogConfig;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('new skin wizard', () => {
  it('defaults to Steve and Default model and exposes the requested labels', () => {
    vi.stubGlobal('tl', (_key: string, _variables: unknown, fallback: string) => fallback);
    vi.stubGlobal('Dialog', class {
      constructor(options: DialogConfig) {
        capturedDialog = options;
      }
      show() {}
    });

    const selections: NewSkinWizardSelection[] = [];
    showNewSkinDialog(selection => selections.push(selection), () => undefined);

    expect(capturedDialog.form.skinType.value).toBe('steve');
    expect(capturedDialog.form.skinType.options).toEqual({ steve: 'Steve', alex: 'Alex' });
    expect(capturedDialog.form.template.value).toBe('root');
    expect(capturedDialog.form.template.options).toEqual({
      root: 'Default model',
      classic: 'Blockbench classic',
      joint: 'Joint model',
    });

    capturedDialog.onConfirm({ skinType: 'alex', template: 'joint', size: '128' });
    expect(selections).toEqual([{ skinType: 'alex', template: 'joint', size: 128 }]);
  });
});
