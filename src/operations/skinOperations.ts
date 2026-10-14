import { DEFAULT_OPTIONS } from '../domain/constants';
import { resolveGeneratorOptions } from '../domain/options';
import { VoxelLimitError } from '../domain/types';
import type { GeneratorOptions, GeneratorPreferences } from '../domain/types';
import { applyOutcome, scanAndPlan } from '../generate';
import type { ScanOutcome } from '../generate';
import { collectRestoreCandidates, hasOpenProject, isEditMode } from '../blockbench/compatibility';
import { applyRestores } from '../blockbench/modelRestorer';
import { blockbenchDuplicateHost, duplicateCurrentProjectAsCopy } from '../blockbench/projectDuplicate';
import { clearTransparentCubes } from '../blockbench/transparentCleaner';
import { applyRegenerations, collectRegenerationSources, planRegenerations } from '../blockbench/modelRegenerator';
import { blockbenchHostForProject } from '../blockbench/blockbenchHost';
import type { WriterHost } from '../blockbench/modelWriter';
import type { SkinSize, SkinType, TemplateId } from '../newSkin/templates';
import { SkinOperationError } from './errors';
import { awaitOperationInput, OperationCoordinator } from './operationCoordinator';
import type { OperationLease } from './operationCoordinator';
import { ProjectOperationContext } from './projectContext';
import type { ProjectIdentity } from './projectContext';
import { bindWriterHost } from './boundWriterHost';

export type SkinOperationName = 'generate' | 'restore' | 'regenerate' | 'clear_transparent' | 'new_skin';
export type SkinOperationStatus = 'completed' | 'detected' | 'cancelled' | 'template_retained';

export interface SkinOperationResult {
  operation: SkinOperationName;
  operationId: string;
  status: SkinOperationStatus;
  targetProjectId: string | null;
  sourceCount: number;
  plannedCubes: number;
  createdCubes: number;
  createdGroups: number;
  removedCubes: number;
  restoredCubes: number;
  replacedGroups: number;
  durationMs: number;
  warnings: string[];
  copiedProject: boolean;
  templateProjectCreated: boolean;
  templateRetainedBare: boolean;
}

export interface OperationPreview {
  groupCount: number;
  cubeCount: number;
  voxelCount: number;
  warnings: string[];
}

export type ConfirmOperation = (
  preview: OperationPreview,
  options: GeneratorOptions,
) => Promise<GeneratorPreferences | GeneratorOptions | null>;

export interface NewSkinProjectSetup {
  createTemplateProject(): { projectName: string };
  waitForTextures(): Promise<void>;
  skinType: SkinType;
  template: TemplateId;
  size: SkinSize;
  name?: string;
  identifier?: string;
  signal?: AbortSignal;
}

function activeProject(): (ProjectIdentity & ModelProject) | undefined {
  if (typeof Project === 'undefined' || !Project || typeof ModelProject === 'undefined') {
    return undefined;
  }
  return Project as ProjectIdentity & ModelProject;
}

function isProjectOpen(project: ProjectIdentity): boolean {
  return typeof ModelProject !== 'undefined' && ModelProject.all.includes(project as ModelProject);
}

function makeResult(
  operation: SkinOperationName,
  lease: OperationLease,
  context: ProjectOperationContext,
  overrides: Partial<SkinOperationResult> = {},
): SkinOperationResult {
  return {
    operation,
    operationId: lease.operationId,
    status: 'completed',
    targetProjectId: context.projectId ?? null,
    sourceCount: 0,
    plannedCubes: 0,
    createdCubes: 0,
    createdGroups: 0,
    removedCubes: 0,
    restoredCubes: 0,
    replacedGroups: 0,
    durationMs: 0,
    warnings: [],
    copiedProject: false,
    templateProjectCreated: false,
    templateRetainedBare: false,
    ...overrides,
  };
}

function requireProject(): ProjectIdentity & ModelProject {
  const project = activeProject();
  if (!project || !hasOpenProject()) {
    throw new SkinOperationError('NO_PROJECT', 'Open a Blockbench project before running this operation.');
  }
  return project;
}

function requireEditMode(): void {
  if (!isEditMode()) {
    throw new SkinOperationError('INVALID_MODE', 'This operation requires Blockbench Edit mode.');
  }
}

function createContext(lease: OperationLease): ProjectOperationContext {
  return new ProjectOperationContext(activeProject, lease.signal, isProjectOpen);
}

function getBoundHost(context: ProjectOperationContext): WriterHost {
  const target = context.assertActive() as ModelProject;
  return bindWriterHost(blockbenchHostForProject(target), context);
}

function resolveCube(context: ProjectOperationContext, key: string): Cube | undefined {
  context.assertActive();
  return Cube.all.find(cube => cube.uuid === key);
}

function resolveOptions(raw?: unknown): GeneratorOptions {
  return resolveGeneratorOptions(raw ?? {});
}

function copyToTarget(context: ProjectOperationContext, suffix: string): void {
  context.assertActive();
  duplicateCurrentProjectAsCopy(blockbenchDuplicateHost, suffix);
  // Copying intentionally changes the active project. Bind only after parsing completed.
  context.bindActiveProject();
}

