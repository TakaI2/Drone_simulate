# Third-party notices

The source code of Drone Design Studio is released under the MIT License (see `LICENSE`).
The following data and libraries keep their own licenses.

## Data

| Data | Files | License / attribution |
|---|---|---|
| 3D 都市モデル（Project PLATEAU）横浜市（2024 年度） | `out/city/buildings_plateau.json`, `out/city/scene.json`, `reports/city.html` 他 | PLATEAU サイトポリシー（CC BY 4.0 互換）。表示：「3D 都市モデル（Project PLATEAU）横浜市（2024 年度）」（国土交通省）を加工して作成 |
| OpenStreetMap | `out/city/buildings_osm.json`（建物・公園） | © OpenStreetMap contributors. Open Database License (ODbL) 1.0 — https://opendatacommons.org/licenses/odbl/ 。この派生データベースは ODbL 1.0 で提供する（MIT ではない） |
| 部品価格 | `src/budget/prices.ts`, `reports/budget.html` | 各販売店の公開価格を個別に確認した参考値（調査日・参照元を記載）。価格は変動する |

## Runtime libraries (bundled in the web app)

| Library | License |
|---|---|
| three.js | MIT |
| manifold-3d | Apache-2.0 |
| three-bvh-csg, three-mesh-bvh | MIT |

## Development tools (not distributed)

vite, vitest, typescript, eslint, typescript-eslint, tsx, marked, gerber-parser, pcb-stackup (MIT / Apache-2.0), playwright-core (Apache-2.0).
Videos are encoded with an ffmpeg binary at development time; ffmpeg is not part of this repository or the web app.

## Design references (no code included)

ArduPilot, PX4, Betaflight, ESP-Drone, AM32, Bluejay, Freerouting and others were used only as design references.
No GPL code is included in this repository.
