// 3D physique entry point. Screens import this module; it selects the renderer.
// Default: the MakeHuman CC0 base mesh fitted to the tape measurements (body3d-mesh.js).
// Alternate: the SDF raymarched renderer (body3d-sdf.js), kept for comparison/fallback.
export { mountBody3D, POSES, supported } from './body3d-mesh.js';
