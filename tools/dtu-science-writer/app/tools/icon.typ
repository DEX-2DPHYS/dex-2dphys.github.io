// App icon (512×512 PNG): node tools/make-icon.js renders it with the bundled Typst.
#set page(width: 512pt, height: 512pt, margin: 0pt, fill: none)
#place(center + horizon, rect(width: 480pt, height: 480pt, radius: 96pt, fill: rgb("#990000")))
#place(center + horizon, dy: -6pt, rect(width: 300pt, height: 370pt, radius: 18pt, fill: white))
#place(center + horizon, dy: -70pt, text(font: "STIX Two Math", size: 150pt, fill: rgb("#990000"))[$sum$])
#for (i, w) in ((0, 220pt), (1, 220pt), (2, 160pt)) {
  place(center + horizon, dx: -(220pt - w) / 2, dy: 70pt + i * 38pt, rect(width: w, height: 14pt, radius: 7pt, fill: rgb("#b9b5ad")))
}
