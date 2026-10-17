# MakeHuman base mesh, skeleton and macro targets

From https://github.com/makehumancommunity/makehuman (makehuman/data), fetched 2026-10-15 for the realistic rider
and villagers. The bundled assets (base mesh, proxies, targets, rigs, weights) are released under **CC0 1.0**
(see LICENSE.md section C and LICENSE.ASSETS.md); the application code itself is AGPL and is not used.

- `base.obj` – base mesh (body plus helper geometry and joint marker groups), units are decimetres.
- `default_weights.mhw` – default skin weights (the skeleton file is not needed here).

Only the targets the Bluebird characters use are kept.
- `targets/*.target` – macro targets (ethnicity x gender x age, muscle and weight), as vertex index + offset.
