# Standard Advice Library

This file is the reusable source of truth for standard golf advice wording.
Use these recommendations when we want consistent guidance across shots, lies,
rough lengths, and hazard situations.

## Purpose

- Keep advice short, practical, and repeatable.
- Match wording to the project's canonical lie types where possible.
- Separate factual shot context from coaching language.
- Prefer conservative advice when the lie or hazard creates uncertainty.

## Advice Style Rules

- State the lie or problem first.
- State the main adjustment second.
- State the priority outcome last.
- Prefer plain language over technical jargon.
- Do not promise a perfect result.
- If the lie is severe, prioritize advancing the ball and avoiding the big miss.

## Standard Advice Template

Use this structure when building advice:

`Lie/condition. Main setup or strike adjustment. Recommended target or miss. Conservative outcome.`

Example:

`Moderate rough. Expect less control and reduced distance. Take more loft and favor the safe side of the green. Priority is solid contact.`

## AI Prompt Use

Use this library as a constrained wording source for future AI narration.

### AI Rules

- Use authoritative shot facts first and this file second.
- Do not invent lie effects that are not supported by the shot context.
- Prefer the approved short phrase for each key before using the longer standard advice.
- Use at most one lie key, one local-situation key, one hazard key, and one outcome key in the same advice block unless the user explicitly asks for more detail.
- Keep the final coaching output to 1 to 3 short sentences.
- If the shot context is dangerous or uncertain, choose the conservative phrase.
- Do not mix contradictory phrases like `attack the target` and `take the safe result`.

### AI Output Shape

Future prompts should assemble advice from stable keys using a structure like:

`primary_lie_key + optional local_situation_key + optional hazard_key + outcome_key`

Example:

`rough_medium + ball_below_feet + water_in_play + favor_safe_side`

Possible rendered output:

`Moderate rough. Expect less control and a rightward leak from the lie. Favor the dry, safe side and prioritize solid contact.`

### Approved AI Tone

- concise
- practical
- conservative when uncertain
- instructional, not theatrical
- no hype, no filler, no promises

## AI Approved Advice Keys

These keys are intended to remain stable so prompt builders and future JSON
payloads can reference them directly.

### Lie Keys

- `tee_standard`
- `fairway_clean`
- `rough_light`
- `rough_medium`
- `rough_deep`
- `rough_flyer`
- `hardpan`
- `bunker_fairway`
- `bunker_buried`

### Local Situation Keys

- `ball_below_feet`
- `ball_above_feet`
- `uphill_lie`
- `downhill_lie`
- `ball_sitting_down`
- `ball_sitting_up`
- `tree_trouble`
- `sidehill_lie`

### Hazard Keys

- `water_in_play`
- `forced_water_carry`
- `greenside_water`
- `fairway_bunker_in_play`
- `greenside_bunker_in_play`
- `out_of_bounds_in_play`
- `narrow_landing_area`
- `forced_layup`
- `recovery_after_penalty`
- `unplayable_situation`

### Putting Keys

- `long_putt`
- `breaking_putt`
- `uphill_putt`
- `downhill_putt`
- `short_must_make_putt`

### Outcome Keys

- `favor_safe_side`
- `favor_center_green`
- `prioritize_solid_contact`
- `clear_lip_first`
- `escape_first`
- `remove_big_miss`
- `accept_longer_putt`
- `play_to_widest_window`
- `cover_the_carry`
- `restore_position`

## AI Approved Short Phrases

These are the preferred short phrases for prompt assembly.

### Lie Phrase Catalog

- `tee_standard`: `Clean tee lie. Commit to the line and make a balanced swing.`
- `fairway_clean`: `Clean fairway lie. Expect normal distance and aim at the precise window.`
- `rough_light`: `Light rough. Take a little extra club and favor the safe side.`
- `rough_medium`: `Moderate rough. Lower expectations for control and play to the safe area.`
- `rough_deep`: `Deep rough. Prioritize escape, loft, and a conservative target.`
- `rough_flyer`: `Flyer lie. Expect a hot launch and extra release, so land it safely.`
- `hardpan`: `Hardpan. Prioritize clean ball-first contact and a simple shot.`
- `bunker_fairway`: `Fairway bunker. Clear the lip first and accept reduced distance.`
- `bunker_buried`: `Buried lie. Get it out first and accept the safe result.`

