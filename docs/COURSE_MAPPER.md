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

Open it while the game server is running:

```text
http://localhost:8080/editor.html
```

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