function checkPlan(outcome: ScanOutcome, options: GeneratorOptions): void {
  if (outcome.voxelCount > options.maxVoxels) {
    throw new VoxelLimitError(outcome.voxelCount, options.maxVoxels);
  }
}

function normalizeConfirmed(
  confirmed: GeneratorPreferences | GeneratorOptions,
): GeneratorOptions {
  return resolveGeneratorOptions(confirmed);
}

export class SkinOperations {
  readonly coordinator = new OperationCoordinator();

  async generate(input: {
    options?: Partial<GeneratorPreferences>;
    auto?: boolean;
    confirm?: ConfirmOperation;
    signal?: AbortSignal;
  } = {}): Promise<SkinOperationResult> {
    return this.coordinator.run('generate', async lease => {
      requireEditMode();
      requireProject();
      const context = createContext(lease);
      context.bindActiveProject();
      const started = performance.now();
      let options = resolveOptions(input.options);
      let outcome = scanAndPlan(options);
      if (outcome.snapshots.length === 0) {
        if (input.auto) {
          return makeResult('generate', lease, context, { status: 'cancelled' });
        }
        throw new SkinOperationError('NO_TARGETS', 'No layer cubes are available to generate.');
      }
      checkPlan(outcome, options);

      if (input.auto && !options.autoApplyOnLoad) {
        return makeResult('generate', lease, context, {
          status: 'detected',
          sourceCount: outcome.snapshots.length,
          plannedCubes: outcome.voxelCount,
          createdCubes: 0,
          createdGroups: 0,
          warnings: outcome.warnings,
          durationMs: performance.now() - started,
        });
      }

      if (!input.auto && input.confirm) {
        const confirmed = await awaitOperationInput(input.confirm({
          groupCount: outcome.snapshots.length,
          cubeCount: outcome.snapshots.length,
          voxelCount: outcome.voxelCount,
          warnings: outcome.warnings,
        }, options), lease.signal);
        context.assertActive();
        if (!confirmed) {
          return makeResult('generate', lease, context, { status: 'cancelled' });
        }
        options = normalizeConfirmed(confirmed);
      }

      // Dialogs may take time; re-scan the bound project before copying or writing.
      context.assertActive();
      outcome = scanAndPlan(options);
      if (outcome.snapshots.length === 0) {
        throw new SkinOperationError('NO_TARGETS', 'No layer cubes are available to generate.');
      }
      checkPlan(outcome, options);
      const copiedProject = !input.auto && options.targetModel === 'copy';
      if (copiedProject) {
        copyToTarget(context, ' - 3D Layers');
        outcome = scanAndPlan(options);
        if (outcome.snapshots.length === 0) {
          throw new SkinOperationError('NO_TARGETS', 'The copied project has no layer cubes to generate.');
        }
        checkPlan(outcome, options);
      }
      context.assertActive();
      const applied = await applyOutcome(
        outcome,
        options,
        getBoundHost(context),
        key => resolveCube(context, key),
      );
      return makeResult('generate', lease, context, {
        createdCubes: applied.createdCubes,
        createdGroups: applied.createdGroups,
        sourceCount: outcome.snapshots.length,
        plannedCubes: outcome.voxelCount,
        durationMs: performance.now() - started,
        warnings: outcome.warnings,
        copiedProject,
      });
    }, input.signal);
  }

  async restore(input: {
    options?: Partial<GeneratorPreferences>;
    confirm?: ConfirmOperation;
    signal?: AbortSignal;
  } = {}): Promise<SkinOperationResult> {
    return this.coordinator.run('restore', async lease => {
      requireEditMode();
      requireProject();
      const context = createContext(lease);
      context.bindActiveProject();
      const started = performance.now();
      let options = resolveOptions(input.options);
      let candidates = collectRestoreCandidates();
      if (!candidates.length) {
        throw new SkinOperationError('NO_TARGETS', 'No generated layers are available to restore.');
      }
      const cubeCount = candidates.reduce((sum, candidate) => sum + candidate.children.length, 0);
      if (input.confirm) {
        const confirmed = await awaitOperationInput(input.confirm({
          groupCount: candidates.length,
          cubeCount,
          voxelCount: cubeCount,
          warnings: [],
        }, options), lease.signal);
        context.assertActive();
        if (!confirmed) {
          return makeResult('restore', lease, context, { status: 'cancelled' });
        }
        options = normalizeConfirmed(confirmed);
      }
      context.assertActive();
      const copiedProject = options.targetModel === 'copy';
      if (copiedProject) {
        copyToTarget(context, ' - Restored');
        candidates = collectRestoreCandidates();
        if (!candidates.length) {
          throw new SkinOperationError('NO_TARGETS', 'The copied project has no generated layers to restore.');
        }
      }
      const result = applyRestores(candidates, getBoundHost(context));
      return makeResult('restore', lease, context, {
        restoredCubes: result.restoredCubes,
        removedCubes: result.removedVoxels,
        durationMs: performance.now() - started,
        copiedProject,
      });
    }, input.signal);
  }

