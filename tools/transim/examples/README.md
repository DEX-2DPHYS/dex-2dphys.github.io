# Example image maps

These small PNGs demonstrate the optional image-map inputs. Upload them in the
app (browser or Streamlit) to see how spatial maps change the physics.

| File | Use as | What it shows |
|------|--------|---------------|
| `example_density_map.png` | Carrier density map | A smooth left→right step — a gate-defined **p–n-like junction** (low density on the left, high on the right). With the density min set negative it becomes a true p–n junction. |
| `example_mobility_map.png` | Mobility map | A clean sheet with a **low-mobility disk** in the centre — a localized dirty/scattering region. |
| `example_contact_map.png` | Contact map (colour) | Black = active graphene, white border = etched/outside, and four coloured pads = contacts (red=source left, blue=drain right, green=top probe, yellow=bottom probe). |
| `example_contact_map_grayscale.png` | Contact map (greyscale) | Black = active, white = etched, and **distinct grey levels = distinct contacts**. 8-bit here; 16-bit greyscale is also supported (fully in the Python app; the browser downsamples to 8-bit). |

## How the maps are interpreted

- **Density / mobility:** pixel intensity (luminance or a chosen channel) is
  linearly mapped to the value range you set (min…max), optionally inverted and
  smoothed. Brighter → larger value by default.
- **Contacts:** near-black is treated as active device, near-white as etched,
  and saturated colours as contacts. Each distinct colour becomes one contact
  (the first two are assigned source/drain, the rest probes; edit roles as
  needed).

All interpretation is deliberately simple — see the app's *Model assumptions*
panel and the top-level `README.md` for the caveats.
