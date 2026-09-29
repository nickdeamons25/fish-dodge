# Fish Dodge

Nuxt 4 SPA + Pinia + three.js dodge game. **Read `docs/STATUS.md` first** for where every element stands and what's missing.

## Commands
- `npm run dev`: dev server (if the in-app preview can't find `.claude/launch.json`, run `PORT=3517 npx nuxi dev --port 3517`)
- `npx nuxi typecheck`: must pass (TypeScript is pinned to v5 for vue-tsc)

## Conventions
- **Space:** gameplay lives in *tank space*: a giant round tank centred on the origin, with `x`/`z` across the floor and `y` as height above the sand, plus a `heading` for facing (see `app/game/constants.ts` and `tank/space.ts` `forward`/`right`). Only `tank/space.ts` `toWorld` converts to world space. Hazards live in their own frame, turned to their heading (`hazards/registry.ts` `Hazard`).
- **Models:** every model faces +X with Y up. Detailed fish use `app/game/entities/fishKit.ts` (`BodyProfile`, `swimUniforms`, `skinMaterial`, `finMaterial`, `finGeometry`, `addEyes`, `swimMesh`).
- **Depth of field:** anything that deforms in a vertex shader must set `mesh.userData.depthMaterial`, a depth material with the same patch, or it blurs wrongly. See `engine/DofPass.ts`. For see-through or cut-out objects, use `excludeFromDepth`.
- **Assets:** no binary assets. Textures are painted in canvas, and each species shares its geometry and textures.
- **New hazards:** add a `HazardDef` in `app/game/hazards/registry.ts` (`cooldown`, `minLevel`, `weight`, `speedFactor`).
- **Transparency:** overlay opacities are tuned for linear-space blending in the post-processing target.
