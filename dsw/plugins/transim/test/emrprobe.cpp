// prints, for one example's messages, the FEM at several fields: convergence and every probe
//   emrprobe <example.msgs> [ohmic|hydro] B1 B2 ...
#include "../src/plugin.cpp"
#include <fstream>
int main(int argc, char **argv) {
    Instance s; std::ifstream in(argv[1]); std::string line;
    while (std::getline(in, line)) if (!line.empty()) handleMessage(s, line);
    std::string model = argc > 2 ? argv[2] : "ohmic";
    for (int a = 3; a < argc; ++a) {
        Params p = s.p; p.B = atof(argv[a]); p.fieldModel = model;
        FEMResult r = solveField(s, p);
        printf("B %5.2f %s conv %d direct %d iters %d resid %.2e I %.4e R2t %.4g |", p.B, r.model.c_str(), r.converged, r.direct, r.iters, r.residual, r.current, r.resistance);
        for (auto &q : r.probes) printf(" %s %.5g", q.first.c_str(), q.second);
        printf("\n");
    }
}