### Local Situation Phrase Catalog

- `ball_below_feet`: `Ball below your feet. Expect the shot to leak right and come out lower.`
- `ball_above_feet`: `Ball above your feet. Expect the shot to draw left and launch higher.`
- `uphill_lie`: `Uphill lie. Expect a higher launch and some distance loss.`
- `downhill_lie`: `Downhill lie. Expect a lower flight and more rollout.`
- `ball_sitting_down`: `Ball sitting down. Clean contact will be harder to produce.`
- `ball_sitting_up`: `Ball sitting up. Expect extra jump and release.`
- `tree_trouble`: `Tree trouble. Choose the cleanest window and avoid forcing distance.`
- `sidehill_lie`: `Sidehill lie. Balance and face control matter more than speed.`

### Hazard Phrase Catalog

- `water_in_play`: `Water is the main miss to avoid here.`
- `forced_water_carry`: `This shot has a forced water carry. Confirm the carry number first.`
- `greenside_water`: `Greenside water raises the cost of a short-sided miss.`
- `fairway_bunker_in_play`: `The fairway bunker is the main positional hazard.`
- `greenside_bunker_in_play`: `The greenside bunker is the common miss to avoid.`
- `out_of_bounds_in_play`: `Out of bounds is the highest-cost miss.`
- `narrow_landing_area`: `The landing area is narrow, so dispersion matters more than distance.`
- `forced_layup`: `This is a positional shot, not a distance shot.`
- `recovery_after_penalty`: `After the penalty, the priority is restoring position.`
- `unplayable_situation`: `This is a damage-control spot.`

### Putting Phrase Catalog

- `long_putt`: `Long putt. Prioritize pace first and start line second.`
- `breaking_putt`: `Breaking putt. Start it on the intended line and let the slope move it.`
- `uphill_putt`: `Uphill putt. You can be more assertive on pace.`
- `downhill_putt`: `Downhill putt. Treat pace as the main challenge.`
- `short_must_make_putt`: `Short putt. Commit to the read and use decisive pace.`

### Outcome Phrase Catalog

- `favor_safe_side`: `Favor the safe side.`
- `favor_center_green`: `Favor the center of the green.`
- `prioritize_solid_contact`: `Priority is solid contact.`
- `clear_lip_first`: `Clear the lip first.`
- `escape_first`: `Escape first, then rebuild the hole.`
- `remove_big_miss`: `Remove the big miss from play.`
- `accept_longer_putt`: `Accept the longer putt if it avoids the hazard.`
- `play_to_widest_window`: `Play to the widest safe window.`
- `cover_the_carry`: `Choose the club that covers the carry without requiring a perfect strike.`
- `restore_position`: `Take the simplest route back into play.`

## AI Assembly Rules

- Start with the lie phrase when a playable lie exists.
- Add a local-situation phrase only if it changes expected ball flight or strike quality.
- Add a hazard phrase only if that hazard materially changes target selection.
- End with one outcome phrase.
- Avoid repeating the same concept twice.
- If the lie phrase already includes the outcome, do not append another redundant outcome phrase.

## AI Safe Defaults

If multiple phrases could apply and the context is incomplete, use these defaults:

- Lie default: `fairway_clean`
- Rough default: `rough_medium`
- Trouble default: `play_to_widest_window`
- Hazard default: `remove_big_miss`
- Recovery default: `restore_position`
- Putting default: `long_putt`

## Canonical Lie Advice

These entries align with `data/fixtures/lie_catalog.json`.

### `tee_standard`

- Standard advice: `Clean tee lie. Commit to the intended start line and make a balanced swing. This is a scoring-position setup, so prioritize a confident target.`
- Short version: `Clean tee lie. Commit to the line and make a balanced swing.`
- Focus: full commitment, normal strike, full target selection.

### `fairway_clean`

