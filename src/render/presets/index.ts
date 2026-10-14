import { blueHour } from './blueHour';
import { dawn } from './dawn';
import { golden } from './golden';
import { morning } from './morning';
import { night } from './night';
import { noon } from './noon';
import type { LightPreset } from './types';

export type { LightPreset } from './types';
/** Through the day in the order the T key steps through them; the first is the default. */
export const PRESETS: LightPreset[] = [golden, blueHour, night, dawn, morning, noon];
export { blendPresets } from './blend';
