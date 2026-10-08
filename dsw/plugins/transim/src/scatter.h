// scatter.h -- bulk and edge scattering for the transport trajectory engine.
//
// Ported from the Klein magnetometer core (klein_physics.h), with two changes:
//   * phonons are their own channel (isotropic), not folded into the impurity
//     length with the impurity's angular law;
//   * the impurity length the user gives (directly, or from the mobility) is the
//     TRANSPORT mean free path.  A channel that only kicks by a small angle has to
//     fire more often to relax momentum as fast, so its event length is
//     l_event = l_tr * (1 - <cos dtheta>).  For isotropic scattering <cos> = 0 and
//     nothing changes.
//
// Channels:
//   impurity  : none | isotropic | forward (legacy uniform +-45 deg) |
//               smallangle (legacy uniform +-0.3 rad) | gaussian (sigma)
//   phonon    : isotropic, l_ph(T) = l_ph(300 K) * 300 / T   (off when l_ph300 <= 0)
//   e-e       : gaussian kick sigma_ee every l_ee (off when l_ee <= 0).  A one-body
//               approximation: real e-e collisions conserve total momentum, so this
//               channel is NOT counted in the mobility and NOT given to the FEM.
// Edges:
//   specular | diffuse | mixed (p = 0.5) | partial (p = specularity) | absorbing
//   The diffuse part follows Lambert's cosine law (the law that keeps an
//   equilibrium distribution in equilibrium), not a uniform angle.
#pragma once

#include <cmath>
#include <string>

namespace scat {

constexpr double PI_ = 3.14159265358979323846;

enum class Imp { None, Isotropic, Forward, SmallAngle, Gaussian };

inline Imp impFromName(const std::string &s) {
    if (s == "none") return Imp::None;
    if (s == "forward") return Imp::Forward;
    if (s == "smallangle") return Imp::SmallAngle;
    if (s == "gaussian") return Imp::Gaussian;
    return Imp::Isotropic;
}

// <cos dtheta> of one impurity event
inline double meanCos(Imp k, double sigma) {
    switch (k) {
    case Imp::Forward:    return std::sin(PI_ / 4) / (PI_ / 4);   // uniform +-45 deg
    case Imp::SmallAngle: return std::sin(0.3) / 0.3;             // uniform +-0.3 rad
    case Imp::Gaussian:   return std::exp(-0.5 * sigma * sigma);
    default:              return 0.0;
    }
}

struct Model {
    Imp imp = Imp::Isotropic;
    double sigma = 10 * PI_ / 180;   // gaussian impurity kick (rad)
    double phLen = 0;                // phonon length at the run temperature (m); 0 = off
    double eeLen = 0;                // e-e event length (m); 0 = off
    double eeSigma = 15 * PI_ / 180; // e-e kick (rad)

    // event length of the impurity channel for a given transport length
    double impEventLen(double ltr) const {
        if (imp == Imp::None) return 0;
        const double f = 1.0 - meanCos(imp, sigma);
        return ltr * (f > 1e-12 ? f : 1e-12);
    }
};

template <class RNG>
inline double normal(RNG &rng) {
    double u1 = rng.next(); if (u1 < 1e-300) u1 = 1e-300;
    const double u2 = rng.next();
    return std::sqrt(-2.0 * std::log(u1)) * std::cos(2 * PI_ * u2);
}

template <class RNG>
inline double kickImpurity(const Model &m, double theta, RNG &rng) {
    switch (m.imp) {
    case Imp::None:       return theta;
    case Imp::Forward:    return theta + (rng.next() - .5) * PI_ * .5;
    case Imp::SmallAngle: return theta + (rng.next() - .5) * .6;
    case Imp::Gaussian:   return theta + m.sigma * normal(rng);
    default:              return rng.next() * 2 * PI_;
    }
}

// The three channels compete; rates are 1/length.  Returns the total rate and
// leaves the per-channel rates for the choice at the event.
struct Rates { double imp = 0, ph = 0, ee = 0; double total() const { return imp + ph + ee; } };

inline Rates rates(const Model &m, double impEvent) {
    Rates r;
    if (m.imp != Imp::None && impEvent > 0) r.imp = 1.0 / impEvent;
    if (m.phLen > 0) r.ph = 1.0 / m.phLen;
    if (m.eeLen > 0) r.ee = 1.0 / m.eeLen;
    return r;
}

// Applies one bulk event.  With only the impurity channel active the RNG is used
// exactly as the original engine used it, so old runs reproduce bit for bit.
// Returns true when the event relaxes momentum (impurity or phonon).
template <class RNG>
inline bool applyEvent(const Model &m, const Rates &r, double &theta, RNG &rng) {
    const bool onlyImp = r.ph == 0 && r.ee == 0;
    if (onlyImp) { theta = kickImpurity(m, theta, rng); return true; }
    const double u = rng.next() * r.total();
    if (u < r.imp) { theta = kickImpurity(m, theta, rng); return true; }
    if (u < r.imp + r.ph) { theta = rng.next() * 2 * PI_; return true; }
    theta += m.eeSigma * normal(rng);
    return false;
}

// Edge reflection.  `p` is the specular fraction; RNG is touched only when
// 0 < p < 1 or when the reflection is diffuse, so a pure specular wall is
// bit-identical to the original engine.
template <class RNG>
inline double reflect(const std::string &edge, double specularity, double theta,
                      double nx, double ny, RNG &rng) {
    double p = 1;
    if (edge == "diffuse") p = 0;
    else if (edge == "mixed") p = 0.5;
    else if (edge == "partial") p = specularity < 0 ? 0 : (specularity > 1 ? 1 : specularity);
    bool spec = p >= 1 ? true : (p <= 0 ? false : rng.next() < p);
    if (!spec) {
        const double inward = std::atan2(-ny, -nx);
        return inward + std::asin(2 * rng.next() - 1);   // Lambert: P(a) ~ cos a
    }
    const double vx = std::cos(theta), vy = std::sin(theta), dot = vx * nx + vy * ny;
    return std::atan2(vy - 2 * dot * ny, vx - 2 * dot * nx);
}

} // namespace scat
