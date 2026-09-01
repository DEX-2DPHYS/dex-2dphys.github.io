// Exercise the edge-group emitter in lmpexport.h both ways.
#include "lmpexport.h"
#include <cstdio>
#include <string>

static std::string lineAt(const std::string &s, size_t p) {
    if (p == std::string::npos) return "<not found>";
    size_t e = s.find('\n', p);
    return s.substr(p, (e == std::string::npos ? s.size() : e) - p);
}

int main() {
    // 1. springs off: the group must be empty and must NOT list ids
    lmpexport::Deck D;
    D.edgeK = 0;
    D.isEdge.assign(100, 1);
    std::string off = lmpexport::exportDeck(D)[1].text;
    printf("edgeK = 0 -> %s\n", lineAt(off, off.find("group edge")).c_str());
    printf("           id list present? %s\n",
           off.find("group edge id") == std::string::npos ? "no (correct)" : "YES - BUG");

    // 2. springs on with three runs of ids: expect a:b ranges, not 31 ids
    lmpexport::Deck E;
    E.edgeK = 1.0;
    E.isEdge.assign(100, 0);
    for (int i = 0; i < 20; i++) E.isEdge[i] = 1;   // ids 1..20
    for (int i = 60; i < 70; i++) E.isEdge[i] = 1;  // ids 61..70
    E.isEdge[95] = 1;                               // id 96
    std::string on = lmpexport::exportDeck(E)[1].text;
    size_t c = on.find("# 31 edge atoms");
    printf("edgeK > 0 -> %s\n", lineAt(on, c).c_str());
    printf("           %s\n", lineAt(on, on.find("group edge id")).c_str());
    return 0;
}
