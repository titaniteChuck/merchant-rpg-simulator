/** abilityFunc: every skill by name (heroes and enemies). */
import type { AbilityFn } from "./common.ts";
import { skillsA } from "./skills-a.ts";
import { skillsB } from "./skills-b.ts";

export const abilityFunc: Record<string, AbilityFn> = { ...skillsA, ...skillsB };
