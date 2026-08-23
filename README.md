# 3 Body Problem

Interactive Newtonian N-body simulator rendered in 3D with Three.js.

## Features

- One-, two-, and three-body simulation modes
- Three-dimensional Newtonian gravity with normalized `G = 1` units
- Velocity Verlet integration with a fixed physics timestep
- Collision merging that conserves mass and linear momentum
- Presets for single-body motion, binary systems, Figure-8, rotating triangle, and randomized three-body motion
- Editable mass, radius, position, velocity, name, and color
- Orbit/zoom camera controls and fading trajectory trails
- 0.1×, 1×, 5×, and 10× time scales
- Korean/English UI
- Responsive desktop/mobile control panel
- Automatic GitHub Pages deployment

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Versioning

The app follows [Semantic Versioning 2.0.0](https://semver.org/) using `MAJOR.MINOR.PATCH`.

The single source of truth for the current version is the `version` field in `package.json`. The web UI reads that value and displays it next to `3 Body Problem`.

See [VERSIONING.md](./VERSIONING.md) for the project-specific version bump and release policy.

## Numerical model

The simulator uses normalized units and a fixed timestep (`dt = 0.0015`). Rendering cadence is independent from the physics loop. Gravity uses a very small softening term to avoid singular numerical acceleration at effectively zero separation. Bodies whose radii overlap are merged using center-of-mass position and momentum-conserving velocity.
