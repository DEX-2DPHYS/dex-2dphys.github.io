// Micro-textbooks: a book symbol beside every view preset opens a one-page chapter about
// that object. The figures are grabbed from the running simulation itself (main.js hands us
// a capture function), so a figure can never drift out of step with what the model shows.
//
// This is a first-level mock-up of a learning portal: each page is real, finished content,
// and the row of buttons at the foot stands for the deeper material a full portal would
// carry. Those buttons deliberately answer with a "not in this mock-up" note rather than
// pretending to navigate somewhere.
//
// No maths library: equations are laid out with the small CSS kit in template.html
// (.eq / .mi / .frac), which renders crisply offline and needs nothing bundled.

const BOOK_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
  '<path d="M4 4.2c2.7-.9 5.3-.9 8 .3v15c-2.7-1.2-5.3-1.2-8-.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M20 4.2c-2.7-.9-5.3-.9-8 .3v15c2.7-1.2 5.3-1.2 8-.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '</svg>';

// ---------------------------------------------------------------- small helpers for maths
const mi = (s) => `<span class="mi">${s}</span>`;
const frac = (n, d) => `<span class="frac"><span class="fr-n">${n}</span><span class="fr-d">${d}</span></span>`;

// ---------------------------------------------------------------- shared SVG furniture
const svgOpen = (h = 150) =>
  `<svg viewBox="0 0 320 ${h}" width="100%" height="auto" role="img" class="dia">`;

