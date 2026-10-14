# Mapper installation destinations

Refresh http://192.168.1.47:8081/editor.html and select Install destination in Game handoff.

1. Keep Dev Golfgame (.47) selected and install the ready course.
2. Open http://192.168.1.47:8080/ and verify the course by playing it.
3. Return to Mapper, choose Prod Golfgame (.15), and install. Confirm that you tested this content in Dev.

Dev is the default each time Mapper loads. Prod rejects packages whose content does not match the latest verified Dev install receipt. This verifies content consistency; your confirmation supplies the gameplay approval. Editing geometry, scorecard, course metadata, or artwork requires another Dev installation first.

Both targets validate all 18 holes, save the existing course/catalog under data/backups/mapper-install-*, serialize installs, verify geometry, scorecard, artwork and catalog, and restore the previous files on write/verification failure. Nine-hole-only courses remain save/export-only. Multi-route courses install one route at a time; a later route failure can leave earlier routes installed. Read the destination-specific result before retrying after a network interruption.

Prod uses the private SSH destination configuration /home/ksu/.config/jetta/mapper-target.json (host, port, root, identity). Browsers supply only dev/prod, never host addresses or paths. Change that configuration when .15 moves to cloud. The receiver runs existing .15 validation/installer code without replacing its application, Mapper source, accounts, provider credentials or service configuration.

Dev receipts are stored privately under data/install-receipts. The Course Library installed status remains the local Dev status; Prod installations do not overwrite it or mark a local production request complete. Destination-specific confirmation reports success for the selected game. Existing .15 Mapper remains the stable fallback.
