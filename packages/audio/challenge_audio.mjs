export const AUDIO_SETTINGS_VERSION = "challenge-audio-v1";

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  master: .8,
  music: .45,
  announcer: .8,
  sfx: .8,
  crowd: .5,
  announcerMode: "fun"
});

const PHRASES = Object.freeze({
  CHALLENGE_START: ["Three holes. One match. Let's play.", "The three-hole challenge is underway."],
  HOLE_INTRO: ["A new hole and a new decision.", "Let's see what this hole asks of you."],
  GOOD_APPROACH: ["That's safely aboard.", "A confident approach finds the target."],
  CLOSE_APPROACH: ["That is close. A very good look coming up.", "Nicely judged. That one settles nearby."],
  BUNKER_FINISH: ["That one finds the sand.", "The bunker gets involved. It was feeling left out."],
  GM_HOLED: ["Game Master holes it.", "The Game Master is in."],
  GM_GIMME: ["Game Master is inside the gimme range.", "A gimme for the Game Master."],
  GM_PUTT_MISS: ["Game Master misses.", "The Game Master misses the putt."],
  GM_BUNKER: ["Game Master, in the bunker.", "The Game Master finds the sand."],
  GM_ROUGH: ["Game Master, in the rough.", "The Game Master finds the rough."],
  GM_GREEN: ["Game Master, on the green.", "The Game Master reaches the green."],
  GM_FRINGE: ["Game Master, on the fringe.", "The Game Master stops on the fringe."],
  GM_FAIRWAY: ["Game Master finds the fairway.", "The Game Master is in the fairway."],
  GM_TREES: ["Game Master is in the trees.", "The trees catch the Game Master."],
  GM_PENALTY: ["Game Master takes a penalty.", "A penalty for the Game Master."],
  WATER_OR_PENALTY: ["That will cost a stroke.", "The hazard wins that exchange."],
  BIRDIE_OR_BETTER: ["That is a red number. Nicely played.", "A big finish on the hole."],
  BOGEY: ["One dropped shot. There is time to answer.", "Bogey posted. On to the next decision."],
  DOUBLE_OR_WORSE: ["A costly hole, but the match keeps moving.", "That one got away. Reset for the next tee."],
  LONG_PUTT_MADE: ["What a putt!", "That traveled a long way to find the cup."],
  PLAYER_TAKES_OFFICIAL_LEAD: ["That moves you into the lead.", "You have the advantage after that hole."],
  GM_TAKES_OFFICIAL_LEAD: ["The Game Master takes the lead.", "The Game Master has the edge after that hole."],
  MATCH_TIED_AFTER_HOLE: ["We're all square.", "Nothing between you after that hole."],
  FINAL_HOLE_CONTEXT: ["One Par five decides it.", "The final hole is ready. Make the strategy count."],
  CHALLENGE_COMPLETE: ["Three holes complete.", "That is the match. Time for the scorecard."]
});

