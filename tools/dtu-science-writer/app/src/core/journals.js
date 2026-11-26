/* Official journal abbreviations (ISO 4, as the journals themselves print them) for journals common in physics,
   nanoscience and materials. Citation styles print the short journal title; the abbreviations delivered by Crossref
   and other sources are often wrong ("Nature Nanotech" for Nat. Nanotechnol.), so these take precedence.
   Keys are full titles in lower case without punctuation (see journalKey). Add journals here as they come up. */

const TABLE = [
  ['Physical Review Letters', 'Phys. Rev. Lett.'], ['Physical Review B', 'Phys. Rev. B'], ['Physical Review A', 'Phys. Rev. A'],
  ['Physical Review E', 'Phys. Rev. E'], ['Physical Review X', 'Phys. Rev. X'], ['Physical Review Applied', 'Phys. Rev. Appl.'],
  ['Physical Review Materials', 'Phys. Rev. Mater.'], ['Physical Review Research', 'Phys. Rev. Res.'], ['Physical Review', 'Phys. Rev.'],
  ['Reviews of Modern Physics', 'Rev. Mod. Phys.'], ['Nature', 'Nature'], ['Science', 'Science'], ['Science Advances', 'Sci. Adv.'],
  ['Nature Nanotechnology', 'Nat. Nanotechnol.'], ['Nature Materials', 'Nat. Mater.'], ['Nature Physics', 'Nat. Phys.'],
  ['Nature Communications', 'Nat. Commun.'], ['Nature Electronics', 'Nat. Electron.'], ['Nature Photonics', 'Nat. Photonics'],
  ['Nature Reviews Materials', 'Nat. Rev. Mater.'], ['Nature Reviews Physics', 'Nat. Rev. Phys.'], ['Nature Chemistry', 'Nat. Chem.'],
  ['Scientific Reports', 'Sci. Rep.'], ['Communications Physics', 'Commun. Phys.'], ['Communications Materials', 'Commun. Mater.'],
  ['npj 2D Materials and Applications', 'npj 2D Mater. Appl.'], ['npj Computational Materials', 'npj Comput. Mater.'],
  ['Nano Letters', 'Nano Lett.'], ['ACS Nano', 'ACS Nano'], ['ACS Applied Materials & Interfaces', 'ACS Appl. Mater. Interfaces'],
  ['ACS Applied Nano Materials', 'ACS Appl. Nano Mater.'], ['ACS Photonics', 'ACS Photonics'], ['Journal of the American Chemical Society', 'J. Am. Chem. Soc.'],
  ['Journal of Physical Chemistry C', 'J. Phys. Chem. C'], ['The Journal of Physical Chemistry C', 'J. Phys. Chem. C'],
  ['Journal of Physical Chemistry Letters', 'J. Phys. Chem. Lett.'], ['The Journal of Physical Chemistry Letters', 'J. Phys. Chem. Lett.'],
  ['Chemistry of Materials', 'Chem. Mater.'], ['2D Materials', '2D Mater.'], ['Advanced Materials', 'Adv. Mater.'],
  ['Advanced Functional Materials', 'Adv. Funct. Mater.'], ['Advanced Electronic Materials', 'Adv. Electron. Mater.'], ['Small', 'Small'],
  ['Nanoscale', 'Nanoscale'], ['Nanotechnology', 'Nanotechnology'], ['Carbon', 'Carbon'], ['Applied Physics Letters', 'Appl. Phys. Lett.'],
  ['Journal of Applied Physics', 'J. Appl. Phys.'], ['APL Materials', 'APL Mater.'], ['New Journal of Physics', 'New J. Phys.'],
  ['Journal of Physics: Condensed Matter', 'J. Phys.: Condens. Matter'], ['Journal of Physics D: Applied Physics', 'J. Phys. D: Appl. Phys.'],
  ['Europhysics Letters', 'EPL'], ['EPL (Europhysics Letters)', 'EPL'], ['Proceedings of the National Academy of Sciences', 'Proc. Natl. Acad. Sci. U.S.A.'],
  ['Proceedings of the National Academy of Sciences of the United States of America', 'Proc. Natl. Acad. Sci. U.S.A.'],
  ['Journal of Computational Electronics', 'J. Comput. Electron.'], ['Computer Physics Communications', 'Comput. Phys. Commun.'],
  ['Journal of Chemical Physics', 'J. Chem. Phys.'], ['The Journal of Chemical Physics', 'J. Chem. Phys.'], ['Solid State Communications', 'Solid State Commun.'],
  ['Microelectronic Engineering', 'Microelectron. Eng.'], ['Journal of Vacuum Science & Technology B', 'J. Vac. Sci. Technol. B'],
  ['Physics Reports', 'Phys. Rep.'], ['Journal of Physics and Chemistry of Solids', 'J. Phys. Chem. Solids'], ['Journal of the Physical Society of Japan', 'J. Phys. Soc. Jpn.'],
  ['Proceedings of the Physical Society', 'Proc. Phys. Soc.'], ['Journal of Physics C: Solid State Physics', 'J. Phys. C: Solid State Phys.'],
  ['Ultramicroscopy', 'Ultramicroscopy'], ['Optics Express', 'Opt. Express'], ['Optics Letters', 'Opt. Lett.'], ['Light: Science & Applications', 'Light Sci. Appl.'],
];

export const journalKey = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&]+/g, ' ').trim();
const BY_KEY = new Map(TABLE.map(([full, short]) => [journalKey(full), short]));

/** The official abbreviation of a journal title, or null when it is not in the table. */
export const journalAbbreviation = (title) => BY_KEY.get(journalKey(Array.isArray(title) ? title[0] : title)) || null;
