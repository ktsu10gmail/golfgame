# Session Handoff

Last updated: 2026-07-29

Use this file to resume work after a reboot or in a new Codex conversation.
Project phase history remains authoritative in `docs/PROJECT_PHASES.md`.

## Current repository state

- Repository: `https://github.com/ktsu10gmail/golfgame.git`
- Branch: `main`
- Last pushed commit before this handoff: `fe7e691 Clarify greenside distance coaching`
- Phase 1: complete
- Phase 2: complete
- Automated verification baseline: 121 tests (84 Python, 37 Node/browser)
- Active work: define and begin Phase 3

## Completed product work

- Four complete 18-hole courses: Meadows, Warrenbrook, Cranbury, and Galloping
  Hill.
- Galloping Hill includes all supplied hole images, scorecard sources, generated
  hole JSON, browser registration, and authoritative surface validation.
- Full shots, chips, putting, penalties, relief, saved round recovery, decision
  scoring, and round analysis use deterministic authoritative packets.
- Ball-above-feet and ball-below-feet effects scale with shot distance and lie
  severity. Correct left/right aim compensation is graded separately from swing
  execution.
- The two-foot gimme boundary uses authoritative hundredth-yard precision and
  includes the conceded stroke in the final score.
- Greenside descriptions distinguish distance to the cup, distance to the front
  edge, carry, landing depth, and rollout.
- The standard strategy advice library is in
  `docs/STANDARD_ADVICE_LIBRARY.md`.

## Current AI decision

The next proposed Phase 3 item is optional local Ollama narration:

- Start with `qwen3:4b-instruct` on the user's 6 GB NVIDIA GPU.
- Initial settings: `num_ctx=4096`, `temperature=0.3`.
- `gemma3:4b` is the second model to benchmark.
- Avoid making an 8B model the default on 6 GB because model weights plus
  runtime and context-cache memory may force CPU offload.
- The deterministic golf engine must remain authoritative. The LLM may explain
  lies, strategy, engine results, next-play advice, and round reviews; it must
  not calculate physics, scoring, penalties, relief, gimmies, or shot outcomes.
- Send compact authoritative shot/strategy packets to the model rather than
  entire course files.
- Preserve the existing local heuristic fallback when Ollama is unavailable.

Ollama `0.32.0` was found at `/usr/local/bin/ollama`. GPU visibility could not
be confirmed from the pre-reboot session because `nvidia-smi` returned no GPU
information there.

The current AI implementation is Gemini-only:

- `packages/ai/service.py`
- `packages/ai/prompts.py`
- `scripts/serve.py`
- browser endpoints `/api/ai/health`, `/api/ai/shot`, and `/api/ai/review`

The likely implementation is to add an Ollama provider behind the existing
`AiService` interface, configure the provider and model through environment
variables, and keep Gemini available as an alternative.

## First actions after reboot

Run:

```bash
cd /home/ksu/golfgame
git status --short --branch
nvidia-smi
ollama --version
systemctl is-active ollama
ollama pull qwen3:4b-instruct
ollama run qwen3:4b-instruct
```

Then ask Codex:

> Read `README.md`, `docs/PROJECT_PHASES.md`, and
> `docs/SESSION_HANDOFF.md`. Resume the golf game from the saved handoff.
> Verify the NVIDIA GPU is visible to Ollama, benchmark
> `qwen3:4b-instruct`, and then implement it as an optional Game Master
> provider without changing authoritative game calculations.

Before changing code, run the existing baseline:

```bash
python3 -m unittest discover -v
node --test tests/*.test.mjs
```

After implementation, update this handoff and `docs/PROJECT_PHASES.md`, rerun
both suites, then commit and push the verified changes.
