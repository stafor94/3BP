# 3 Body Problem

Interactive Newtonian three-body simulator rendered in 3D with Three.js.

## Features

- Three-dimensional Newtonian gravity with normalized `G = 1` units
- Velocity Verlet integration with a fixed physics timestep
- Collision merging that conserves mass and linear momentum
- Figure-8, rotating-triangle, and random presets
- Editable mass, radius, position, velocity, name, and color
- Orbit/zoom camera controls and trajectory trails
- 0.1×, 1×, 10×, and 100× time scales
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

## Numerical model

The simulator uses normalized units and a fixed timestep (`dt = 0.0015`). Rendering cadence is independent from the physics loop. Gravity uses a very small softening term to avoid singular numerical acceleration at effectively zero separation. Bodies whose radii overlap are merged using center-of-mass position and momentum-conserving velocity.
