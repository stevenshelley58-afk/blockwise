export const CONTENT_RUN_JOB_TYPE: string;
export const CONTENT_STEPS: Array<{
  skillName: string;
  status: string;
  defaultModelPolicy: string;
}>;

export function handleHermesContentRun(
  job: Record<string, any>,
  deps: {
    rest: (schema: string, path: string, init?: Record<string, any>) => Promise<any>;
    now: () => string;
    env: Record<string, any>;
    fetchImpl?: typeof fetch;
    workerId?: string;
    log?: (...args: any[]) => void;
  },
): Promise<{ status: string; blocked_reason?: string; result: Record<string, unknown> }>;

export function modelForContentSkill(env: Record<string, any>, modelPolicyId: string, skillName: string): string;
export function artifactsForContentSkill(
  skillName: string,
  output: Record<string, unknown>,
  context?: Record<string, any>,
): Array<{
  artifactType: string;
  title: string;
  data: Record<string, unknown>;
}>;
export function deterministicContentSkillOutput(skillName: string, input: Record<string, any>): Record<string, unknown>;
export function slugify(value: string): string;