// ---------------------------------------------------------------- the chapters
// Each: crumb, title, lead, facts, sections, figures (sim captures + schematics), related.
const TOPICS = {

  overview: {
    crumb: 'Salmonella · structure to therapy ›The cell',
    title: 'Salmonella enterica',
    lead: 'A Gram-negative rod a thousandth of a millimetre wide, with no nucleus and no internal compartments — and yet a complete, self-replicating pathogen. Understanding how each of its parts works is how we find something to stop it with.',
    facts: [
      ['Shape', 'rod (bacillus), peritrichous flagella'],
      ['Size', '0.7–1.5 µm across, 2–5 µm long'],
      ['Genome', '≈ 4.8 Mbp on one circular chromosome'],
      ['Doubling time', '20–40 min at 37 °C, rich medium'],
      ['Metabolism', 'facultative anaerobe'],
    ],
    sections: [
      { h: 'A cell with no rooms in it',
        html: `<p>The defining negative of a prokaryote is architectural: there is no nuclear
        envelope and no membrane-bound organelle. The chromosome sits directly in the cytoplasm
        as the <em>nucleoid</em>, and every soluble enzyme in the cell can reach it. One
        consequence is immediate and important — transcription and translation happen in the
        same compartment, at the same time, on the same molecule of mRNA.</p>
        <p>What the cell does have is a layered <em>envelope</em>. Reading outwards from the
        cytoplasm: the inner (plasma) membrane, then the periplasm with its thin peptidoglycan
        net, then the outer membrane whose external leaflet is lipopolysaccharide. Gram-negative
        means precisely this: two membranes with a thin wall between them.</p>` },
      { h: 'Why bacteria are small',
        html: `<p>Nothing inside the cell is stirred. Material moves by diffusion, and the time
        to cross a distance ${mi('x')} scales with its square,</p>
        <div class="eq">${mi('τ')} <span class="op">≈</span> ${frac(mi('x') + '<span class="op2">²</span>', '6' + mi('D'))}</div>
        <p>so that a small protein (${mi('D')} ≈ 10 µm²&#8201;s⁻¹) crosses a 1 µm cell in about
        20 ms, but would need half a minute to cross a 300 µm one. Diffusion is a superb
        delivery system at bacterial scale and a hopeless one above it. A cell that stays small
        also keeps a large surface-to-volume ratio, and for a rod of radius ${mi('r')} and
        length ${mi('L')},</p>
        <div class="eq">${frac(mi('S'), mi('V'))} <span class="op">=</span> ${frac('2', mi('r'))} <span class="op">+</span> ${frac('2', mi('L'))}</div>
        <p>every gram of cytoplasm is served by a great deal of membrane — which is where the
        transport proteins and the energy-converting machinery in the other chapters sit.</p>` },
      { h: 'Why this organism',
        html: `<p><em>Salmonella enterica</em> is a food-borne pathogen and, for the same
        reasons, one of the best-described model bacteria: its flagellar motor, its envelope
        transport proteins and its secretion systems are all structurally characterised. Nearly
        everything shown in this model is known to near-atomic resolution.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'overview', opts: { zoom: 0.88 },
        cap: 'The whole cell, swimming. The flagellar bundle trails behind; the short hair-like fimbriae cover the surface.' },
      { kind: 'svg', cap: 'The Gram-negative envelope: two membranes, with the peptidoglycan net between them.',
        svg: svgOpen(168) + `
        <defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e8b96a"/><stop offset="1" stop-color="#c99442"/></linearGradient></defs>
        <rect x="0" y="6" width="320" height="26" fill="url(#og)" opacity=".85"/>
        <text x="8" y="24" class="dl">outer membrane (LPS leaflet outside)</text>
        <rect x="0" y="32" width="320" height="46" fill="#cfe0ec" opacity=".55"/>
        <text x="8" y="50" class="dl">periplasm</text>
        <path d="M0 62 H320 M0 70 H320" stroke="#7d9bb0" stroke-width="2"/>
        <path d="M20 62 V70 M60 62 V70 M100 62 V70 M140 62 V70 M180 62 V70 M220 62 V70 M260 62 V70 M300 62 V70" stroke="#7d9bb0" stroke-width="2"/>
        <text x="8" y="88" class="dl">peptidoglycan (thin, 1–3 layers)</text>
        <rect x="0" y="94" width="320" height="26" fill="#8fc0a9" opacity=".8"/>
        <text x="8" y="112" class="dl">inner (plasma) membrane</text>
        <rect x="0" y="120" width="320" height="42" fill="#f2f5f8" opacity=".5"/>
        <text x="8" y="140" class="dl">cytoplasm — nucleoid + ribosomes, no organelles</text>
        <text x="8" y="156" class="dls">energy conversion happens in the inner membrane</text>
        </svg>` },
    ],
    target: { tag: 'Why this is hard', html:
      `<p>The envelope in the diagram is the reason Gram-negative infections are difficult to
      treat. A useful drug has to be small and polar enough to get through a porin, stable in
      the periplasm, and not immediately thrown back out by an efflux pump — three demands that
      pull against each other. Only a handful of genuinely new antibacterial classes have
      reached the clinic against Gram-negatives in fifty years.</p>
      <p>Every chapter in this portal closes with what its object offers someone trying to build
      that drug.</p>` },
    related: ['inside', 'porin', 'motor'],
  },

  motor: {
    crumb: 'Salmonella · structure to therapy ›Motility › The motor',
    title: 'The flagellar motor',
    lead: 'A rotary electric motor 45 nm across, built from about twenty different proteins, running on a proton current instead of a wire.',
    facts: [
      ['Diameter', '≈ 45 nm (basal body)'],
      ['Rotation', '100–300 Hz, both directions'],
      ['Stall torque', '≈ 1300 pN·nm'],
      ['Fuel', 'proton-motive force, not ATP'],
      ['Cost', '≈ 1200 H⁺ per revolution'],
    ],
    sections: [
      { h: 'What the parts do',
        html: `<p>The rotor is a stack of rings threaded on a drive shaft. The <strong>C-ring</strong>
        (FliG, FliM, FliN) sits in the cytoplasm and carries the charged residues that the
        stators push against; it is also the switch that reverses the motor. The
        <strong>MS-ring</strong> (FliF) anchors the assembly in the inner membrane. The
        <strong>rod</strong> runs outwards through the <strong>P-ring</strong> in the
        peptidoglycan and the <strong>L-ring</strong> in the outer membrane, which act as
        bushings, and emerges as the hook.</p>
        <p>The stators — <strong>MotA</strong>₅<strong>MotB</strong>₂ units — are not part of the
        rotor at all. They are anchored to the peptidoglycan and form the proton channels.
        Around eleven can engage at once, and they exchange with a spare pool in the membrane
        within seconds, so the motor can change gear with load.</p>` },
      { h: 'The fuel is a gradient',
        html: `<p>No ATP is consumed here. The motor is driven by the
        <em>proton-motive force</em>, the free energy stored in the proton gradient across the
        inner membrane, with a charge term and a concentration term:</p>
        <div class="eq">Δ${mi('p')} <span class="op">=</span> Δ${mi('ψ')} <span class="op">−</span> ${frac('2.303&#8201;' + mi('RT'), mi('F'))}&#8201;ΔpH</div>
        <p>At 37 °C the prefactor is 61.5 mV per pH unit, and a respiring cell holds
        Δ${mi('p')} ≈ −150 to −200 mV. Each proton crossing a stator gives up that much energy,
        which is why roughly 1200 of them are needed for one turn against load.</p>
        <p>The mechanical output is the ordinary product of torque and angular velocity,</p>
        <div class="eq">${mi('P')} <span class="op">=</span> ${mi('T')}&#8201;${mi('ω')} <span class="op">=</span> 2π&#8201;${mi('T')}&#8201;${mi('f')}</div>
        <p>which at 1300 pN·nm and 100 Hz comes to about 0.8 pW — and the motor converts the
        proton current to that with an efficiency that approaches unity near stall.</p>` },
      { h: 'Switching',
        html: `<p>Binding of phosphorylated CheY to FliM in the C-ring flips the motor from
        counter-clockwise to clockwise. That single switch is the entire mechanical output of
        the chemotaxis system, and it is what turns a run into a tumble in the next chapter.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'motor', opts: {},
        cap: 'The basal body cut open: C-ring below, MS-ring in the inner membrane, rod rising through the P- and L-rings.' },
      { kind: 'svg', cap: 'Proton flow through a stator drives the C-ring; ≈ 1200 H⁺ per revolution.',
        svg: svgOpen(150) + `
        <rect x="0" y="34" width="320" height="18" fill="#8fc0a9" opacity=".8"/>
        <rect x="0" y="86" width="320" height="18" fill="#8fc0a9" opacity=".8"/>
        <text x="6" y="30" class="dls">periplasm — high H⁺</text>
        <text x="6" y="122" class="dls">cytoplasm — low H⁺</text>
        <rect x="120" y="30" width="26" height="78" rx="6" fill="#c2803f" opacity=".85"/>
        <text x="133" y="20" class="dl" text-anchor="middle">stator</text>
        <circle cx="133" cy="40" r="4" fill="#d94f4f"/><circle cx="133" cy="62" r="4" fill="#d94f4f"/>
        <circle cx="133" cy="84" r="4" fill="#d94f4f"/><circle cx="133" cy="104" r="4" fill="#d94f4f"/>
        <path d="M133 34 V112" stroke="#d94f4f" stroke-width="1.4" stroke-dasharray="3 3"/>
        <path d="M128 112 l5 8 l5 -8" fill="#d94f4f"/>
        <ellipse cx="225" cy="104" rx="66" ry="17" fill="none" stroke="#5ea4d6" stroke-width="3"/>
        <text x="225" y="136" class="dl" text-anchor="middle">C-ring (rotor)</text>
        <path d="M168 104 a57 15 0 0 1 20 -12" fill="none" stroke="#5ea4d6" stroke-width="2.4"/>
        <path d="M188 92 l-9 1 l5 6" fill="#5ea4d6"/>
        <text x="225" y="76" class="dl" text-anchor="middle">torque ≈ 1300 pN·nm</text>
        </svg>` },
    ],
    target: { tag: 'Anti-virulence, not antibiotic', html:
      `<p>Motility is needed to reach and invade the gut epithelium, but not to grow in a flask.
      Disable the motor and the organism is <em>attenuated</em> rather than killed — and a drug
      that does not threaten survival exerts far weaker selection for resistance. That is the
      appeal of anti-virulence therapy, and its difficulty: the clinical endpoint is harder to
      demonstrate than killing.</p>
      <p>There is a structural bonus. The flagellar export apparatus at the base of this motor
      is evolutionarily the same machine as the type III secretion injectisome
      <em>Salmonella</em> uses to inject effectors into host cells. An inhibitor of one is a
      plausible starting point against the other.</p>` },
    related: ['filament', 'atp', 'overview'],
  },

  filament: {
    crumb: 'Salmonella · structure to therapy ›Motility › The propeller',
    title: 'The flagellar filament',
    lead: 'A hollow helical tube of one repeated protein, up to ten micrometres long, that works as a corkscrew because at this scale water behaves like treacle.',
    facts: [
      ['Built from', 'flagellin (FliC), one subunit repeated'],
      ['Diameter', '≈ 20 nm, hollow channel ≈ 2 nm'],
      ['Length', 'up to 10–15 µm'],
      ['Architecture', '11 protofilaments'],
      ['Swimming speed', '20–40 µm s⁻¹'],
    ],
    sections: [
      { h: 'Self-assembly through its own core',
        html: `<p>The filament is not built from the outside. Flagellin subunits are unfolded,
        pushed through the 2 nm channel that runs the whole length of the structure, and fold
        into place at the distal tip under a cap protein (FliD). A filament therefore grows at
        its far end, and growth slows as it lengthens — the diffusion path down the channel gets
        longer.</p>` },
      { h: 'Life at low Reynolds number',
        html: `<p>Whether inertia matters at all is decided by the Reynolds number, the ratio of
        inertial to viscous forces:</p>
        <div class="eq">Re <span class="op">=</span> ${frac(mi('ρ') + '&#8201;' + mi('v') + '&#8201;' + mi('L'), mi('μ'))}</div>
        <p>For a 2 µm cell moving at 30 µm&#8201;s⁻¹ in water this is about 10⁻⁴ &#8201;–&#8201; 10⁻⁵.
        Inertia is utterly negligible. Switch the motor off and the cell stops within about
        0.1 µm — less than its own diameter. It cannot coast, and it cannot swim by any
        reciprocal, back-and-forth motion: a corkscrew, which is not reciprocal, is one of the
        few shapes that works.</p>` },
      { h: 'Run and tumble',
        html: `<p>Counter-clockwise rotation lets the several filaments coil into a single
        bundle that drives the cell forwards — a <strong>run</strong>, lasting about a second.
        When one motor reverses, the change in torque flips that filament between helical forms
        (normal left-handed → curly right-handed), the bundle flies apart and the cell
        <strong>tumbles</strong> for about a tenth of a second, ending up pointing somewhere
        new.</p>
        <p>The cell cannot steer. All chemotaxis does is lengthen runs that happen to be
        heading up an attractant gradient — a biased random walk, and it is enough.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'filament', opts: {},
        cap: 'The rotating helical filament. The visible pitch is the 11-protofilament lattice winding around the tube.' },
      { kind: 'svg', cap: 'Biased random walk: runs up the gradient are extended, tumbles randomise direction.',
        svg: svgOpen(150) + `
        <defs><linearGradient id="chem" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#f4f7fa"/><stop offset="1" stop-color="#9fd3b4"/></linearGradient></defs>
        <rect x="0" y="0" width="320" height="150" fill="url(#chem)" opacity=".7"/>
        <text x="8" y="16" class="dls">low attractant</text>
        <text x="312" y="16" class="dls" text-anchor="end">high attractant</text>
        <path d="M24 116 L74 100" stroke="#33506a" stroke-width="2.4" fill="none"/>
        <path d="M74 100 L86 112" stroke="#d98b3f" stroke-width="2.4" fill="none"/>
        <path d="M86 112 L150 88" stroke="#33506a" stroke-width="2.4" fill="none"/>
        <path d="M150 88 L158 100" stroke="#d98b3f" stroke-width="2.4" fill="none"/>
        <path d="M158 100 L246 64" stroke="#33506a" stroke-width="2.4" fill="none"/>
        <path d="M246 64 L252 76" stroke="#d98b3f" stroke-width="2.4" fill="none"/>
        <path d="M252 76 L296 48" stroke="#33506a" stroke-width="2.4" fill="none"/>
        <circle cx="24" cy="116" r="4" fill="#33506a"/><circle cx="296" cy="48" r="4" fill="#33506a"/>
        <line x1="20" y1="134" x2="44" y2="134" stroke="#33506a" stroke-width="2.4"/>
        <text x="50" y="138" class="dl">run (≈ 1 s)</text>
        <line x1="130" y1="134" x2="154" y2="134" stroke="#d98b3f" stroke-width="2.4"/>
        <text x="160" y="138" class="dl">tumble (≈ 0.1 s)</text>
        </svg>` },
    ],
    target: { tag: 'A vaccine lead, not a drug', html:
      `<p>Flagellin is the ligand for host <strong>TLR5</strong> and one of the strongest innate
      immune stimuli known — a liability for the bacterium, and an opportunity for us.
      Flagellin fused to an antigen works as a built-in adjuvant, and such constructs have been
      through clinical trials.</p>
      <p>The filament is also how we name the organism: the flagellar H antigens, with the O
      antigens of the outer membrane, define the serovars — Typhimurium, Enteritidis — on which
      outbreak tracing depends.</p>` },
    related: ['motor', 'overview', 'inside'],
  },

  porin: {
    crumb: 'Salmonella · structure to therapy ›Envelope › Outer membrane',
    title: 'Porins',
    lead: 'Water-filled barrels of β-sheet that make the outer membrane a sieve — and, incidentally, decide whether an antibiotic can get in at all.',
    facts: [
      ['Assembly', 'trimer of 16-stranded β-barrels'],
      ['Pore constriction', '≈ 7 × 11 Å'],
      ['Exclusion limit', '≈ 600 Da'],
      ['Transport', 'passive diffusion, no energy'],
      ['Copies per cell', '10⁵ or more'],
    ],
    sections: [
      { h: 'Why a barrel and not a helix',
        html: `<p>Nearly every inner-membrane protein crosses the bilayer as an α-helix. Outer
        membrane proteins almost never do — they are β-barrels. The reason is how they are
        built: they are exported unfolded through the periplasm, which has no ATP, and a barrel
        can be inserted and closed by the BAM machinery without an energy source. OmpF and OmpC
        each fold 16 antiparallel strands into a barrel, and three barrels associate into the
        trimer the model shows.</p>
        <p>The pore is not open all the way down. Loop L3 folds back inside and pinches it to a
        slot of roughly 7 × 11 Å, lined with charged residues on opposite walls. That
        constriction sets what can pass.</p>` },
      { h: 'A sieve with a cut-off',
        html: `<p>There is no pump and no gate. Flux follows Fick's first law,</p>
        <div class="eq">${mi('J')} <span class="op">=</span> <span class="op">−</span>${mi('D')}&#8201;${frac('d' + mi('C'), 'd' + mi('x'))}</div>
        <p>so solutes simply run downhill, and selectivity is almost entirely a matter of size.
        Below about 600 Da a hydrophilic molecule passes; above it, essentially nothing does.
        Small nutrients — sugars, amino acids, phosphate — get in freely.</p>
        <p>Hydrophobic molecules are blocked by a different mechanism: the outer leaflet is not
        phospholipid but <strong>lipopolysaccharide</strong>, whose tightly packed, cross-linked
        sugar chains make a barrier that greasy compounds cannot dissolve through. Between LPS
        outside and a 600 Da cut-off through the pores, the Gram-negative envelope excludes most
        of chemical space. It is the single biggest reason Gram-negative bacteria are harder to
        treat than Gram-positive ones.</p>` },
      { h: 'Regulation, and resistance',
        html: `<p>The cell tunes which porin it makes. The EnvZ/OmpR two-component system favours
        the narrower OmpC at high osmolarity — as in a host gut — and the wider OmpF in dilute
        surroundings. Losing porins entirely is a common route to clinical resistance: β-lactams
        enter through them, and a mutant that stops making them is that much harder to
        poison.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'porin', opts: {},
        cap: 'A porin trimer in the outer membrane, with ions streaming through the three barrels.' },
      { kind: 'svg', cap: 'The permeability cut-off: small hydrophilic solutes pass, larger ones do not.',
        svg: svgOpen(150) + `
        <line x1="40" y1="118" x2="306" y2="118" stroke="#8496a6" stroke-width="1.6"/>
        <line x1="40" y1="118" x2="40" y2="20" stroke="#8496a6" stroke-width="1.6"/>
        <text x="40" y="140" class="dls" text-anchor="middle">100</text>
        <text x="150" y="140" class="dls" text-anchor="middle">600 Da</text>
        <text x="280" y="140" class="dls" text-anchor="middle">2000</text>
        <text x="14" y="30" class="dls">flux</text>
        <path d="M40 34 C 90 36, 128 44, 150 74 C 166 100, 186 114, 300 117"
              fill="none" stroke="#5ea4d6" stroke-width="3"/>
        <line x1="150" y1="20" x2="150" y2="118" stroke="#d94f4f" stroke-width="1.6" stroke-dasharray="4 4"/>
        <text x="156" y="34" class="dl" fill="#d94f4f">exclusion limit</text>
        <circle cx="70" cy="48" r="5" fill="#6fae87"/><text x="80" y="52" class="dls">glucose 180</text>
        <circle cx="196" cy="96" r="7" fill="#d98b3f"/><text x="208" y="100" class="dls">vancomycin 1449</text>
        </svg>` },
    ],
    target: { tag: 'The bottleneck of the whole field', html:
      `<p>These pores are the door β-lactams and fluoroquinolones come in through. Reduced porin
      expression is a routine clinical resistance mechanism, and it compounds: less influx
      through porins plus more efflux equals a compound that never reaches its target, whatever
      its affinity.</p>
      <p>For discovery the problem is inverted — getting molecules <em>in</em> is the single
      hardest constraint in Gram-negative antibacterial chemistry, and it is why so many
      excellent enzyme inhibitors never become drugs. One recent answer sidesteps the pores
      entirely: cefiderocol is built as a siderophore, so the cell imports it through its own
      iron-uptake machinery — a Trojan horse rather than a key.</p>` },
    related: ['kchannel', 'overview', 'atp'],
  },

  kchannel: {
    crumb: 'Salmonella · structure to therapy ›Envelope › Inner membrane',
    title: 'The potassium channel',
    lead: 'Four identical subunits around a pore that passes K⁺ a thousand times more readily than Na⁺ — while being the larger of the two ions.',
    facts: [
      ['Assembly', 'tetramer, four-fold symmetric'],
      ['Filter sequence', 'T–V–G–Y–G'],
      ['Selectivity', 'K⁺ over Na⁺ ≈ 1000 : 1'],
      ['Throughput', '10⁷–10⁸ ions s⁻¹'],
      ['Roles', 'turgor, pH homeostasis, membrane potential'],
    ],
    sections: [
      { h: 'Choosing the bigger ion',
        html: `<p>The puzzle is that K⁺ (1.33 Å) is <em>larger</em> than Na⁺ (0.95 Å), yet the
        channel passes K⁺ and rejects Na⁺. A simple hole could not do this. The answer is that
        an ion in water is not bare — it carries a shell of water molecules, and to enter the
        filter it must shed it, which costs energy.</p>
        <p>The filter recovers that cost by <em>imitating</em> the lost shell. The backbone
        carbonyl oxygens of the T–V–G–Y–G signature point into the pore at exactly the spacing
        of the oxygens in the hydration shell of K⁺. Stripping K⁺ is therefore nearly free. Na⁺
        is too small to contact all of them at once, so its dehydration is not paid for, and it
        does not go through. Selectivity by a snug fit — not by a filter that is simply
        narrower.</p>` },
      { h: 'What the gradient is worth',
        html: `<p>At equilibrium the electrical and chemical driving forces cancel, at the Nernst
        potential:</p>
        <div class="eq">${mi('E')}<sub>K</sub> <span class="op">=</span> ${frac(mi('RT'), mi('zF'))}&#8201;ln&#8201;${frac('[K⁺]<sub>out</sub>', '[K⁺]<sub>in</sub>')}</div>
        <p>With ${mi('z')} = 1 at 37 °C, ${mi('RT')}/${mi('F')} = 26.7 mV, so in base-10 form the
        familiar 61.5 mV per tenfold difference:</p>
        <div class="eq">${mi('E')}<sub>K</sub> <span class="op">=</span> 61.5&#8201;mV <span class="op">×</span> log<sub>10</sub>&#8201;${frac('[K⁺]<sub>out</sub>', '[K⁺]<sub>in</sub>')}</div>
        <p>A bacterium holds perhaps 200–300 mM K⁺ inside against a few mM outside, a hundredfold
        ratio — worth about −123 mV.</p>` },
      { h: 'Potassium is how this organism survives a host',
        html: `<p>K⁺ is the cell's main osmotic counter-ion. Accumulating it raises internal
        osmolarity and generates the turgor that presses the membrane against the peptidoglycan
        wall — without turgor a bacterium cannot elongate or divide. But for a pathogen the
        sharper point is that K⁺ handling is what lets it survive the journey into a host.</p>
        <p><strong>Through the stomach.</strong> <em>Salmonella</em> must pass pH 2 to reach the
        gut. K⁺/H⁺ exchange is part of how the cytoplasm is held near neutral while the outside
        is three orders of magnitude more acidic, and acid-resistance mutants are correspondingly
        poor at infecting.</p>
        <p><strong>Inside the macrophage.</strong> Having been engulfed, the cell sits in an
        acidified, nutrient-poor vacuole. Potassium scarcity is one of the cues that tells it
        where it is: the two-component sensor <strong>KdpD/KdpE</strong> reads K⁺ limitation and
        switches on the high-affinity <em>kdpFABC</em> uptake pump, and the same regulator is
        tied into the expression of virulence genes. Reading the ion composition of the
        surroundings is, for a bacterium, how it recognises that it is inside us.</p>
        <p>Maintaining K⁺ also maintains the membrane potential, and Δ${mi('ψ')} is what powers
        the type III secretion injectisome — the needle through which <em>Salmonella</em>
        delivers effector proteins into the host cell. Lose the gradient and the needle
        stops.</p>` },
      { h: 'The host reads potassium too',
        html: `<p>The traffic runs both ways, and this is one of the most elegant results in
        innate immunity. When a pathogen punctures a host cell membrane, K⁺ — which is
        concentrated inside our cells — leaks out. That <em>fall in cytosolic K⁺</em> is the
        trigger that activates the <strong>NLRP3 inflammasome</strong>, which cleaves and
        releases IL-1β and drives the infected cell into pyroptosis.</p>
        <p>In other words, our immune system does not detect the bacterium directly. It detects
        a potassium concentration dropping, and infers damage. A single ion doing duty as an
        alarm signal.</p>` },
      { h: 'Why drug developers care',
        html: `<p>This protein has had more influence on medicine than almost any other
        bacterial structure, and mostly not as a drug target.</p>
        <p><strong>It was the template.</strong> The 1998 structure of KcsA, a K⁺ channel from a
        soil bacterium, was the first atomic view of any ion channel, and it explained
        selectivity at a stroke (MacKinnon, Nobel Prize 2003). Human K⁺ channels are built to
        the same plan, and essentially everything we understand about them is read through that
        bacterial structure.</p>
        <p><strong>It is why your medicines are safe.</strong> The human cardiac channel
        <strong>hERG</strong> repolarises the heartbeat, and a remarkable range of unrelated
        drugs block it by accident, lengthening the QT interval and risking fatal arrhythmia.
        Several drugs were withdrawn before this was understood. Today every candidate compound
        in the industry is screened against hERG, and regulators require it — a routine test
        that exists, and is interpretable, because of work that began on channels like this
        one.</p>
        <p><strong>And as a target.</strong> Bacterial K⁺ uptake systems are attractive
        antibacterial targets precisely because they are needed for virulence rather than for
        growth in broth — a drug against them would disarm the pathogen rather than kill it,
        which puts weaker selection on resistance. None has yet reached the clinic; it remains an
        open problem, and a good one.</p>` },
    ],
    // Annotated figure. Each pin is a point in the channel's OWN coordinates (z is the pore
    // axis, +z the periplasmic side); main.js projects them through the capture camera, so
    // the markers sit on the real parts instead of on guessed pixel positions.
    explore: {
      title: 'Explore the structure',
      hint: 'Click a marker to read what that part does. The image is rendered live from the model beneath this page.',
      view: 'kchannel',
      opts: { w: 1180, anchors: { obj: 'kchannel', pts: [
        [0, 0, 1.6],            // ion sitting in the filter
        [0.72, 0.82, 1.38],     // pore helix, midpoint
        [1.86, -0.38, 0],       // outer helix M1, mid-membrane
        [-0.15, 0.84, -2.4],    // inner helix M2 at the bundle crossing
        [0, 0, 3.4],            // outer vestibule, ions queueing
        [-3.9, 0.2, 0],         // open bilayer, well clear of the protein
      ] } },
      pins: [
        { name: 'Selectivity filter',
          text: 'The narrowest part, lined by the backbone carbonyls of the T–V–G–Y–G signature. A K⁺ ion sheds its water here and is held by those oxygens instead — which is why the <em>larger</em> ion is the one that passes.',
          deeper: ['Doyle et al., Science 280 (1998) — the first KcsA structure',
                   'Worked problem: why is Na⁺ rejected?'] },
        { name: 'Pore helix',
          text: 'Four short helices aimed at the filter from below. Their electrical dipoles point their negative ends at the ion, stabilising a full positive charge in the middle of a lipid membrane — a place it has no business being.',
          deeper: ['Helix dipoles and ion stabilisation — background note'] },
        { name: 'Outer helix (M1)',
          text: 'The transmembrane helix facing the lipid. It does not line the pore; it anchors the subunit in the bilayer and packs against its neighbours.',
          deeper: ['Membrane protein topology — chapter section'] },
        { name: 'Inner helix (M2) — the gate',
          text: 'Four inner helices cross near the cytoplasmic mouth and pinch it shut. Splaying this bundle apart is how the channel opens, and it is the part most drug-like molecules bind.',
          deeper: ['Gating models — chapter section',
                   'Why hERG blockade is a drug-safety problem'] },
        { name: 'Outer vestibule',
          text: 'The periplasmic mouth, where ions queue before entry. In human channels this funnel is the target of peptide toxins from scorpions and sea anemones — the classic pharmacological tools of the field.',
          deeper: ['Toxins as channel probes — further reading'] },
        { name: 'The lipid bilayer',
          text: 'The inner membrane the channel sits in. It is not passive scenery: bound lipids sit in grooves between subunits and are needed for the channel to work at all, and the same membrane carries the proton gradient that powers the cell.',
          deeper: ['ATP synthase — the other machine in this membrane'] },
      ],
    },
    figures: [
      { kind: 'sim', view: 'kchannel', opts: {},
        cap: 'The K⁺ channel tetramer seen from the periplasm, with ions queueing through the filter.' },
      { kind: 'svg', cap: 'The selectivity filter: carbonyl oxygens stand in for the hydration shell K⁺ gives up.',
        svg: svgOpen(158) + `
        <rect x="118" y="10" width="26" height="130" fill="#cfe0ec" opacity=".5"/>
        <rect x="176" y="10" width="26" height="130" fill="#cfe0ec" opacity=".5"/>
        <text x="160" y="152" class="dls" text-anchor="middle">pore axis</text>
        <g stroke="#c2803f" stroke-width="2" fill="none">
          <path d="M144 34 l10 6 M176 34 l-10 6"/><path d="M144 62 l10 6 M176 62 l-10 6"/>
          <path d="M144 90 l10 6 M176 90 l-10 6"/><path d="M144 118 l10 6 M176 118 l-10 6"/>
        </g>
        <circle cx="160" cy="46" r="9" fill="#7b5ed6" opacity=".85"/>
        <text x="160" y="50" class="dlw" text-anchor="middle">K⁺</text>
        <circle cx="160" cy="102" r="9" fill="#7b5ed6" opacity=".85"/>
        <text x="160" y="106" class="dlw" text-anchor="middle">K⁺</text>
        <text x="214" y="40" class="dl">C=O oxygens</text>
        <text x="214" y="56" class="dls">spaced like water</text>
        <circle cx="52" cy="104" r="7" fill="#d94f4f" opacity=".8"/>
        <text x="52" y="108" class="dlw" text-anchor="middle">Na</text>
        <text x="20" y="128" class="dls">Na⁺ too small —</text>
        <text x="20" y="142" class="dls">cannot reach all four</text>
        <path d="M66 100 L112 84" stroke="#d94f4f" stroke-width="1.8" stroke-dasharray="4 3"/>
        <path d="M100 78 l12 6 l-11 6" fill="none" stroke="#d94f4f" stroke-width="1.8"/>
        <line x1="96" y1="66" x2="118" y2="92" stroke="#d94f4f" stroke-width="2.4"/>
        <line x1="118" y1="66" x2="96" y2="92" stroke="#d94f4f" stroke-width="2.4"/>
        </svg>` },
    ],
    target: { tag: 'Template, safety screen — and an open problem', html:
      `<p>Three distinct contributions to medicine, only one of them a drug target.</p>
      <p><strong>Template:</strong> the bacterial channel gave us the structural language in
      which all K⁺ channels, ours included, are now described. <strong>Safety:</strong> that
      understanding underpins the hERG assay every drug candidate in the world must pass.
      <strong>Target:</strong> bacterial K⁺ uptake is required for virulence more than for
      growth, so an inhibitor would disarm rather than kill — attractive for resistance
      management, and still unsolved.</p>` },
    related: ['atp', 'porin', 'overview'],
  },

  atp: {
    crumb: 'Salmonella · structure to therapy ›Bioenergetics',
    title: 'F₁F₀ ATP synthase',
    lead: 'The proton gradient turns a rotor; the rotor bends three catalytic sites in turn; the sites make ATP. A molecular machine that is literally a turbine.',
    facts: [
      ['Two motors', 'F₀ in the membrane, F₁ in the cytoplasm'],
      ['F₀ rotor', 'c-ring, 10 subunits in E. coli'],
      ['F₁ head', 'α₃β₃ with a central γ shaft'],
      ['Stoichiometry', '≈ 10 H⁺ per 3 ATP'],
      ['Reversible', 'runs backwards as a proton pump'],
    ],
    sections: [
      { h: 'Chemiosmotic coupling',
        html: `<p>Peter Mitchell's 1961 proposal — that the link between respiration and ATP
        synthesis is not a chemical intermediate but a proton gradient across a membrane — was
        resisted for a decade and is now the organising idea of bioenergetics. The respiratory
        chain pumps H⁺ out of the cytoplasm; the gradient thus built is the same Δ${mi('p')}
        that drives the flagellar motor; and ATP synthase lets the protons back in through a
        machine that does work with them.</p>` },
      { h: 'How the rotation is produced',
        html: `<p>Protons do not pass straight through. Each enters a half-channel in the
        a-subunit from the periplasm, binds a conserved carboxylate on one c-subunit, rides the
        c-ring almost a full turn, and leaves by a second half-channel into the cytoplasm. Since
        a proton can only bind where the ring meets the a-subunit, the ring is obliged to turn
        in one direction. With ten c-subunits, ten protons give one revolution.</p>
        <p>The c-ring is rigidly coupled to the γ shaft, which runs up the middle of the α₃β₃
        head. γ is asymmetric, so as it turns it deforms each of the three catalytic β subunits
        in sequence through three states — open, loose, tight. This is Boyer's <em>binding
        change</em> mechanism, and the surprise it contains is that forming ATP on the enzyme
        costs almost nothing. The energy goes into <em>releasing</em> it.</p>` },
      { h: 'The sums',
        html: `<p>One revolution passes ten protons and yields three ATP, so about 3.3 H⁺ per
        ATP. The cost of making one is set by how far the cell holds the reaction from
        equilibrium:</p>
        <div class="eq">Δ${mi('G')} <span class="op">=</span> Δ${mi('G')}°′ <span class="op">+</span> ${mi('RT')}&#8201;ln&#8201;${frac('[ATP]', '[ADP][P<sub>i</sub>]')}</div>
        <p>Δ${mi('G')}°′ is +30.5 kJ&#8201;mol⁻¹, but a living cell keeps ATP far above its
        equilibrium level, and the real cost is nearer +50 kJ&#8201;mol⁻¹. Three of those per
        turn is what 10 protons falling through −180 mV must pay for — the machine runs close to
        the thermodynamic limit.</p>
        <p>Run the gradient down and the enzyme reverses: it hydrolyses ATP and pumps protons
        outwards. Fermenting bacteria do exactly this to keep Δ${mi('p')} up for their
        flagella.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'atp', opts: {},
        cap: 'ATP synthase from the cytoplasm: the F₁ head, with the F₀ rotor embedded in the inner membrane below.' },
      { kind: 'svg', cap: 'Protons crossing F₀ turn the c-ring and γ shaft; the F₁ head makes ATP.',
        svg: svgOpen(160) + `
        <rect x="0" y="96" width="320" height="22" fill="#8fc0a9" opacity=".8"/>
        <text x="6" y="92" class="dls">periplasm (high H⁺)</text>
        <text x="6" y="134" class="dls">cytoplasm (low H⁺)</text>
        <ellipse cx="150" cy="107" rx="40" ry="12" fill="#c2803f" opacity=".8"/>
        <text x="150" y="111" class="dlw" text-anchor="middle">c-ring</text>
        <rect x="194" y="94" width="16" height="26" rx="4" fill="#9a6a34"/>
        <text x="228" y="112" class="dls">a-subunit</text>
        <path d="M202 92 V70 M202 122 V140" stroke="#d94f4f" stroke-width="1.6" stroke-dasharray="3 3"/>
        <circle cx="202" cy="82" r="4" fill="#d94f4f"/><circle cx="202" cy="132" r="4" fill="#d94f4f"/>
        <text x="212" y="76" class="dls" fill="#d94f4f">H⁺</text>
        <line x1="150" y1="96" x2="150" y2="54" stroke="#5a6b7c" stroke-width="5"/>
        <text x="158" y="76" class="dls">γ shaft</text>
        <ellipse cx="150" cy="42" rx="46" ry="24" fill="#5ea4d6" opacity=".75"/>
        <text x="150" y="40" class="dlw" text-anchor="middle">α₃β₃</text>
        <text x="150" y="54" class="dlw" text-anchor="middle">ADP + P&#8201;→&#8201;ATP</text>
        <path d="M104 26 a52 26 0 0 1 24 -12" fill="none" stroke="#33506a" stroke-width="2"/>
        <path d="M128 14 l-9 1 l5 6" fill="#33506a"/>
        </svg>` },
    ],
    target: { tag: 'Clinically validated', html:
      `<p>This machine is not a theoretical target — it is a proven one.
      <strong>Bedaquiline</strong>, approved in 2012 for multi-drug-resistant tuberculosis,
      binds the c-ring of mycobacterial ATP synthase and jams the rotor. The bacterium cannot
      make ATP and dies. It was the first genuinely new tuberculosis drug in forty years.</p>
      <p>The obstacle to repeating that against <em>Salmonella</em> is selectivity: our own
      mitochondria run the same enzyme, inherited from a bacterial ancestor. Bedaquiline works
      because the mycobacterial c-ring differs enough to be singled out. Whether a comparable
      foothold exists on the Gram-negative enzyme is exactly the kind of question this structure
      is used to ask.</p>` },
    related: ['motor', 'kchannel', 'inside'],
  },

  inside: {
    crumb: 'Salmonella · structure to therapy ›Cytoplasm',
    title: 'Inside the cell',
    lead: 'A millimetre and a half of DNA folded into a couple of micrometres, tens of thousands of ribosomes, and a solution so crowded it barely counts as a solution.',
    facts: [
      ['Chromosome', '≈ 4.8 Mbp, circular, ≈ 1.6 mm uncoiled'],
      ['Compaction', '≈ 1000-fold, into the nucleoid'],
      ['Ribosomes', '70S (50S + 30S); 20 000 – 70 000 per cell'],
      ['Translation', '15–20 amino acids s⁻¹'],
      ['Crowding', '300–400 mg mL⁻¹ macromolecules'],
    ],
    sections: [
      { h: 'The nucleoid',
        html: `<p>Stretched out, the chromosome would be 1.6 mm long — some five hundred times
        the length of the cell holding it. It is compacted without a nucleus and without
        histones: by negative supercoiling, by organising into topologically independent
        domains, and by nucleoid-associated proteins (HU, H-NS, Fis, IHF) that bend and bridge
        the DNA.</p>
        <p>The result is not a tangle but a structure, occupying a defined central region, with
        genes positioned reproducibly. Yet it has no membrane, so polymerases, regulators and
        ribosomes all reach it directly.</p>` },
      { h: 'Transcription and translation at once',
        html: `<p>This is the consequence with the widest reach. In a eukaryote, transcription
        finishes in the nucleus and the mRNA is processed and exported before any ribosome sees
        it. In a bacterium, ribosomes load onto the 5′ end of an mRNA that is still being
        transcribed, and the leading ribosome can follow within a few tens of nucleotides of the
        polymerase.</p>
        <p>Because the two are physically coupled, regulation can act on the link itself — this
        is what makes attenuation possible, where the speed of a ribosome on a leader peptide
        decides whether the polymerase downstream continues. It also means an mRNA can be
        translated and degraded within minutes, so a bacterium can change its protein repertoire
        very fast.</p>` },
      { h: 'A crowded cytoplasm',
        html: `<p>At 300–400 mg&#8201;mL⁻¹, macromolecules take up a third of the volume. Nothing
        behaves as it would in dilute buffer: diffusion is slowed several-fold, and excluded
        volume pushes equilibria towards the compact state, favouring folding and assembly.
        Ribosomes are large enough to be sterically pushed out of the nucleoid, which is part of
        why the DNA and the ribosomes occupy visibly different regions in this model.</p>` },
    ],
    figures: [
      { kind: 'sim', view: 'inside', opts: {},
        cap: 'Inside the cytoplasm: ribosomes crowding around the folded nucleoid.' },
      { kind: 'svg', cap: 'Coupled transcription and translation — impossible in a cell with a nucleus.',
        svg: svgOpen(150) + `
        <path d="M10 60 H310" stroke="#33506a" stroke-width="3"/>
        <text x="10" y="50" class="dls">DNA</text>
        <ellipse cx="120" cy="60" rx="20" ry="13" fill="#d98b3f" opacity=".9"/>
        <text x="120" y="64" class="dlw" text-anchor="middle">RNAP</text>
        <path d="M120 73 C 140 92, 180 96, 250 96" fill="none" stroke="#6fae87" stroke-width="2.6"/>
        <text x="150" y="88" class="dls">mRNA (still being made)</text>
        <circle cx="168" cy="100" r="11" fill="#5ea4d6" opacity=".85"/>
        <circle cx="206" cy="103" r="11" fill="#5ea4d6" opacity=".85"/>
        <circle cx="244" cy="101" r="11" fill="#5ea4d6" opacity=".85"/>
        <text x="206" y="130" class="dl" text-anchor="middle">ribosomes translating</text>
        <path d="M168 89 v-10 M206 92 v-10 M244 90 v-10" stroke="#8496a6" stroke-width="1.4" stroke-dasharray="3 2"/>
        <text x="290" y="60" class="dls" text-anchor="end">→ transcription</text>
        </svg>` },
    ],
    target: { tag: 'The richest target space we have', html:
      `<p>Most antibiotics in clinical use act on what is in this picture. The
      <strong>ribosome</strong> alone is the target of the aminoglycosides, tetracyclines,
      macrolides, phenicols and oxazolidinones — it is druggable because the bacterial 70S
      differs enough from our 80S to be hit selectively.</p>
      <p>The <strong>nucleoid</strong> supplies the other great class. DNA gyrase, the enzyme
      that keeps the chromosome supercoiled, is the target of the fluoroquinolones, and
      ciprofloxacin has been front-line treatment for invasive <em>Salmonella</em>. Point
      mutations in <em>gyrA</em> now make that increasingly unreliable — which is the reason the
      rest of this portal is worth reading.</p>` },
    related: ['overview', 'atp', 'motor'],
  },
};

// The deeper levels a real portal would carry. They are listed honestly as unbuilt.
const MORE = [
  ['chapter', 'Full chapter', 'M4 5h16v14H4z'],
  ['video', 'Video lecture', 'M8 5l11 7-11 7z'],
  ['problems', 'Problem set', 'M5 4h14v16H5z'],
  ['lab', 'Lab exercise', 'M9 3v7L4 20h16l-5-10V3z'],
  ['reading', 'Further reading', 'M4 6h16M4 12h16M4 18h10'],
];

export function initPortal({ requestFigure, onNavigate }) {
  // ---- book symbol beside every preset ------------------------------------
  document.querySelectorAll('.views [data-view]').forEach((btn) => {
    const id = btn.dataset.view;
    if (!TOPICS[id]) return;
    const row = document.createElement('div');
    row.className = 'vrow';
    btn.parentNode.insertBefore(row, btn);
    row.appendChild(btn);
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'vinfo';
    info.dataset.topic = id;
    info.title = `Micro-textbook — ${TOPICS[id].title}`;
    info.setAttribute('aria-label', info.title);
    info.innerHTML = BOOK_SVG;
    info.addEventListener('click', (e) => { e.stopPropagation(); open(id); });
    row.appendChild(info);
  });

  // ---- the reader ---------------------------------------------------------
  const el = document.createElement('div');
  el.id = 'mt';
  el.hidden = true;
  el.innerHTML = `
    <div class="mt-scrim"></div>
    <article class="mt-doc" role="dialog" aria-modal="true" aria-labelledby="mt-title">
      <header class="mt-head">
        <div class="mt-crumb"></div>
        <h1 id="mt-title"></h1>
        <p class="mt-lead"></p>
        <button class="mt-x" type="button" aria-label="Close (Esc)">&times;</button>
      </header>
      <div class="mt-body">
        <main class="mt-text"></main>
        <aside class="mt-side"></aside>
      </div>
      <footer class="mt-foot">
        <div class="mt-more"></div>
        <div class="mt-rel"></div>
      </footer>
      <div class="mt-toast" hidden></div>
    </article>`;
  document.body.appendChild(el);

  const q = (s) => el.querySelector(s);
  const scrim = q('.mt-scrim'), doc = q('.mt-doc');
  const toastEl = q('.mt-toast');
  let toastTimer = 0, current = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  // ---- annotated figure ---------------------------------------------------
  // Pins sit on the image in percentage coordinates; each has a card to one side and a
  // leader line between the two. One card is shown at a time, so the figure stays readable.
  function exploreHTML(E) {
    return `<section class="mt-explore">
      <h2>${E.title}</h2>
      <p class="mt-ex-hint">${E.hint}</p>
      <div class="anno" data-anno>
        <div class="anno-img"><div class="anno-wait">rendering from the model…</div></div>
        <svg class="anno-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
      </div>
    </section>`;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Pins arrive as projected screen positions. The card goes on whichever side has room,
  // and since only one card shows at a time they are free to overlap each other.
  function fillExplore(wrap, E, pts) {
    const geo = E.pins.map((p, i) => {
      const s = pts[i] || { x: 50, y: 50 };
      const x = clamp(s.x, 2, 98), y = clamp(s.y, 3, 97);
      const side = x < 48 ? 'r' : 'l';
      return { x, y, side,
        cx: clamp(x + (side === 'r' ? 7 : -7), 6, 94),
        cy: clamp(y, 16, 84) };
    });
    wrap.dataset.geo = JSON.stringify(geo);
    wrap.insertAdjacentHTML('beforeend',
      E.pins.map((p, i) => `<button class="anno-pin" type="button" data-pin="${i}"
          style="left:${geo[i].x}%;top:${geo[i].y}%" aria-label="${p.name}">${i + 1}</button>`).join('') +
      E.pins.map((p, i) => `<div class="anno-card anno-${geo[i].side}" data-card="${i}"
            style="left:${geo[i].cx}%;top:${geo[i].cy}%">
          <h4><span class="anno-n">${i + 1}</span>${p.name}</h4>
          <p>${p.text}</p>
          ${(p.deeper || []).length ? `<div class="anno-deeper">
            <span class="anno-deeper-l">Go deeper</span>
            ${p.deeper.map((d) => `<button class="anno-link" type="button" data-more="reading">${d}</button>`).join('')}
          </div>` : ''}
        </div>`).join(''));
  }

  // Straight leader from pin to card anchor; a non-scaling stroke keeps it an even hairline
  // in spite of the stretched viewBox.
  function drawLeader(wrap, i) {
    const svg = wrap.querySelector('.anno-lines');
    if (!svg) return;
    let geo = [];
    try { geo = JSON.parse(wrap.dataset.geo || '[]'); } catch { geo = []; }
    const g = geo[i];
    svg.innerHTML = g
      ? `<line x1="${g.x}" y1="${g.y}" x2="${g.cx}" y2="${g.cy}"
               stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke"
               stroke-linecap="round" opacity=".9"/>`
      : '';
  }

  function selectPin(wrap, i) {
    wrap.querySelectorAll('.anno-pin').forEach((b, k) => b.classList.toggle('on', k === i));
    wrap.querySelectorAll('.anno-card').forEach((c, k) => c.classList.toggle('on', k === i));
    wrap.classList.toggle('picked', i >= 0);
    drawLeader(wrap, i);
  }

  function open(id) {
    const T = TOPICS[id];
    if (!T) return;
    current = id;
    // normalise the separators so every crumb spaces its chevrons the same way
    q('.mt-crumb').textContent = T.crumb.replace(/\s*›\s*/g, '  ›  ').replace(/\s+$/, '');
    q('#mt-title').textContent = T.title;
    q('.mt-lead').textContent = T.lead;

    const body = T.sections
      .map((s) => `<section><h2>${s.h}</h2>${s.html}</section>`).join('');
    // every chapter lands on the same question: what does this give a drug hunter?
    const target = T.target
      ? `<section class="mt-target"><div class="mt-target-tag">Drug target &middot; ${T.target.tag}</div>${T.target.html}</section>`
      : '';
    q('.mt-text').innerHTML =
      (T.explore && T.explore.pins.length ? exploreHTML(T.explore) : '') + body + target;

    // side column: figures, then the key-numbers table
    const figs = T.figures.map((f, i) => {
      if (f.kind === 'svg') {
        return `<figure class="mt-fig">${f.svg}<figcaption>${f.cap}</figcaption></figure>`;
      }
      return `<figure class="mt-fig"><div class="mt-shot" data-fig="${i}">
                <div class="mt-shot-wait">rendering from the model…</div>
              </div><figcaption>${f.cap}</figcaption></figure>`;
    }).join('');
    const facts = `<div class="mt-facts"><h3>Key numbers</h3><dl>` +
      T.facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `</dl></div>`;
    q('.mt-side').innerHTML = figs + facts;

    q('.mt-more').innerHTML = MORE.map(([k, label, d]) =>
      `<button class="mt-btn" type="button" data-more="${k}">
         <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
         ${label}</button>`).join('');
    q('.mt-rel').innerHTML = '<span class="mt-rel-l">Related</span>' +
      T.related.filter((r) => TOPICS[r])
        .map((r) => `<button class="mt-chip" type="button" data-go="${r}">${TOPICS[r].title}</button>`).join('');

    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('on'));
    q('.mt-text').scrollTop = 0;
    doc.focus?.();

    // the annotated figure gets its own, larger capture
    if (T.explore && T.explore.pins.length) {
      const wrap = q('.anno');
      requestFigure(T.explore.view, T.explore.opts || {}, (url, pts) => {
        if (!url || !wrap || !wrap.isConnected) return;
        const img = new Image();
        img.alt = T.title;
        img.onload = () => {
          const host = wrap.querySelector('.anno-img');
          host.innerHTML = ''; host.appendChild(img);
          fillExplore(wrap, T.explore, pts || []);
          selectPin(wrap, -1);
        };
        img.src = url;
      });
    }

    // fill the simulation figures; they are cached by the caller
    T.figures.forEach((f, i) => {
      if (f.kind !== 'sim') return;
      const host = q(`.mt-shot[data-fig="${i}"]`);
      if (!host) return;
      requestFigure(f.view, f.opts || {}, (url) => {
        if (!url || !host.isConnected) return;
        const img = new Image();
        img.alt = f.cap;
        img.onload = () => { host.innerHTML = ''; host.appendChild(img); };
        img.src = url;
      });
    });
  }

  function close() {
    el.classList.remove('on');
    current = null;
    setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 220);
  }

  el.addEventListener('click', (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const wrap = pin.closest('.anno');
      if (wrap) {
        const i = +pin.dataset.pin;
        selectPin(wrap, pin.classList.contains('on') ? -1 : i);   // click again to dismiss
      }
      return;
    }
    const t = e.target.closest('[data-more],[data-go],.mt-x');
    if (!t) return;
    if (t.classList.contains('mt-x')) { close(); return; }
    if (t.dataset.go) {
      open(t.dataset.go);
      onNavigate?.(t.dataset.go);
      return;
    }
    if (t.dataset.more) {
      const label = MORE.find((m) => m[0] === t.dataset.more)?.[1] || 'That material';
      toast(`${label} — second level, not built in this mock-up.`);
    }
  });
  scrim.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { e.stopPropagation(); close(); }
  }, true);

  return { open, close, isOpen: () => !el.hidden, current: () => current };
}
