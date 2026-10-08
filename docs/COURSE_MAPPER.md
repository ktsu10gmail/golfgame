# Course Mapper

The Course Mapper is the authoring desk for a complete playable course. Each
hole uses two distinct layers:

- a local **reference image** used only while mapping; and
- editable **calculation geometry** for tee boxes, fairway, rough, bunkers,
  water, trees, out of bounds, green, tee markers, starting ball, route, and pin.

The installed game draws its player-facing illustrated map from the finished
geometry. It does not show or stretch the local aerial reference image. This
keeps the visible surfaces, tee markers, ball, targets, and pin registered to
the same authoritative coordinates.

The editor uses local hole images only. It does not require a mapping API,
account, or billing setup.

Start the dedicated Course Mapper server from the project folder:

```bash
python3 scripts/serve_mapper.py
```

Then open:

```text
http://localhost:8081/editor.html
```

The Jetta game server remains on port `8080`. The mapper launcher accepts the
same `--host` and `--port` options as the game server when another bind address
or port is required.

## Map or correct one hole

1. Select the hole and choose **Choose or replace image** if artwork is not
   already present. Use **90° left** or **90° right** to orient the artwork
   before aligning any calculation shapes.
2. Enter par, handicap, tee yardages, layout, and elevation change.
3. Use the image-opacity control when a colored calculation shape is difficult
   to distinguish from the artwork.
4. Place or adjust the blue, white, and forward tee-box polygons.
5. Put each tee marker inside its corresponding tee box. The white marker is
   the starting ball and `(0, 0)` calculation origin.
6. Adjust fairway, rough, green, bunkers, water, trees, and out-of-bounds polygons.
   Drag solid vertices to reshape them and faint midpoints to add vertices.
7. Put the pin inside the green and add route controls along doglegs.
8. Use **Measure two points** from the white tee to the pin, enter the
   scorecard white-tee yardage, and choose **Set scale** when the image needs
   calibration.
9. Check the live validation card. A hole is ready only when its required
   markers and surfaces are present and the markers are inside the correct
   polygons.
10. Choose **Preview game map** to inspect the final full-hole projection before
    installation. Custom-course bunkers appear at exactly their authored size.

### On-course GPS alignment

Three-point calibration establishes the affine map from the game's white-tee
origin and golfer-relative meter axes back to real GPS: translation, rotation,
scale, handedness, and a lateral check against skew. It does not create or move
gameplay geometry.

An OSM or Golf Intelligence hole whose source geometry is explicitly
georeferenced in WGS84 already contains those values. Mapper therefore derives
the inverse of its WGS84-to-game transform automatically from the white tee and
pin. No bunker anchor or pasted coordinates are requested. Local-image,
restored legacy, and otherwise insufficiently georeferenced holes retain the
existing optional three-point workflow as a fallback.

Shape buttons create starting geometry. Every shape remains editable. Bunker
and water templates use eight points so corrections stay quick. Use **Undo** or
`Ctrl+Z` (`Command+Z` on macOS) to reverse recent actions. When a shape is
selected, drag inside the polygon to move the complete shape without changing
its outline. Drag its solid points to reshape it and its faint midpoints to add
points. **5% smaller** and **5% larger** resize it around its current center;
the existing 5° controls provide fine rotation.

Hold Shift while clicking shapes on the map or in **Mapped features** to select
several shapes. When they are the same field type, choose **Make one cluster**
to replace them with one editable outer shape. Tree shapes become one rounded
rectangular canopy cluster. Undo restores the separate original shapes.

For image-guided tracing, choose **Scan bunker here** or **Scan trees here**
and click inside the feature on the local image. The editor samples that point,
follows only the connected sand or canopy region, and creates an eight-point
editable polygon. Repeat for each separate bunker or tree cluster. If the image
has heavy shadows or labels, adjust the generated dots or use Undo and click
closer to the center of the feature. Guided shapes are preserved when Auto Draft
later builds the remaining playing surfaces.

Use **Clear field shapes** in the Mapped features heading when a hole needs to
be redrawn. The editor asks for confirmation and removes every field polygon on
the current hole while preserving the artwork, hole card, tee and pin markers,
route points, and pasted GPS coordinates. The clear operation can be reversed
with **Undo**.

## Save, export, and install

**Save project** downloads one `.golfmap` containing all 18 working holes and
their local image references. When you switch holes, the editor autosaves the
departing hole and the full project in the browser, then confirms the saved hole
and time in the header. If browser storage is full, it keeps the current hole
open so you can use **Save project** to download a copy.

**Export Hole JSON** exports only the current calculation geometry for review.

