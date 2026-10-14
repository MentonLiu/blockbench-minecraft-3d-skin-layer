import { SkinOperationError } from './errors';

export interface ProjectIdentity {
  readonly uuid: string;
}

export type ActiveProjectProvider = () => ProjectIdentity | undefined;

/** Captures the intended project and rejects any later work after a tab switch or close. */
export class ProjectOperationContext {
  private target?: ProjectIdentity;

  constructor(
    private readonly getActiveProject: ActiveProjectProvider,
    private readonly signal: AbortSignal,
    private readonly isProjectOpen: (project: ProjectIdentity) => boolean = () => true,
  ) {}

  bindActiveProject(): ProjectIdentity {
    this.assertNotCancelled();
    const project = this.getActiveProject();
    if (!project || !this.isProjectOpen(project)) {
      throw new SkinOperationError('NO_PROJECT', 'No active project is open.');
    }
    this.target = project;
    return project;
  }

  assertActive(): ProjectIdentity {
    this.assertNotCancelled();
    const active = this.getActiveProject();
    if (
      !this.target ||
      !active ||
      active.uuid !== this.target.uuid ||
      !this.isProjectOpen(this.target)
    ) {
      throw new SkinOperationError('PROJECT_CHANGED', 'The active project changed during the operation.');
    }
    return this.target;
  }

  get projectId(): string | undefined {
    return this.target?.uuid;
  }

  private assertNotCancelled(): void {
    if (this.signal.aborted) {
      const reason = this.signal.reason;
      if (reason instanceof SkinOperationError) {
        throw reason;
      }
      throw new SkinOperationError('CANCELLED', 'The operation was cancelled.', { cause: reason });
    }
  }
}