- Standard advice: `Clean fairway lie. You should get predictable contact and normal distance. Pick the exact landing window and make a committed swing.`
- Short version: `Clean fairway lie. Expect normal distance and aim at the precise window.`
- Focus: precise yardage, normal spin, attacking a defined target.

### `rough_light`

- Condition: about 1-inch light rough.
- Standard advice: `Light rough. Expect slightly less distance and a bit less control. Use enough club, simplify the shot shape, and favor the safer side.`
- Short version: `Light rough. Take a little extra club and favor the safe side.`
- Focus: slight flyer risk, reduced spin, simpler target.

### `rough_medium`

- Condition: about 2-inch moderate rough.
- Standard advice: `Moderate rough. Expect reduced distance and inconsistent spin. Choose more loft if needed, avoid forcing shape, and play to the biggest safe area.`
- Short version: `Moderate rough. Lower expectations for control and play to the safe area.`
- Focus: distance loss, unpredictable release, conservative target.

### `rough_deep`

- Condition: about 4-inch deep rough.
- Standard advice: `Deep rough. Advancing the ball cleanly is the first job. Use loft, shorten the target, and do not force a hero shot unless the lie is clearly sitting up.`
- Short version: `Deep rough. Prioritize escape, loft, and a conservative target.`
- Focus: escape first, reduced carry, high mishit risk.

### `rough_flyer`

- Condition: ball sitting up with grass between club and ball.
- Standard advice: `Flyer lie. Expect the ball to jump with less spin and extra release. Take that into account, choose a safer landing spot, and avoid firing at a tucked target.`
- Short version: `Flyer lie. Expect a hot launch and extra release, so land it safely.`
- Focus: hot face, reduced spin, long release.

### `hardpan`

- Standard advice: `Hardpan. Ball-first contact is critical. Stay shallow, control the low point, and choose the shot you can strike cleanly without adding unnecessary speed.`
- Short version: `Hardpan. Prioritize clean ball-first contact and a simple shot.`
- Focus: thin risk, low-point control, simplified strike.

### `bunker_fairway`

- Standard advice: `Fairway bunker. Take enough loft to clear the lip and expect less distance. Grip down if needed, keep the base stable, and prioritize clean contact over maximum yardage.`
- Short version: `Fairway bunker. Clear the lip first and accept reduced distance.`
- Focus: lip clearance, clean contact, distance tradeoff.

### `bunker_buried`

- Standard advice: `Buried bunker lie. This is an explosion-and-escape shot, not a spin shot. Use loft, hit the sand decisively, and take the safe result.`
- Short version: `Buried lie. Get it out first and accept the safe result.`
- Focus: escape first, heavy sand strike, minimal ambition.

## Ball Position And Local Situation Advice

These are not canonical lie IDs, but they are useful standard context tags.

### Ball Below Feet

- Standard advice: `Ball below your feet. Expect the shot to leak right and come out lower. Choke down slightly, maintain posture, and aim a little left of the normal target.`

### Ball Above Feet

- Standard advice: `Ball above your feet. Expect the shot to draw left and launch a bit higher. Stand taller, make a balanced swing, and allow for left movement.`

### Uphill Lie

- Standard advice: `Uphill lie. Expect a higher launch with some distance loss. Take more club, match your shoulders to the slope, and swing with balance.`

### Downhill Lie

- Standard advice: `Downhill lie. Expect a lower flight and more rollout. Take enough loft, stay balanced through the slope, and choose a safer landing area.`

### Ball Sitting Down

- Standard advice: `Ball sitting down. Clean contact will be harder to produce. Use more loft, shorten the expectation for distance, and play the highest-percentage shot.`

### Ball Sitting Up

- Standard advice: `Ball sitting up. You may get more jump and less spin than expected. Favor a landing area that can handle extra release.`

### Tree Trouble

- Standard advice: `Tree trouble. First decide whether advancing safely is better than forcing full distance. Choose the cleanest window and remove the big number from play.`

### Sidehill Lie

- Standard advice: `Sidehill lie. Balance and face control matter more than speed. Simplify the shape and aim for the widest safe window.`

