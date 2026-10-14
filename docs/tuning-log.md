# Tuning log

Every accepted change to riding feel: date, what the player said, what changed, and why.

## 2026-10-14 · Feel pass 1

Player: "feels really rough… can't pinpoint why". Scripted rides showed four causes.

| Change | Old → new | Why |
| --- | --- | --- |
| `SPORTS.board.airDrag` | 0.0032 → 0.007 | Riding straight with no input reached 162 km/h. Now about 70 km/h cruising, 90 in a tuck. |
| `SPORTS.ski.airDrag` | 0.0028 → 0.0065 | Same, skis stay a little faster. |
| `SPORTS.ski.tuckDrag` | 0.42 → 0.5 | Ski tuck reached 169 km/h; now about 93. |
| Air drag in the air | none → same `airDrag` | Every kicker added speed because nothing slowed the rider in the air. |
| `SPORTS.board.pivotRate` | 2.4 → 1.4 | At a standstill one tap spun the board to face uphill. |
| `SPORTS.ski.pivotRate` | 2.0 → 1.2 | Same. |
| Keys held through takeoff | spin/flip at once → ignored until pressed again | Holding W to tuck into a jump started a frontflip and usually a bail; holding a carve over a lip started a full-speed spin. |
| Render interpolation | position only → position, heading and pitch | Turns and spins stepped visibly on high refresh rate screens. |

## 2026-10-14 · Feel pass 2

Player: "skiing switch messes up the leaning direction and it looks goofy… a slight delay is what makes it feel realistic… a little bit of a higher camera angle, somewhere between Riders Republic and Grand Mountain Adventure."

| Change | Old → new | Why |
| --- | --- | --- |
| Lean while riding switch | same side as forward → mirrored | The body faces the other way when switch, so the lean has to flip to stay into the turn. |
| Body follows the equipment | instant → smoothed (`BODY` in `riderModel.ts`) | Lean, crouch and arms now ease in over roughly a tenth of a second, which reads as weight. |
| Upper body lead | none → turns 0.35 rad into the turn | The shoulders look into the turn just before the legs follow. |
| Landing compression | none → 0.6 extra crouch, recovering in about 0.3 s | Touchdowns absorb instead of snapping upright. |
| Lean amount | 0.7 × edge → 0.6 × edge | Less "lying on the snow" at moderate speeds. |
| Camera (`CAMERA` in `scene.ts`) | 6.5 m back, 3 m up → 7 m back, 7.5 m up, looking down the hill | Higher view between Riders Republic and Grand Mountain Adventure. Camera and body values are now in the tuning panel. |

## 2026-10-14 · Held keys carry into the air

Player: "when i jump, if i was already holding like the a key, it doesn't turn to the left unless i release the key and press it again… do the same for W/S".

| Change | Old → new | Why |
| --- | --- | --- |
| Keys held through takeoff | ignored until pressed again → act immediately | Pre-loading a spin by holding A/D before the lip is how the player wants to ride. W/S follow the same rule, so a tuck held off a jump starts a frontflip. |

## 2026-10-14 · Flow and gap sense in the glade

Phase 2 vertical slice: the glade on the skier's left between z 470 and 770.

| Change | Old → new | Why |
| --- | --- | --- |
| Flow (`FLOW`) | none → near misses within 2.4 m above 6 m/s build Flow, which drains after a 1.4 s grace | Rewards threading the trees. Full Flow cuts friction and drag by 30% and adds 50% to trick scores. |
| Branch clips | none → passing within 0.4 m slows to 96% and costs 25% Flow, with a snow splat on screen | Brushing a tree should sting without being a crash. |
| Crashes and glancing hits | none → a crash empties Flow; a glancing hit keeps 30% | Flow is earned by clean lines. |
| Gap sense (`ASSIST.gapSense`, `GAP`) | none → relaxed 1.4, normal 1.1, real 0 | Gently steers away from a trunk dead ahead, looking 0.8 s down the line. Bot bails across 15 glade lines drop from 35 on real to 15 on normal and 6 on relaxed. |
| Glade camera | standard → 4 m up, 5.5 m back, looking 5 m ahead; FOV widens with Flow | The high run camera hides the gaps between trees. |