  async regenerate(input: {
    options?: Partial<GeneratorPreferences>;
    confirm?: ConfirmOperation;
    includeTransparent?: boolean;
    signal?: AbortSignal;
  } = {}): Promise<SkinOperationResult> {
    return this.coordinator.run('regenerate', async lease => {
      requireProject();
      const context = createContext(lease);
      context.bindActiveProject();
      const started = performance.now();
      let options = resolveOptions({ ...input.options, includeTransparent: input.includeTransparent ?? input.options?.includeTransparent });
      const sources = collectRegenerationSources();
      if (!sources.length) {
        throw new SkinOperationError('NO_TARGETS', 'No generated layers are available to regenerate.');
      }
      let outcome = planRegenerations(sources, options);
      checkPlan(outcome, options);
      if (input.confirm) {
        const confirmed = await awaitOperationInput(input.confirm({
          groupCount: sources.length,
          cubeCount: 0,
          voxelCount: outcome.voxelCount,
          warnings: outcome.warnings,
        }, options), lease.signal);
        context.assertActive();
        if (!confirmed) {
          return makeResult('regenerate', lease, context, { status: 'cancelled' });
        }
        options = normalizeConfirmed({ ...confirmed, includeTransparent: input.includeTransparent ?? confirmed.includeTransparent });
        outcome = planRegenerations(sources, options);
        checkPlan(outcome, options);
      }
      context.assertActive();
      const summary = await applyRegenerations(
        sources,
        outcome.plans,
        { maxVoxels: options.maxVoxels, batchSize: options.batchSize },
        getBoundHost(context),
      );
      return makeResult('regenerate', lease, context, {
        createdCubes: summary.createdCubes,
        removedCubes: summary.removedCubes,
        replacedGroups: summary.replacedGroups,
        sourceCount: sources.length,
        plannedCubes: outcome.voxelCount,
        durationMs: performance.now() - started,
        warnings: outcome.warnings,
      });
    }, input.signal);
  }

  async clearTransparent(input: { options?: Partial<GeneratorPreferences>; signal?: AbortSignal } = {}): Promise<SkinOperationResult> {
    return this.coordinator.run('clear_transparent', async lease => {
      requireProject();
      const context = createContext(lease);
      context.bindActiveProject();
      const started = performance.now();
      const options = resolveOptions(input.options);
      const summary = clearTransparentCubes(getBoundHost(context), options.alphaThreshold);
      return makeResult('clear_transparent', lease, context, {
        removedCubes: summary.removed,
        durationMs: performance.now() - started,
        warnings: [...summary.warnings],
      });
    }, input.signal);
  }

  async newSkin(input: NewSkinProjectSetup): Promise<SkinOperationResult> {
    return this.coordinator.run('new_skin', async lease => {
      const context = createContext(lease);
      const started = performance.now();
      const previousProject = activeProject();
      const { projectName } = input.createTemplateProject();
      context.bindActiveProject();
      const target = context.assertActive() as ModelProject;
      if (previousProject?.uuid === target.uuid) {
        throw new SkinOperationError('EXECUTION_FAILED', 'Blockbench did not open a new template project.');
      }
      target.name = input.name || projectName;
      if (input.identifier) {
        target.model_identifier = input.identifier;
      }
      const templateProjectCreated = true;
      await awaitOperationInput(input.waitForTextures(), lease.signal);
      context.assertActive();

      // New skins always process the full template, independent of editor selection preferences.
      const options = resolveGeneratorOptions({
        ...DEFAULT_OPTIONS,
        includeTransparent: true,
        processSelectedOnly: false,
        targetModel: 'current',
      });
      const outcome = scanAndPlan(options);
      if (outcome.snapshots.length === 0) {
        return makeResult('new_skin', lease, context, {
          status: 'template_retained',
          templateProjectCreated,
          templateRetainedBare: true,
          warnings: ['The template contains no layer cubes to voxelize.'],
          durationMs: performance.now() - started,
        });
      }
      if (outcome.voxelCount > options.maxVoxels) {
        throw new SkinOperationError(
          'VOXEL_LIMIT',
          `Voxel plan needs ${outcome.voxelCount} cubes; fixed limit is ${options.maxVoxels}.`,
          undefined,
          {
            voxelCount: outcome.voxelCount,
            limit: options.maxVoxels,
            targetProjectId: context.projectId,
            templateProjectCreated,
            templateRetainedBare: true,
          },
        );
      }
      for (const plan of outcome.plans) {
        plan.visibility = true;
      }
      const applied = await applyOutcome(
        outcome,
        options,
        getBoundHost(context),
        key => resolveCube(context, key),
      );
      return makeResult('new_skin', lease, context, {
        createdCubes: applied.createdCubes,
        createdGroups: applied.createdGroups,
        sourceCount: outcome.snapshots.length,
        plannedCubes: outcome.voxelCount,
        durationMs: performance.now() - started,
        warnings: outcome.warnings,
        templateProjectCreated,
      });
    }, input.signal);
  }
}

export const skinOperations = new SkinOperations();