## Rough-Length Guidance

Use these when the advice needs to refer to rough length directly.

### 1-inch light rough

- Standard advice: `From 1-inch rough, expect only a small penalty on distance and spin. A slightly safer target and a little extra club are usually enough.`

### 2-inch moderate rough

- Standard advice: `From 2-inch rough, control becomes less reliable. Plan for reduced spin, less carry, and a larger safety margin.`

### 4-inch deep rough

- Standard advice: `From 4-inch rough, the priority is advancing the ball cleanly. Use loft, keep expectations modest, and avoid short-sided aggression.`

## Hazard And Trouble Situation Advice

These situations often need standard wording even when they are not represented
as playable lies.

### Water Hazard In Play

- Standard advice: `Water is the main miss to avoid here. Favor the dry side, pick the conservative line, and make the shot that keeps the penalty out of play.`

### Shot Must Carry Water

- Standard advice: `This shot has a forced water carry. Confirm the carry number first, then choose the club that clears the hazard without requiring a perfect strike.`

### Greenside Water

- Standard advice: `Greenside water raises the cost of a short-sided miss. Favor the center or the safe side of the green and accept the longer putt.`

### Fairway Bunker In Play

- Standard advice: `The fairway bunker is the main positional hazard. Aim away from the trap if the reward does not clearly justify challenging it.`

### Greenside Bunker In Play

- Standard advice: `The greenside bunker is the common miss to avoid. Favor the section of green that leaves an uphill putt or straightforward chip.`

### Out Of Bounds In Play

- Standard advice: `Out of bounds is the highest-cost miss. Shift the target away from it and choose the shot shape that keeps the ball in play.`

### Narrow Landing Area

- Standard advice: `The landing area is narrow, so dispersion matters more than maximum distance. Choose the club and line that fit the width of the hole.`

### Forced Layup

- Standard advice: `This is a positional shot, not a distance shot. Pick the widest safe landing zone and leave a comfortable next yardage.`

### Recovery After Penalty

- Standard advice: `After the penalty, the priority is restoring position. Take the simplest route back into play and avoid compounding the mistake.`

### Unplayable Situation

- Standard advice: `This is a damage-control spot. Take the relief option or recovery line that restores a playable next shot without chasing too much.`

## Green And Putting Advice

### Long Putt

- Standard advice: `Long putt. Prioritize pace first and start line second. The goal is to finish in easy two-putt range.`

### Breaking Putt

- Standard advice: `Read the amount of break, then match the speed to that read. Start it on the intended line and let the slope move it.`

### Uphill Putt

- Standard advice: `Uphill putt. You can be more assertive on pace, but keep the start line disciplined.`

### Downhill Putt

- Standard advice: `Downhill putt. Treat pace as the main challenge. Start the ball on line and favor a dying speed near the hole.`

### Short Must-Make Putt

- Standard advice: `Short putt. Commit to the read, match it with decisive pace, and free the stroke.`

## Standard Miss Framework

When the advice should specify a preferred miss, use one of these:

- `Preferred miss: short of the hole.`
- `Preferred miss: center of the green.`
- `Preferred miss: away from the water.`
- `Preferred miss: away from out of bounds.`
- `Preferred miss: on the fat side of the pin.`
- `Preferred miss: back in play, even if it leaves a longer next shot.`

## Reusable One-Line Advice Snippets

- `Take enough club to cover the lie penalty.`
- `Favor the biggest safe target.`
- `Remove the big miss from play.`
- `Expect less spin and more release.`
- `Ball-first contact is the priority.`
- `Escape first, then rebuild the hole.`
- `Accept the longer putt if it avoids the hazard.`
- `Do not force the hero shot from this lie.`
- `Play the shot that matches the width of the landing area.`
- `Choose the club that covers the carry without requiring a perfect strike.`

## Notes For Future Expansion

- Add separate entries for chip, pitch, punch, and flop-shot situations.
- Add left-handed and right-handed directional variants if needed.
- Add course-specific hazard language only in course files, not in this shared library.
- If the app later stores advice keys in data, map them back to these exact section names.