function bounded(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function resolveChallengeAudioEvent(facts) {
  if (!facts || typeof facts !== "object") return [];
  const cues = [];
  if (facts.kind === "challenge_start") cues.push({ category: "announcer", event: "CHALLENGE_START", priority: "HIGH" });
  if (facts.kind === "hole_start") cues.push({ category: "announcer", event: facts.slot === 3 ? "FINAL_HOLE_CONTEXT" : "HOLE_INTRO", priority: "NORMAL" });
  if (facts.kind === "shot_start") {
    cues.push({ category: "sfx", event: "impact", priority: "NORMAL" });
    cues.push({ category: "sfx", event: "flight", priority: "LOW" });
  }
  if (facts.kind === "cup") cues.push({ category: "sfx", event: "cup", priority: "HIGH" });
  if (facts.kind === "gm_shot_result") {
    const lie = String(facts.lie || "").trim().toLowerCase();
    const event = facts.completion_type === "holed" ? "GM_HOLED"
      : facts.completion_type === "gimme" ? "GM_GIMME"
      : Number(facts.penalty_strokes || 0) > 0 || ["water", "out of bounds"].includes(lie) ? "GM_PENALTY"
      : facts.putt ? "GM_PUTT_MISS"
      : ["bunker", "sand"].includes(lie) ? "GM_BUNKER"
      : lie.includes("rough") ? "GM_ROUGH"
      : lie === "green" ? "GM_GREEN"
      : lie === "fringe" ? "GM_FRINGE"
      : lie === "fairway" ? "GM_FAIRWAY"
      : lie.includes("tree") ? "GM_TREES"
      : null;
    if (event) cues.push({ category: "announcer", event, priority: facts.completion_type || facts.penalty_strokes ? "HIGH" : "NORMAL" });
  }
  if (facts.reason_codes?.includes("WATER_PENALTY") || facts.reason_codes?.includes("OUT_OF_BOUNDS")) {
    cues.push({ category: "sfx", event: "penalty", priority: "HIGH" });
    cues.push({ category: "crowd", event: "CROWD_OOH", priority: "HIGH" });
    cues.push({ category: "announcer", event: "WATER_OR_PENALTY", priority: "HIGH" });
  } else if (facts.reason_codes?.includes("BUNKER_FINISH")) {
    cues.push({ category: "sfx", event: "sand", priority: "NORMAL" });
    cues.push({ category: "announcer", event: "BUNKER_FINISH", priority: "NORMAL" });
  } else if (facts.reason_codes?.includes("GREEN_REACHED")) {
    cues.push({ category: "sfx", event: "green", priority: "NORMAL" });
    cues.push({ category: "crowd", event: facts.close ? "CROWD_BIG_APPLAUSE" : "CROWD_SMALL_APPLAUSE", priority: "NORMAL" });
    cues.push({ category: "announcer", event: facts.close ? "CLOSE_APPROACH" : "GOOD_APPROACH", priority: "NORMAL" });
  } else if (facts.kind === "shot" && !facts.reason_codes?.includes("FRINGE_FINISH")) {
    cues.push({ category: "sfx", event: "landing", priority: "LOW" });
  }
  if (facts.kind === "hole_complete") {
    if (facts.relative <= -1) cues.push({ category: "announcer", event: "BIRDIE_OR_BETTER", priority: "HIGH" });
    else if (facts.relative === 1) cues.push({ category: "announcer", event: "BOGEY", priority: "NORMAL" });
    else if (facts.relative >= 2) cues.push({ category: "announcer", event: "DOUBLE_OR_WORSE", priority: "HIGH" });
    if (facts.official_leader === "PLAYER") cues.push({ category: "announcer", event: "PLAYER_TAKES_OFFICIAL_LEAD", priority: "HIGH" });
    else if (facts.official_leader === "GAME_MASTER") cues.push({ category: "announcer", event: "GM_TAKES_OFFICIAL_LEAD", priority: "HIGH" });
    else cues.push({ category: "announcer", event: "MATCH_TIED_AFTER_HOLE", priority: "HIGH" });
  }
  if (facts.kind === "challenge_complete") {
    cues.push({ category: "crowd", event: "CROWD_VICTORY_CHEER", priority: "CRITICAL" });
    cues.push({ category: "announcer", event: "CHALLENGE_COMPLETE", priority: "CRITICAL" });
  }
  return cues;
}

export class ChallengeAudioDirector {
  constructor({ settings = DEFAULT_AUDIO_SETTINGS, phraseAudio = {}, onCaption = () => {} } = {}) {
    this.settings = { ...DEFAULT_AUDIO_SETTINGS, ...settings };
    this.phraseAudio = phraseAudio;
    this.onCaption = onCaption;
    this.context = null;
    this.nodes = null;
    this.queue = [];
    this.playing = false;
    this.generation = 0;
    this.lastPhrase = null;
    this.musicVoice = null;
    this.activeAudio = null;
    this.activeAudioResolve = null;
  }

  unlock() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return false;
    if (!this.context) {
      this.context = new AudioContext();
      const master = this.context.createGain();
      const channels = Object.fromEntries(["music", "announcer", "sfx", "crowd"].map(name => [name, this.context.createGain()]));
      Object.values(channels).forEach(node => node.connect(master));
      master.connect(this.context.destination);
      this.nodes = { master, ...channels };
      this.applySettings();
    }
    if (this.context.state === "suspended") void this.context.resume();
    return true;
  }

  applySettings(next = null) {
    if (next) this.settings = { ...this.settings, ...next };
    if (!this.nodes) return;
    this.nodes.master.gain.value = bounded(this.settings.master);
    for (const name of ["music", "announcer", "sfx", "crowd"]) this.nodes[name].gain.value = bounded(this.settings[name]);
  }

  dispatch(facts) {
    const cues = resolveChallengeAudioEvent(facts);
    const critical = cues.some(cue => cue.priority === "CRITICAL");
    if (critical) {
      this.queue = this.queue.filter(cue => cue.priority === "CRITICAL");
      globalThis.speechSynthesis?.cancel?.();
      this.activeAudio?.pause?.();
      this.activeAudioResolve?.();
    }
    this.queue.push(...cues);
    void this.drain(this.generation);
    return cues;
  }

  cancel() {
    this.generation += 1;
    this.queue = [];
    this.playing = false;
    globalThis.speechSynthesis?.cancel?.();
    this.activeAudio?.pause?.();
    this.activeAudioResolve?.();
    this.activeAudio = null;
    this.activeAudioResolve = null;
    if (this.musicVoice) {
      try { this.musicVoice.stop(); } catch { /* already stopped */ }
      this.musicVoice = null;
    }
  }

  setMusicState(state) {
    if (!this.unlock() || !this.nodes) return;
    if (this.musicVoice) {
      try { this.musicVoice.stop(); } catch { /* already stopped */ }
      this.musicVoice = null;
    }
    if (state === "OFF") return;
    const frequency = { NORMAL_PLAY: 110, FINAL_HOLE: 98, VICTORY: 147, END: 123 }[state] || 110;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = state === "FINAL_HOLE" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = state === "VICTORY" ? .055 : .018;
    oscillator.connect(gain).connect(this.nodes.music);
    oscillator.start();
    this.musicVoice = oscillator;
    if (["VICTORY", "END"].includes(state)) {
      gain.gain.exponentialRampToValueAtTime(.001, this.context.currentTime + 1.8);
      oscillator.stop(this.context.currentTime + 1.85);
      this.musicVoice = null;
    }
  }

  async drain(generation) {
    if (this.playing) return;
    this.playing = true;
    while (this.queue.length && generation === this.generation) {
      const cue = this.queue.shift();
      try { await this.playCue(cue, generation); } catch { /* Optional audio never blocks play. */ }
    }
    this.playing = false;
  }

  async playCue(cue, generation) {
    if (cue.category === "announcer") return this.playAnnouncement(cue.event, generation);
    this.playTone(cue.category, cue.event);
    await new Promise(resolve => setTimeout(resolve, cue.category === "crowd" ? 420 : 150));
  }

  playTone(category, event) {
    if (!this.unlock() || !this.nodes) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const isCrowd = category === "crowd";
    oscillator.type = isCrowd ? "sawtooth" : "triangle";
    const base = event === "penalty" ? 120
      : event === "sand" ? 190
      : event === "cup" ? 720
      : event === "impact" ? 560
      : event === "flight" ? 430
      : event === "green" ? 310
      : event === "landing" ? 240
      : isCrowd ? 260 : 520;
    oscillator.frequency.setValueAtTime(base, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, base * (isCrowd ? 1.6 : .65)), context.currentTime + .22);
    gain.gain.setValueAtTime(.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(isCrowd ? .045 : .09, context.currentTime + .02);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + (isCrowd ? .38 : .14));
    oscillator.connect(gain).connect(this.nodes[category]);
    oscillator.start();
    oscillator.stop(context.currentTime + (isCrowd ? .4 : .16));
  }

  async playAnnouncement(event, generation) {
    if (this.settings.announcerMode === "off") return;
    const options = PHRASES[event] || [];
    if (!options.length) return;
    const phrase = options.find(value => value !== this.lastPhrase) || options[0];
    this.lastPhrase = phrase;
    this.onCaption(phrase);
    this.setMusicDucked(true);
    try {
      const asset = this.phraseAudio[event];
      if (asset) {
        const audio = new Audio(asset);
        this.activeAudio = audio;
        audio.volume = bounded(this.settings.master * this.settings.announcer);
        await audio.play();
        await new Promise(resolve => {
          const finish = () => {
            this.activeAudioResolve = null;
            resolve();
          };
          this.activeAudioResolve = finish;
          audio.onended = finish;
          audio.onerror = finish;
        });
        return;
      }
      if (generation !== this.generation || !("speechSynthesis" in globalThis) || !("SpeechSynthesisUtterance" in globalThis)) return;
      await new Promise(resolve => {
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.rate = 1.08;
        utterance.volume = bounded(this.settings.master * this.settings.announcer);
        utterance.onend = resolve;
        utterance.onerror = resolve;
        globalThis.speechSynthesis.speak(utterance);
      });
    } finally {
      this.activeAudio = null;
      this.activeAudioResolve = null;
      if (generation === this.generation) this.setMusicDucked(false);
    }
  }

  setMusicDucked(ducked) {
    if (!this.nodes || !this.context) return;
    const gain = this.nodes.music.gain;
    const target = bounded(this.settings.music) * (ducked ? .28 : 1);
    gain.cancelScheduledValues?.(this.context.currentTime);
    gain.setTargetAtTime?.(target, this.context.currentTime, ducked ? .025 : .09);
  }
}
