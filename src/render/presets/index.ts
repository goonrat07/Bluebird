import { golden } from './golden';
import { noon } from './noon';
import type { LightPreset } from './types';

export type { LightPreset } from './types';
/** In the order the T key cycles through them; the first is the default. */
export const PRESETS: LightPreset[] = [golden, noon];
