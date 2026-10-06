// KOH etch of single-crystal silicon: the level set of the page's src/core/fab/koh.js
// (kohCompute), operation for operation, so the same input gives the same voxels. The page
// classifies the voxels (codes), builds the rate and slope tables and the wafer basis, and sends
// them; this side only runs the evolution, with the per-step update spread over all cores.
#pragma once
#include <cstdint>
#include <vector>

namespace koh {

struct Input {
    int W = 0, H = 0, D = 1;                 // fine grid
    double hx = 10, hy = 2, hz = 10;         // nm
    double timeS = 0, coarseNm = 4;
    double ratePoly = 0, rateOx = 0, rateAl = 0;   // nm/s
    double bx[3]{}, bz[3]{}, bu[3]{};        // sample axes in crystal coordinates
    int lutN = 256;
    std::vector<float> lut, slut;           // (N+1)^2, lower-triangular, from crystal.js
    std::vector<uint8_t> codes;              // 0 etchant, 1 Si, 2 poly, 3 SiO2, 4 Al, 5 mask; z*W*H + y*W + x
};

struct Output { std::vector<uint8_t> mask; int steps = 0; };

Output etch(const Input &in, int threads);

}  // namespace koh
