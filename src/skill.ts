/**
 * Skill Interface Definition
 *
 * A "Skill" is a capability unit of an agent:
 *   - - It receives input (SkillContext)
 *   - - Executes processing logic
 *   - - Returns outputs (SkillResult)
 *
 * WalrusAgent will automatically upload SkillResult.outputs to Walrus.
 */

import type { SkillContext, SkillInfo, SkillResult } from "./types.js";

/**
 * Skill interface. Any capability that wants to be invoked by WalrusAgent must implement it.
 */
export interface Skill {
  /** Return the metadata of this Skill. */
  info(): SkillInfo;
  /**
   * - Executes processing logic。
   * @param ctx The input context
   */
  run(ctx: SkillContext): Promise<SkillResult>;
}

/**
 * A simple Skill abstract base class for quick implementation via functions.
 *
 * Usage:
 *   const mySkill = defineSkill({
 *     info: { name: "echo", ... },
 *     run: async (ctx) => ({ ok: true, message: ctx.input })
 *   });
 */
export class FunctionSkill implements Skill {
  private readonly _info: SkillInfo;
  private readonly _run: (ctx: SkillContext) => Promise<SkillResult>;

  constructor(
    info: SkillInfo,
    run: (ctx: SkillContext) => Promise<SkillResult>,
  ) {
    this._info = info;
    this._run = run;
  }

  info(): SkillInfo {
    return this._info;
  }

  run(ctx: SkillContext): Promise<SkillResult> {
    return this._run(ctx);
  }
}

/**
 * Quickly define a Skill using an object.
 */
export function defineSkill(skill: Skill): Skill {
  return skill;
}

/**
 * Quickly define a Skill using an info object + a run function.
 */
export function createSkill(
  info: SkillInfo,
  run: (ctx: SkillContext) => Promise<SkillResult>,
): Skill {
  return new FunctionSkill(info, run);
}