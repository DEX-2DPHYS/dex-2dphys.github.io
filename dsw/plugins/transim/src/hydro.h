// hydro.h -- viscous (hydrodynamic) electron flow for transim: the linearised
// Stokes-Ohm model on a staggered (MAC) grid, solved directly with a sparse LU.
//
// Steady state of the electron fluid (Torre et al., PRB 92, 165433 (2015);
// Bandurin et al., Science 351, 1055 (2016); Alekseev, PRL 117, 166601 (2016)):
//
//     0 = (q/m) E + w (u x z) - u/tau_mr + nu_xx Lap u + nu_H (Lap u) x z,   div u = 0
//
// with w = qB/m the signed cyclotron frequency, nu_xx = nu0 / (1 + (2 w tau_ee)^2)
// and nu_H = nu0 2 w tau_ee / (1 + (2 w tau_ee)^2) the magnetic-field dependent
// shear and Hall viscosities, nu0 = vF^2 tau_ee / 4.  Writing the unknown as the
// current density times the Drude sheet resistivity, jt = rho j (a field, V/um),
// and J a = a x z = (a_y, -a_x), the equation becomes
//
//     -grad phi = jt - s J jt - D^2 Lap jt - Dh^2 J Lap jt ,   div jt = 0
//
// with s = w tau_mr (= -mu B for electrons, +mu B for holes), D^2 = nu_xx tau_mr
// (D is the Gurzhi length) and Dh^2 = nu_H tau_mr.  D = 0 is exactly Ohm's law
// with the Hall tensor, i.e. what the FEM solves.
//
// Grid: phi at cell centres, jt_x on vertical faces, jt_y on horizontal faces.
// Cells are FLUID, RES (a source/drain reservoir at a fixed potential) or SOLID.
// Walls (the device edge and SOLID cells): no current through them and a Navier
// slip condition on the tangential current, u_t = l_s du_t/dn (l_s = 0 no-slip,
// l_s < 0 means free slip).  At a reservoir the fluid leaves through an outflow
// condition (zero normal derivative of the current), with the potential fixed.
// Lengths are in micrometres throughout.
#pragma once
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>
#include "third_party/eigen/Eigen/Sparse"
#include "third_party/eigen/Eigen/SparseLU"

