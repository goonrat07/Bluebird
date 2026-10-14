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
