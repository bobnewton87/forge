# Body mesh assets: source and license

`assets/body/body.bin` and `assets/body/body.json` (male) and `assets/body/body-female.bin` and
`assets/body/body-female.json` (female, built with `--sex=female`) are derived (by `scripts/build-body-mesh.mjs`) from
MakeHuman assets released under **CC0 1.0 Universal** (public-domain dedication).

## Source

- Repository: https://github.com/makehumancommunity/makehuman
- Commit: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` (master, fetched 2026-10-19)
- Files used (downloaded as plain data; no MakeHuman program code was run or copied):
  - `makehuman/data/3dobjs/base.obj`: hm08 base mesh. We keep the `body` group (13,380 vertices) and the two
    eyeball helpers, and drop the tights/skirt/hair/genital/teeth/tongue/eyelash helpers and the joint cubes.
  - `makehuman/data/rigs/default.mhskel`: joint definitions, collapsed to a 30-bone skeleton.
  - `makehuman/data/rigs/default_weights.mhw`: skinning weights, merged onto the 30 bones (top 4 per vertex).
  - `makehuman/data/targets/macrodetails/{caucasian,african,asian}-male-young.target`: the default male shape
    (mixed 0.7 / 0.15 / 0.15).
  - `makehuman/data/targets/macrodetails/universal-male-young-{min,average,max}muscle-{min,average,max}weight.target`:
    stored as sparse runtime morphs (muscle × weight grid).
  - The navel vertex index (4121) comes from `makehuman/data/targets/stomach/stomach-navel-in.target`.
- Female asset (`body-female.*`, same commit, same files plus):
  - `makehuman/data/targets/macrodetails/{caucasian,african,asian}-female-young.target`: the default female shape
    (mixed 0.7 / 0.15 / 0.15, the same weights as the male build).
  - `makehuman/data/targets/macrodetails/universal-female-young-{min,average,max}muscle-{min,average,max}weight.target`:
    stored as sparse runtime morphs (muscle × weight grid).
  - `makehuman/data/targets/breast/female-young-averagemuscle-averageweight-{min,max}cup-averagefirmness.target`:
    stored as two sparse cup-size morphs; the max-cup target also locates the inframammary-fold landmark.
  - The base mesh, skeleton and skin weights are the same files as for the male asset (same topology).

Each of these files carries the header: "This asset was explicitly released as CC0 in september 2020. The
license text for CC0 can be found in the root of this repository." The copyright holders at the time of
release were Data Collection AB, Joel Palmius and Jonas Hauquier.

## License text (from the repository at that commit)

`LICENSE.md`, section C, "The license for the bundled assets":

> The assets are defined as any data contributing to the graphical output of MakeHuman. This includes:
> the base mesh and proxies, targets and modifiers, textures, clothes (any MHCLO-based asset), poses and
> expressions. These assets have been released under CC0 1.0 Universal. In summary this means that to the
> fullest extent possible, it is the intention of the MakeHuman project that anyone can do whatever they
> want with it.

`LICENSE.ASSETS.md` is the full Creative Commons CC0 1.0 Universal legal code:
https://creativecommons.org/publicdomain/zero/1.0/legalcode

(MakeHuman's *program code* is AGPL-3.0. None of it is used here: the build script, the fitting, the
skinning and the renderer are original Forge code.)

The v2 workout clothing, hair pieces (ponytails, low bun, the bob's fall) and headwear (cap brim, crowns, headband)
are procedural geometry and shader regions written in Forge code; no outside asset is used for them.
