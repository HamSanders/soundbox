/**
 * Audiobooks: takes. Every generation of a paragraph is kept as a take, so a
 * regenerate never loses the previous read. Selecting (restoring) a take
 * repoints `segment.sound_id`; deleting one removes its sound from the
 * library when nothing else uses it.
 *
 * Recording is a listener on `MirliService.segmentVoiced`, so a paragraph
 * voiced from the studio timeline gets a take too.
 */

import { join } from "node:path";

import * as dsp from "../audio/dsp.js";
import { ModelError } from "../errors.js";
import type { MirliService } from "../service.js";
import type { BookAccess } from "./render-access.js";
import { voiceStores } from "./render-access.js";
import { planSelection, spliceAudio, trimFragment, type CharRange, type SplicePlan } from "./takes-splice.js";
import type { TakeOrigin, TakeRow, TakeStore } from "./takes-store.js";

/** Voices `text` for a paragraph through the normal segment path, and
 *  returns the new sound id. Supplied by the render module. */
export type VoiceFn = (segmentId: string, opts: { text?: string; origin: TakeOrigin }) => Promise<string>;

const listening = new WeakSet<MirliService>();
/** Segments whose next voicing is a fragment for a splice, not a take. */
const fragments = new Set<string>();

/** Start recording takes for every voiced segment. Idempotent. */
export function recordTakes(svc: MirliService): void {
  if (listening.has(svc)) return;
  listening.add(svc);
  svc.segmentVoiced.push((e) => {
    if (fragments.has(e.segment_id)) return;
    voiceStores(svc.db).takes.record({
      segment_id: e.segment_id,
      sound_id: e.sound_id,
      spoken_text: e.spoken_text,
      source_text: svc.getSegment(e.segment_id)?.text ?? e.spoken_text,
      voice_id: e.voice_id,
      model_id: e.model_id,
      request_options: e.request_options,
      seed: e.seed,
    });
  });
}

export class TakesService {
  constructor(
    private readonly svc: MirliService,
    private readonly book: BookAccess,
  ) {}

  private get store(): TakeStore {
    return voiceStores(this.svc.db).takes;
  }

  list(segmentId: string): TakeRow[] {
    return this.store.list(segmentId);
  }

  /** Put a take back on the timeline. */
  select(segmentId: string, takeId: string): TakeRow {
    const take = this.requireTake(segmentId, takeId);
    const p = this.book.getParagraph(segmentId);
    if (p?.locked) throw new ModelError("This paragraph is locked. Unlock it to change its take.");
    const sound = this.svc.getSound(take.sound_id);
    if (!sound) throw new ModelError("This take's audio is no longer in the library.");
    const seg = this.svc.db.setSegmentSound(segmentId, sound.id, sound.duration_s);
    if (!seg) throw new ModelError("Paragraph not found.");
    this.svc.stories.changed(seg.story_id);
    this.book.markVoiced(segmentId, take.source_text);
    this.publish(segmentId);
    return this.store.get(takeId)!;
  }

  /** Remove a take. The selected one can't be removed: select another first. */
  async delete(segmentId: string, takeId: string): Promise<void> {
    const take = this.requireTake(segmentId, takeId);
    if (take.selected) throw new ModelError("This take is on the timeline. Select another take before deleting it.");
    this.store.delete(takeId);
    if (!this.store.soundInUse(take.sound_id)) await this.svc.deleteSound(take.sound_id);
    this.publish(segmentId);
  }

  /**
   * Re-voice part of a paragraph and splice it into the current take.
   * See `takes-splice.ts` for how the cut points are found and when the plan
   * widens to the sentence or the paragraph. `pronounce` turns the plain
   * fragment into what the model should read.
   */
  async regenerateSelection(
    segmentId: string,
    range: CharRange,
    voice: VoiceFn,
    pronounce: (text: string) => string,
  ): Promise<{ plan: SplicePlan; take: TakeRow }> {
    const seg = this.svc.getSegment(segmentId);
    if (!seg) throw new ModelError("Paragraph not found.");
    if (this.book.getParagraph(segmentId)?.locked) throw new ModelError("This paragraph is locked.");
    if (!seg.sound_id) throw new ModelError("Voice the whole paragraph before regenerating part of it.");
    const baseFile = this.svc.db.getFilename(seg.sound_id);
    if (!baseFile) throw new ModelError("The audio for this paragraph is missing.");
    const base = dsp.readWav(join(this.svc.config.paths.sounds, baseFile));
    const plan = planSelection(seg.text, range, base.audio, base.sampleRate);

    if (plan.mode === "paragraph") {
      const soundId = await voice(segmentId, { origin: "generate" });
      return { plan, take: this.store.forSound(soundId)! };
    }

    const before = seg.sound_id;
    const fragmentText = pronounce(seg.text.slice(plan.start, plan.end));
    fragments.add(segmentId);
    let fragmentId: string;
    try {
      fragmentId = await voice(segmentId, { text: fragmentText, origin: "selection" });
    } finally {
      fragments.delete(segmentId);
    }
    const fragFile = this.svc.db.getFilename(fragmentId);
    if (!fragFile) throw new ModelError("The regenerated words were not written.");
    const frag = dsp.readWav(join(this.svc.config.paths.sounds, fragFile));
    const fragAudio = frag.sampleRate === base.sampleRate
      ? frag.audio
      : dsp.resampleAudio(frag.audio, frag.sampleRate, base.sampleRate);
    const spliced = spliceAudio(
      base.audio,
      trimFragment(fragAudio, base.sampleRate),
      base.sampleRate,
      plan.cut_start_s!,
      plan.cut_end_s!,
    );
    const story = this.svc.db.getStory(seg.story_id);
    const sound = this.svc.importSound(spliced, base.sampleRate, {
      name: `${seg.text.slice(0, 40)} (edited)`,
      source: "audiobook-splice",
      projectId: story?.project_id ?? null,
    });
    this.svc.db.setSegmentSound(segmentId, sound.id, sound.duration_s);
    // The fragment was only material for the splice.
    if (!this.store.soundInUse(fragmentId)) await this.svc.deleteSound(fragmentId);

    const prevTake = this.store.forSound(before);
    const spoken = prevTake
      ? prevTake.spoken_text
      : seg.text;
    const take = this.store.record({
      segment_id: segmentId,
      sound_id: sound.id,
      spoken_text: spoken,
      source_text: seg.text,
      voice_id: seg.voice_id ?? null,
      model_id: prevTake?.model_id ?? sound.model,
      request_options: prevTake?.request_options ?? {},
      seed: null,
      origin: "selection",
    });
    this.svc.stories.changed(seg.story_id);
    this.book.markVoiced(segmentId, seg.text);
    this.publish(segmentId);
    return { plan, take };
  }

  private requireTake(segmentId: string, takeId: string): TakeRow {
    const take = this.store.get(takeId);
    if (!take || take.segment_id !== segmentId) throw new ModelError("Take not found.");
    return take;
  }

  private publish(segmentId: string): void {
    const chapter = this.book.chapterForSegment(segmentId);
    if (chapter) {
      this.book.hub.publish(chapter.book_id, { type: "takes", segment_id: segmentId });
      this.book.hub.publish(chapter.book_id, { type: "paragraphs", chapter_id: chapter.id, segment_ids: [segmentId] });
    }
  }
}