namespace hydro {

enum CellType : uint8_t { FLUID = 0, RES = 1, SOLID = 2, OUTSIDE = 3 };

struct Problem {
    int nx = 0, ny = 0;
    double dx = 0, dy = 0;          // um
    std::vector<uint8_t> cell;      // nx*ny, row-major (j*nx + i), j = 0 at the bottom
    std::vector<double> resV;       // potential of each RES cell (V)
    double D2 = 0, Dh2 = 0;         // um^2
    double s = 0;                   // w tau_mr
    double slip = 0;                // um; < 0 = free slip
};

struct Solution {
    bool ok = false;
    std::string error;
    std::vector<double> phi;        // nx*ny (V); NaN in SOLID cells
    std::vector<double> jx, jy;     // (nx+1)*ny and nx*(ny+1): jt on the faces (V/um)
    double residual = 0;
    int unknowns = 0, isolated = 0;  // isolated = fluid cells cut off from every reservoir (made solid)
};

namespace detail {
enum Face : uint8_t { UNK = 0, WALL = 1, RESIN = 2 };
inline uint8_t faceStatus(uint8_t a, uint8_t b) {
    if ((a == FLUID && (b == FLUID || b == RES)) || (b == FLUID && a == RES)) return UNK;
    if (a == FLUID || b == FLUID) return WALL;      // fluid against solid or outside
    if (a == RES || b == RES) return RESIN;         // inside a reservoir (or its edge)
    return WALL;
}
}  // namespace detail

inline Solution solve(Problem P) {
    using namespace detail;
    Solution S;
    const int nx = P.nx, ny = P.ny;
    if (nx < 2 || ny < 2 || (int)P.cell.size() != nx * ny) { S.error = "bad grid"; return S; }
    auto C = [&](int i, int j) -> uint8_t { return (i < 0 || j < 0 || i >= nx || j >= ny) ? OUTSIDE : P.cell[j * nx + i]; };

    // Fluid that no reservoir can reach has an undetermined potential: make it solid and say so.
    {
        std::vector<uint8_t> seen(nx * ny, 0);
        std::vector<int> st;
        for (int k = 0; k < nx * ny; ++k) if (P.cell[k] == RES) { seen[k] = 1; st.push_back(k); }
        if (st.empty()) { S.error = "no source or drain reservoir"; return S; }
        while (!st.empty()) {
            const int k = st.back(); st.pop_back();
            const int i = k % nx, j = k / nx;
            const int nb[4][2] = {{i + 1, j}, {i - 1, j}, {i, j + 1}, {i, j - 1}};
            for (auto &q : nb) {
                if (q[0] < 0 || q[1] < 0 || q[0] >= nx || q[1] >= ny) continue;
                const int m = q[1] * nx + q[0];
                if (!seen[m] && P.cell[m] == FLUID) { seen[m] = 1; st.push_back(m); }
            }
        }
        for (int k = 0; k < nx * ny; ++k) if (P.cell[k] == FLUID && !seen[k]) { P.cell[k] = SOLID; ++S.isolated; }
    }

    // face status and unknown numbering: jx faces, then jy faces, then phi in fluid cells
    std::vector<uint8_t> fx((nx + 1) * ny), fy(nx * (ny + 1));
    std::vector<int> ix((nx + 1) * ny, -1), iy(nx * (ny + 1), -1), ip(nx * ny, -1);
    int N = 0;
    for (int j = 0; j < ny; ++j) for (int i = 0; i <= nx; ++i) {
        const int f = j * (nx + 1) + i;
        fx[f] = faceStatus(C(i - 1, j), C(i, j));
        if (fx[f] == UNK) ix[f] = N++;
    }
    for (int j = 0; j <= ny; ++j) for (int i = 0; i < nx; ++i) {
        const int f = j * nx + i;
        fy[f] = faceStatus(C(i, j - 1), C(i, j));
        if (fy[f] == UNK) iy[f] = N++;
    }
    for (int k = 0; k < nx * ny; ++k) if (P.cell[k] == FLUID) ip[k] = N++;
    S.unknowns = N;
    if (N == 0) { S.error = "no fluid"; return S; }

    const double dx = P.dx, dy = P.dy, idx2 = 1 / (dx * dx), idy2 = 1 / (dy * dy);
    // tangential ghost across a wall at half a cell: g = a * u_inside (Navier slip)
    auto slipA = [&](double h) { return P.slip < 0 ? 1.0 : (2 * P.slip - h) / (2 * P.slip + h); };
    const double ax = slipA(dy), ay = slipA(dx);   // x-faces see walls across y; y-faces across x

    auto FX = [&](int i, int j) -> uint8_t { return (i < 0 || i > nx || j < 0 || j >= ny) ? (uint8_t)255 : fx[j * (nx + 1) + i]; };
    auto FY = [&](int i, int j) -> uint8_t { return (i < 0 || i >= nx || j < 0 || j > ny) ? (uint8_t)255 : fy[j * nx + i]; };

    typedef std::vector<std::pair<int, double>> Lin;
    // Laplacian of the x-face current at (i, j), as a linear combination of unknowns
    auto lapX = [&](int i, int j, Lin &out, double w) {
        double c = 0;
        for (int d = -1; d <= 1; d += 2) {           // along x: normal component
            const uint8_t st = FX(i + d, j);
            if (st == UNK) out.push_back({ix[j * (nx + 1) + i + d], w * idx2});
            else if (st == RESIN) c += idx2;          // zero gradient into the reservoir
            // WALL / outside: the normal current there is exactly 0
            c -= idx2;
        }
        for (int d = -1; d <= 1; d += 2) {           // across y: tangential component
            const uint8_t st = FX(i, j + d);         // 255 off the grid: the device edge
            if (st == UNK) out.push_back({ix[(j + d) * (nx + 1) + i], w * idy2});
            else if (st == RESIN) c += idy2;
            else c += ax * idy2;                     // a wall (device edge or solid): slip ghost
            c -= idy2;
        }
        out.push_back({ix[j * (nx + 1) + i], w * c});
    };
    auto lapY = [&](int i, int j, Lin &out, double w) {
        double c = 0;
        for (int d = -1; d <= 1; d += 2) {
            const uint8_t st = FY(i, j + d);
            if (st == UNK) out.push_back({iy[(j + d) * nx + i], w * idy2});
            else if (st == RESIN) c += idy2;
            c -= idy2;
        }
        for (int d = -1; d <= 1; d += 2) {
            const uint8_t st = FY(i + d, j);
            if (st == UNK) out.push_back({iy[j * nx + i + d], w * idx2});
            else if (st == RESIN) c += idx2;
            else c += ay * idx2;
            c -= idx2;
        }
        out.push_back({iy[j * nx + i], w * c});
    };

    std::vector<Eigen::Triplet<double>> T;
    T.reserve(static_cast<size_t>(N) * 24);
    Eigen::VectorXd b = Eigen::VectorXd::Zero(N);
    Lin lin;
    auto emit = [&](int row, const Lin &l, double scale) { for (const auto &e : l) if (e.first >= 0 && e.second != 0) T.emplace_back(row, e.first, scale * e.second); };

    // x momentum:  jt_x - s <jt_y> - D2 Lap jt_x - Dh2 <Lap jt_y> + (phi_R - phi_L)/dx = 0
    for (int j = 0; j < ny; ++j) for (int i = 0; i <= nx; ++i) {
        const int f = j * (nx + 1) + i, r = ix[f];
        if (r < 0) continue;
        T.emplace_back(r, r, 1.0);
        if (P.D2 != 0) { lin.clear(); lapX(i, j, lin, 1.0); emit(r, lin, -P.D2); }
        // the four y-faces around this x-face: walls count as zero, reservoir faces are left out
        const int yf[4][2] = {{i - 1, j}, {i - 1, j + 1}, {i, j}, {i, j + 1}};
        int cnt = 0;
        for (auto &q : yf) { const uint8_t st = FY(q[0], q[1]); if (st == UNK || st == WALL) ++cnt; }
        if (cnt > 0) {
            const double w = 1.0 / cnt;
            for (auto &q : yf) if (FY(q[0], q[1]) == UNK) {
                const int u = iy[q[1] * nx + q[0]];
                if (P.s != 0) T.emplace_back(r, u, -P.s * w);
                if (P.Dh2 != 0) { lin.clear(); lapY(q[0], q[1], lin, 1.0); emit(r, lin, -P.Dh2 * w); }
            }
        }
        const int kL = j * nx + i - 1, kR = j * nx + i;
        if (P.cell[kR] == FLUID) T.emplace_back(r, ip[kR], 1 / dx); else b[r] -= P.resV[kR] / dx;
        if (P.cell[kL] == FLUID) T.emplace_back(r, ip[kL], -1 / dx); else b[r] += P.resV[kL] / dx;
    }
    // y momentum:  jt_y + s <jt_x> - D2 Lap jt_y + Dh2 <Lap jt_x> + (phi_up - phi_down)/dy = 0
    for (int j = 0; j <= ny; ++j) for (int i = 0; i < nx; ++i) {
        const int f = j * nx + i, r = iy[f];
        if (r < 0) continue;
        T.emplace_back(r, r, 1.0);
        if (P.D2 != 0) { lin.clear(); lapY(i, j, lin, 1.0); emit(r, lin, -P.D2); }
        const int xf[4][2] = {{i, j - 1}, {i + 1, j - 1}, {i, j}, {i + 1, j}};
        int cnt = 0;
        for (auto &q : xf) { const uint8_t st = FX(q[0], q[1]); if (st == UNK || st == WALL) ++cnt; }
        if (cnt > 0) {
            const double w = 1.0 / cnt;
            for (auto &q : xf) if (FX(q[0], q[1]) == UNK) {
                const int u = ix[q[1] * (nx + 1) + q[0]];
                if (P.s != 0) T.emplace_back(r, u, P.s * w);
                if (P.Dh2 != 0) { lin.clear(); lapX(q[0], q[1], lin, 1.0); emit(r, lin, P.Dh2 * w); }
            }
        }
        const int kD = (j - 1) * nx + i, kU = j * nx + i;
        if (P.cell[kU] == FLUID) T.emplace_back(r, ip[kU], 1 / dy); else b[r] -= P.resV[kU] / dy;
        if (P.cell[kD] == FLUID) T.emplace_back(r, ip[kD], -1 / dy); else b[r] += P.resV[kD] / dy;
    }
    // continuity in every fluid cell (scaled by the cell size, so rows are O(1))
    for (int j = 0; j < ny; ++j) for (int i = 0; i < nx; ++i) {
        const int k = j * nx + i, r = ip[k];
        if (r < 0) continue;
        const int fl = j * (nx + 1) + i, fr = fl + 1, fb = j * nx + i, ft = (j + 1) * nx + i;
        if (ix[fr] >= 0) T.emplace_back(r, ix[fr], 1 / dx);
        if (ix[fl] >= 0) T.emplace_back(r, ix[fl], -1 / dx);
        if (iy[ft] >= 0) T.emplace_back(r, iy[ft], 1 / dy);
        if (iy[fb] >= 0) T.emplace_back(r, iy[fb], -1 / dy);
    }

    Eigen::SparseMatrix<double> A(N, N);
    A.setFromTriplets(T.begin(), T.end());
    A.makeCompressed();
    Eigen::SparseLU<Eigen::SparseMatrix<double>, Eigen::COLAMDOrdering<int>> lu;
    lu.analyzePattern(A);
    lu.factorize(A);
    if (lu.info() != Eigen::Success) { S.error = "sparse LU failed: " + lu.lastErrorMessage(); return S; }
    const Eigen::VectorXd x = lu.solve(b);
    if (lu.info() != Eigen::Success || !x.allFinite()) { S.error = "sparse LU solve failed"; return S; }
    const double bn = b.norm();
    S.residual = (A * x - b).norm() / (bn > 0 ? bn : 1.0);

    S.jx.assign((nx + 1) * ny, 0); S.jy.assign(nx * (ny + 1), 0);
    for (size_t f = 0; f < S.jx.size(); ++f) if (ix[f] >= 0) S.jx[f] = x[ix[f]];
    for (size_t f = 0; f < S.jy.size(); ++f) if (iy[f] >= 0) S.jy[f] = x[iy[f]];
    S.phi.assign(nx * ny, std::nan(""));
    for (int k = 0; k < nx * ny; ++k) {
        if (P.cell[k] == FLUID) S.phi[k] = x[ip[k]];
        else if (P.cell[k] == RES) S.phi[k] = P.resV[k];
    }
    S.ok = true;
    return S;
}

}  // namespace hydro