**Export game package** includes ready hole JSON, scorecard data, and the mode
needed to generate the illustrated map from geometry. A complete package can
also be installed from the command line:

```bash
python3 scripts/import_mapped_course.py /path/to/course-name.golfcourse.json --force
```

**Install in game** is the normal handoff. It validates all 18 holes, copies the
artwork and geometry into `data/<course-id>/`, updates the mapped-course catalog,
and makes the new map available after the game page is reloaded. No separate
image-copy or JSON-registration work is required.

## Export contract

The editor exports:

- the instruction to generate the visual course from mapped geometry;
- tee polygons and tee/start markers;
- fairway and rough polygons;
- bunker and water polygons;
- decorative tree-cluster polygons;
- a primary green and pin;
- out-of-bounds polygons;
- tee-to-pin route controls;
- elevation and scorecard metadata.

The local reference image does not determine a lie and is not displayed during
play. The aligned calculation polygons are authoritative and also generate the
player-facing illustration, which is why every bunker, water edge, tee box, and
green must be matched before installation.

### Blue tee geometry as the start anchor

For imported geometry whose start is the blue tee, choose **Blue tee / start ball**
and click that tee location, then set the pin. With valid blue, white, and forward
scorecard yardages, Mapper creates the white and forward markers and tee boxes
using their yardage differences from blue. If no blue tee box exists, Mapper
creates an editable 14 m by 8 m box; an existing blue box supplies the shape.
Missing or invalid yardages are not guessed. Scorecard changes and moving the
blue marker or pin realign the secondary tees. The anchor is saved per hole.
Placing **White tee / start ball** switches back to white-based alignment.
These generated locations are estimates for review; the exported game's coordinate
origin and GPS calibration remain based on the white tee.

### Preview immediately after placing tee boxes

Place a **Blue tee box** or **White tee box** on the imported start location.
Mapper centers that tee marker in the new box and creates the other two markers
and boxes from valid scorecard distances when the pin is present. The **Preview
game map** button is also beside the shape tools. Preview works for the current
hole even when the other holes are unfinished. Trees and imagery are optional.

Draft preview requires a white start position (including one generated from blue),
a pin, and a green. It does not require tee markers to be inside their boxes,
rough to be mapped, or manual GPS calibration. The preview lists any remaining
mapping checks. Export and installation retain their existing completeness,
containment, GPS, and source-review checks. Preview does not mark the hole ready.

### Choose the imported start tee

Use **Default ball start tee** in the Hole card to select Blue, White, or
Forward / Red for that hole. This assigns the existing imported start position
and start box to that scorecard color; it does not move the imported start.
The other two tee markers and boxes are regenerated from scorecard yardage
differences. The selection is saved per hole and the preview ball uses that
selected tee. Creating a colored tee box or placing its start marker also
updates the selection. Export retains the white coordinate origin and records
the selected default start tee and point in hole metadata.

OSM imports default the route start to a blue **B** marker and retain the endpoint
as the black **P** marker. Blue is a Mapper default, not verified OSM tee-color
evidence. Legacy OSM starts without an explicit tee selection use this default
when opened; explicit operator selections remain.

Clicking **Preview game map** prepares any missing secondary tee markers and
boxes from the selected start tee and scorecard, saves the generated geometry
with undo support, and opens the preview. White markers display as white **W**,
forward markers as red **F**, and blue markers as blue **B**. Existing complete
tee geometry is preserved when opening preview.

### Preserve mapped green sizes

Automatic 40-yard green enlargement is disabled for Mapper preview, normal
gameplay, and challenge holes. These paths use the mapped/imported green
polygon. Older generated geometry uses its stored mapped_polygon when available.
Hazard-free pin checks remain active without resizing the green.

Explicit rough polygons are optional for readiness/export/installation. The game
uses rough for ground without another mapped surface. Author rough polygons only
when specific rough areas are needed; fairways, greens, tees, hazards, and mapped
boundaries retain their existing behavior.

### Five-yard fairway first cut

Game export and preview add a 5-yard (4.572-meter) light-rough band along
fairway edges. Gameplay also derives this band for existing course geometry.
Fairway polygons retain their mapped dimensions. Greens, tees, bunkers, water,
and out-of-bounds take precedence; ground beyond the band uses regular rough.
The band is derived gameplay geometry, not imported OSM evidence.

Scorecards may provide one, two, or three tee sets. Only tees with positive
scorecard yardages require markers and boxes for readiness and export. Missing
tee colors are not synthesized. Preview uses an available tee as its origin
when no white tee is provided; existing maps retain their white origin.
